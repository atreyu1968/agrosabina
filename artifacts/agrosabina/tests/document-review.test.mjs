import test from "node:test";
import assert from "node:assert/strict";
import { DOCUMENT_REVIEW_SPECS, documentReviewSpec, isolateDocumentKind, originalPreviewHtml } from "../assets/js/document-review.js";
import { importadoresDisponibles, leerDocumento } from "../assets/js/importers.js";

test("cada importador registrado dispone de su ficha de revisión específica", () => {
  for (const importer of importadoresDisponibles()) {
    for (const kind of importer.tipos) {
      assert.ok(DOCUMENT_REVIEW_SPECS[kind], `Falta la ficha de ${kind}`);
      assert.ok(documentReviewSpec(kind).number);
      assert.ok(documentReviewSpec(kind).party);
    }
  }
});

test("el tipo elegido manda sobre la clasificación automática y se avisa de discrepancias", () => {
  const lectura = leerDocumento("Factura proveedor de pruebas. Base imponible 100,00. Total 107,00.", { tipo: "NOMINA" });
  assert.equal(lectura.forzado, true);
  assert.equal(lectura.doc.kind, "NOMINA");
  assert.equal(lectura.doc.igic, 0);
  assert.ok(lectura.doc.notes.length);
  assert.equal(lectura.doc.total, null);
  assert.equal(lectura.doc.supplierName, "");
  assert.equal(lectura.doc.issueDate, "");
});

test("elegir liquidación para una nómina no convierte el líquido salarial en kilos", () => {
  const lectura = leerDocumento("RECIBO DE SALARIOS\nTrabajador: Persona Prueba\nSalario bruto: 2000,00\nSeguridad Social trabajador: 130,00\nIRPF: 200,00\nLíquido a percibir: 1670,00", { tipo: "LIQUIDACION" });
  assert.equal(lectura.forzado, true);
  assert.equal(lectura.reconoce, false);
  assert.equal(lectura.doc.kind, "LIQUIDACION");
  assert.equal(lectura.doc.liquidacion, null);
  assert.equal(lectura.doc.base, null);
  assert.equal(lectura.doc.total, null);
  assert.match(lectura.doc.notes.join(" "), /vacíos por seguridad/);
});

test("la nómina con rótulos de salario bruto y seguridad social trabajador conserva los importes", () => {
  const lectura = leerDocumento("RECIBO DE SALARIOS\nTrabajador: Persona Prueba\nSalario bruto: 2000,00\nSeguridad Social trabajador: 130,00\nIRPF: 200,00\nLíquido a percibir: 1670,00", { tipo: "NOMINA" });
  assert.equal(lectura.doc.nomina.bruto, 2000);
  assert.equal(lectura.doc.nomina.ssTrabajador, 130);
  assert.equal(lectura.doc.nomina.irpf, 200);
  assert.equal(lectura.doc.nomina.neto, 1670);
});

test("las fichas de nómina y liquidación nunca comparten sus bloques", () => {
  const mixed = {
    kind: "LIQUIDACION", direction: "INGRESO", rate: 7, igic: 7,
    nomina: { bruto: 100, neto: 90 }, nominaRead: {},
    liquidacion: { kg: 500, price: 1.5 }, liquidacionRead: {},
    lines: [{ base: 100, rate: 7 }],
  };
  const nomina = isolateDocumentKind(mixed, "NOMINA");
  assert.equal(nomina.kind, "NOMINA");
  assert.equal(nomina.direction, "GASTO");
  assert.equal(nomina.liquidacion, null);
  assert.equal(nomina.liquidacionRead, undefined);
  assert.equal(nomina.igic, 0);
  assert.equal(nomina.rate, 0);
  assert.deepEqual(nomina.lines, []);
  const liquidacion = isolateDocumentKind(mixed, "LIQUIDACION");
  assert.equal(liquidacion.direction, "INGRESO");
  assert.equal(liquidacion.nomina, null);
  assert.equal(liquidacion.nominaRead, undefined);
  for (const kind of ["FACTURA", "SUBVENCION", "COBRO", "OTRO"]) {
    const result = isolateDocumentKind(mixed, kind);
    assert.equal(result.nomina, null);
    assert.equal(result.liquidacion, null);
  }
  assert.ok(mixed.nomina);
  assert.ok(mixed.liquidacion);
});

test("el visor muestra las páginas del PDF, imágenes y texto sin ejecutar HTML del documento", () => {
  assert.match(originalPreviewHtml({ file: { name: "factura.pdf" }, pages: [3] }, "blob:test"), /data-page="3"/);
  assert.match(originalPreviewHtml({ file: { name: "foto.jpg" } }, "blob:test"), /<img /);
  assert.ok(!originalPreviewHtml({ text: "<script>alert(1)</script>" }, "").includes("<script>"));
});

test("cobros y ayudas usan un importe sin trasladar IGIC de una lectura de factura", () => {
  for (const kind of ["COBRO", "SUBVENCION"]) {
    const result = isolateDocumentKind({
      total: 100, base: 93.46, igic: 6.54, rate: 7, lines: [{ base: 93.46, rate: 7 }],
    }, kind);
    assert.equal(result.total, 100);
    assert.equal(result.base, 100);
    assert.equal(result.igic, 0);
    assert.equal(result.rate, 0);
    assert.deepEqual(result.lines, []);
    assert.match(result.notes.join(" "), /descartado el IGIC/);
  }
});
