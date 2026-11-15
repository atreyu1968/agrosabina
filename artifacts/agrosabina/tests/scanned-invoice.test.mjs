import test from "node:test";
import assert from "node:assert/strict";
import { parseInvoiceText } from "../assets/js/parse.js";
import { recoverInvoiceSummary } from "../assets/js/invoice-summary.js";
import { leerDocumento } from "../assets/js/importers.js";
import { fruitEntries } from "../assets/js/fruit-control.js";
import { invoiceDirection } from "../assets/js/model.js";
import { normaliseSpanishNif } from "../assets/js/util.js";
import * as store from "../assets/js/store.js";

const savedValues = new Map();
globalThis.localStorage = {
  getItem: (key) => savedValues.get(key) ?? null,
  setItem: (key, value) => savedValues.set(key, String(value)),
};

// Anonimizado: desorden real de las columnas del escaneo, sin datos personales/bancarios.
const fixture = `Comercial de prueba S.L.
Ci BA8481978
LOGO
Facturara
634.Empresa receptora S.L.
N°. Factura: 02005185
Dirección de ejemplo
N°. Albarán: 000000
38466 Municipio
Fecha: 14.12.22
Provincia
Vendedor: Persona de prueba
Cif. B00000000
Dirección de envio
Forma de pago: Talón
Vencimiento: 90 dias
Precio Dto. Igic. Importe
Descripción
Cdad. 1.9500 0.00 3.00 78.00
40.000
Producto agrícola 20 L
PAGADO
Entrega TOTAL
Descuento Base imp. Igic
Importe 0,00 80,34
0,00 78,00 2.34
78,00
Firma`;

test("acepta nombres legales; el símbolo @ no invalida todos los nombres", () => {
  assert.equal(parseInvoiceText("Comercial de prueba S.L.\nFactura 123\nTOTAL 80,34").supplierName,
    "Comercial de prueba S.L");
  assert.notEqual(parseInvoiceText("proveedor@example.com\nFactura 123").supplierName,
    "proveedor@example.com");
});

test("no asigna el NIF del cliente al proveedor si el OCR no reconoce el del emisor", () => {
  const doc = parseInvoiceText(fixture, { fileName: "Adobe_Scan_14_dic._2022.pdf" });
  assert.equal(doc.supplierName, "Comercial de prueba S.L");
  assert.equal(doc.supplierNif, "");
  assert.match(doc.notes.join(" "), /NIF del proveedor/);
  assert.equal(doc.number, "02005185");
  assert.equal(doc.issueDate, "2022-12-14");
});

test("recupera un CIF dañado por OCR y lo muestra en la revisión", () => {
  const scan = `COMERCIAL DE PRUEBA S.L.
CIF B1234567A
Factura: PRUEBA-2026
Cliente: EMPRESA RECEPTORA S.L.
NIF B00000000
Base imponible 100,00
IGIC 7,00
Total 107,00`;
  const review = leerDocumento(scan).doc;

  assert.equal(normaliseSpanishNif("B1234567A"), "");
  assert.equal(normaliseSpanishNif("B1234567A", { repairOcr: true }), "B12345674");
  assert.equal(normaliseSpanishNif("B12345675", { repairOcr: true }), "");
  assert.equal(review.supplierName, "COMERCIAL DE PRUEBA S.L");
  assert.equal(review.supplierNif, "B12345674");
  assert.doesNotMatch(review.notes.join(" "), /NIF del proveedor/);
});

test("deja vacío y avisa si el único NIF del emisor no pasa el control", () => {
  const doc = parseInvoiceText(`COMERCIAL DE PRUEBA S.L.
CIF B12345675
Cliente: EMPRESA RECEPTORA S.L.
NIF B00000000
Total 107,00`);
  assert.equal(doc.supplierNif, "");
  assert.match(doc.notes.join(" "), /no he podido validarlo; lo he dejado vacío/);
});

test("el NIF revisado del proveedor se conserva al restaurar el documento", async () => {
  const review = leerDocumento(`COMERCIAL DE PRUEBA S.L.
CIF B1234567A
Factura: PRUEBA-RECARGA
Cliente: EMPRESA RECEPTORA S.L.
NIF B00000000
Base imponible 100,00
IGIC 7,00
Total 107,00`).doc;
  const { invoice } = store.addInvoice(review);
  assert.equal(store.supplierById(invoice.supplierId).nif, "B12345674");

  const saved = store.exportJSON();
  assert.ok(saved.includes("B12345674"));
  const originalWarn = console.warn;
  let engine;
  console.warn = () => {};
  try {
    engine = await store.initStore();
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(engine, "local");
  const restored = store.invoiceById(invoice.id);
  assert.ok(restored);
  assert.equal(store.supplierById(restored.supplierId).nif, "B12345674");
});

test("recupera base, IGIC y total separados de las etiquetas sin usar cantidades de producto", () => {
  const doc = parseInvoiceText(fixture);
  assert.equal(doc.base, 78);
  assert.equal(doc.igic, 2.34);
  assert.equal(doc.total, 80.34);
  assert.equal(doc.rate, 3);
  assert.equal(doc.status, "PAGADO");
  assert.ok(doc.confidence <= 0.65);
  assert.match(doc.notes.join(" "), /escaneo/);
  assert.equal(recoverInvoiceSummary(["Total 80,34", "Cantidad 40,000 Precio 1,9500"]), null);
});

test("rechaza resúmenes con varias combinaciones posibles", () => {
  assert.equal(recoverInvoiceSummary(["Base imp. IGIC TOTAL",
    "78,00 2,34 80,34", "100,00 3,00 103,00"]), null);
});

test("esta factura no suma unidades de producto al control de kilos de fruta", () => {
  const doc = leerDocumento(fixture, { fileName: "scan.pdf" }).doc;
  assert.equal(doc.kind, "FACTURA");
  assert.equal(doc.total, 80.34);
  assert.equal(doc.direction, "GASTO");
  assert.equal(fruitEntries([{ ...doc, id: "scan" }]).length, 0);
});

test("la liquidación siempre se clasifica como venta incluso con un sentido antiguo erróneo", () => {
  assert.equal(invoiceDirection({ kind: "LIQUIDACION", direction: "GASTO" }), "INGRESO");
  assert.equal(invoiceDirection({ kind: "FACTURA", direction: "GASTO" }), "GASTO");
});
