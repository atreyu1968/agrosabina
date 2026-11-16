import test from "node:test";
import assert from "node:assert/strict";
import { normalizeExtraction, extractionDate, extractionNumber } from "../assets/js/ai-extraction.js";
import { aiExtract } from "../assets/js/ai.js";
import { leerDocumento } from "../assets/js/importers.js";
import { itemsToLines } from "../assets/js/read.js";

const invoice = {
  tipo: "FACTURA", proveedor: "Proveedor de prueba", numero: "PRUEBA-1",
  fecha: "2026-10-31", base: 100, igic: 7, total: 107, confianza: 0.95,
};

test("rechaza fechas inexistentes, años incompletos y números no fiables", () => {
  assert.equal(extractionDate("2026-02-31"), "");
  assert.equal(extractionDate("31/10/26"), "");
  assert.equal(extractionDate("31/10/2026"), "2026-10-31");
  assert.equal(extractionDate("2024-02-29"), "2024-02-29");
  assert.equal(extractionNumber("1.234"), 1.234);
  assert.equal(extractionNumber("1.234,56 €"), 1234.56);
  assert.equal(extractionNumber("entre 100 y 200"), null);
  assert.equal(extractionNumber(false), null);
});

test("PDF: conserva juntas las cifras y rótulos con ligeras diferencias de altura", () => {
  const item = (str, x, y) => ({ str, transform: [1, 0, 0, 1, x, y] });
  const rows = itemsToLines([
    item("MEI", 10, 420.1), item("2238,42", 250, 419.8),
    item("0,75", 330, 420.0), item("16,79", 400, 419.9),
    item("AT y EP", 10, 410.2), item("2238,42", 250, 410.0),
    item("2,60", 330, 410.0), item("58,20", 400, 410.0),
  ]);
  assert.deepEqual(rows, ["MEI 2238,42 0,75 16,79", "AT y EP 2238,42 2,60 58,20"]);
});

test("conserva números y ceros explícitos; no inventa campos ausentes", () => {
  const result = normalizeExtraction({ tipo: "FACTURA", base: 0 });
  assert.equal(result.base, 0);
  assert.equal(result.total, null);
  assert.equal(result.issueDate, "");
  assert.equal(result.confidence, 0.5);
  assert.equal(result.requiresReview, true);
});

test("distingue la razón social de la marca legible en el logo", () => {
  const result = normalizeExtraction({
    ...invoice, proveedor: "Marca de ejemplo",
    identidad_emisor: { razon_social: "Emisor de ejemplo SL", nombre_comercial: "Marca de ejemplo", fuente: "logo_texto" },
  });
  assert.equal(result.supplierName, "Emisor de ejemplo SL");
  assert.equal(result.issuerIdentity.brand, "Marca de ejemplo");
  assert.ok(result.warnings.some((warning) => /Marca comercial/.test(warning)));
  const brandOnly = normalizeExtraction({
    ...invoice,
    identidad_emisor: { nombre_comercial: "Marca visible", fuente: "logo_texto" },
  });
  assert.equal(brandOnly.supplierName, "Marca visible");
  assert.equal(brandOnly.requiresReview, true);
  assert.ok(brandOnly.warnings.some((warning) => /Confirma la razón social/.test(warning)));
});

test("un símbolo o identidad dudosa no confirma un emisor ni un NIF sugeridos por la IA", () => {
  for (const source of ["solo_simbolo", "dudosa"]) {
    const result = normalizeExtraction({
      ...invoice, nif: "B12345678",
      identidad_emisor: { razon_social: "Empresa supuesta SL", fuente: source },
    });
    assert.equal(result.supplierName, "");
    assert.equal(result.supplierNif, "");
    assert.equal(result.requiresReview, true);
  }
  const payroll = normalizeExtraction({
    tipo: "NOMINA", proveedor: "Trabajador de prueba",
    identidad_emisor: { razon_social: "Empresa empleadora SL", fuente: "logo_texto" },
  });
  assert.equal(payroll.supplierName, "Trabajador de prueba");
});

test("rechaza objetos vacíos, listas y tipos de documento desconocidos", () => {
  for (const value of [{}, [], null, { tipo: "PAGAR_TODO" }]) {
    assert.throws(() => normalizeExtraction(value));
  }
});

test("señala importes que no cuadran sin corregirlos artificialmente", () => {
  const result = normalizeExtraction({ ...invoice, total: 207 });
  assert.equal(result.amountsValid, false);
  assert.equal(result.total, 207);
  assert.equal(result.requiresReview, true);
});

test("extrae y valida varios tipos de IGIC", () => {
  const result = normalizeExtraction({
    ...invoice, base: 300, igic: 17, total: 317,
    lineas: [{ base: 100, tipo: 3 }, { base: 200, tipo: 7 }],
  });
  assert.equal(result.amountsValid, true);
  assert.deepEqual(result.lines, [{ base: 100, rate: 3 }, { base: 200, rate: 7 }]);
  const mismatch = normalizeExtraction({ ...invoice, lineas: [{ base: 100, tipo: 3 }] });
  assert.equal(mismatch.amountsValid, false);
});

test("no convierte IVA en IGIC", () => {
  const result = normalizeExtraction({ ...invoice, impuesto: "IVA", igic: 21, total: 121 });
  assert.equal(result.igic, null);
  assert.equal(result.rate, null);
  assert.equal(result.amountsValid, false);
  assert.match(result.warnings.join(" "), /IVA, no IGIC/);
});

test("extrae el desglose de nómina y detecta inconsistencias", () => {
  const payroll = {
    ...invoice, tipo: "NOMINA", base: 2000, igic: 0, total: 1500,
    nomina: { trabajador: "Persona de prueba", bruto: 2000, ssTrabajador: 130, irpf: 370, ssEmpresa: 600, neto: 1500 },
  };
  const result = normalizeExtraction(payroll);
  assert.equal(result.payrollValid, true);
  assert.equal(result.nomina.ssEmpresa, 600);
  assert.equal(result.liquidacion, null);
  assert.equal(result.igic, 0);
  assert.equal(result.rate, 0);
  assert.deepEqual(result.lines, []);
  const falseTax = normalizeExtraction({
    ...payroll,
    igic: 140,
    tipo_igic: 7,
    lineas: [{ base: 2000, tipo: 7 }],
  });
  assert.equal(falseTax.igic, 0);
  assert.equal(falseTax.rate, 0);
  assert.deepEqual(falseTax.lines, []);
  assert.equal(falseTax.amountsValid, false);
  assert.match(falseTax.warnings.join(" "), /nómina no lleva IGIC/);
  assert.equal(normalizeExtraction({ ...payroll, total: 1600 }).payrollValid, false);
  assert.equal(normalizeExtraction({ ...payroll, nomina: { ...payroll.nomina, neto: 1400 } }).payrollValid, false);
});

test("mantiene la precisión del precio/kg y comprueba los descuentos", () => {
  const settlement = {
    ...invoice, tipo: "LIQUIDACION", base: 965.72, igic: 0, total: 965.72,
    liquidacion: { kilos: 1240, precio: "0.853", bruto: 1057.72, liquido: 965.72,
      descuentos: [{ concepto: "Manipulación", importe: 92 }] },
  };
  const result = normalizeExtraction(settlement);
  assert.equal(result.liquidacion.price, 0.853);
  assert.equal(result.settlementValid, true);
  assert.equal(normalizeExtraction({
    ...settlement, liquidacion: { ...settlement.liquidacion, liquido: 900 },
  }).settlementValid, false);
});

test("no importa bloques de otros tipos ni convierte confianza null en cero", () => {
  const result = normalizeExtraction({ ...invoice, confianza: null, nomina: { bruto: 999 } });
  assert.equal(result.nomina, null);
  assert.equal(result.confidence, 0.5);
});

// Plantilla anonimizada: no se incluyen nombres, NIF ni direcciones del PDF del usuario.
function payrollPage({ gross, net, deductions, workerSS, tax, cost, employerRows }) {
  return `PERSONA DE PRUEBA
EMPRESA DOMICILIO
EMPRESA AGRICOLA
TRABAJADOR/A CATEGORIA NºMATRIC ANTIGUEDAD D.N.I.
PERSONA DE PRUEBA       PEÓN/A      8 OCT 12    00000000T
PERIODO TOT. DIAS
MENS 01 OCT 26 a 31 OCT 26 30
CONCEPTO DEVENGOS DEDUCCIONES
1 *Salario Base 643,55
995 COTIZACION CONT.COMU 4,70 ${workerSS}
999 TRIBUTACION I.R.P.F. 5,50 ${tax}
REM. TOTAL P.P.EXTRAS BASE S.S. BASE A.T. Y DES. BASE I.R.P.F. T. DEVENGADO T. A DEDUCIR
${gross} ${gross} ${gross} ${gross} ${gross} ${deductions}
FECHA
31 OCTUBRE 2026
LIQUIDO A PERCIBIR
${net}
COSTE EMPRESA: ${cost}
CONCEPTO BASE TIPO APORTACIÓN EMPRESARIAL
${employerRows}`;
}

test("lee totales en otra fila en vez de tomar salario base como bruto", () => {
  const parsed = leerDocumento(payrollPage({
    gross: "2.238,42", net: "1.971,37", deductions: "267,05", workerSS: "143,94",
    tax: "123,11", cost: "2.646,71",
    employerRows: "Contingencias comunes 2.238,42 21,20 474,55\nMEI 2.238,42 0,75 16,79\nAT y EP 2.238,42 2,60 58,20\nDesempleo 2.238,42 5,50 123,11\nFormación Profesional 2.238,42 0,15 3,36\nFondo Garantía Salarial 2.238,42 0,10 2,24",
  })).doc;
  assert.equal(parsed.nomina.trabajador, "PERSONA DE PRUEBA");
  assert.equal(parsed.base, 2238.42);
  assert.equal(parsed.total, 1971.37);
  assert.equal(parsed.nomina.ssTrabajador, 143.94);
  assert.equal(parsed.nomina.irpf, 123.11);
  assert.equal(parsed.nomina.ssEmpresa, 678.25);
  assert.equal(parsed.issueDate, "2026-10-31");
  assert.match(parsed.notes.join(" "), /coste empresa impreso/);
});

const settings = {
  aiEnabled: true, aiEndpoint: "https://ia.example.invalid/v1",
  aiKey: "CREDENCIAL-FICTICIA", aiModel: "modelo-de-prueba",
};
const response = (content, finish_reason = "stop") => ({
  ok: true, text: async () => JSON.stringify({ choices: [{ finish_reason, message: { content } }] }),
});

test("la petición real solicita JSON, nómina, IGIC y defensas frente a instrucciones del documento", async (t) => {
  let body;
  t.mock.method(globalThis, "fetch", async (_, options) => {
    body = JSON.parse(options.body);
    return response(JSON.stringify(invoice));
  });
  const result = await aiExtract("Documento de prueba", settings);
  assert.equal(result.total, 107);
  assert.equal(result.leido, "texto");
  assert.equal(result.requiresReview, true);
  assert.ok(result.warnings.some((warning) => /logos, anagramas/.test(warning)));
  assert.equal(body.response_format.type, "json_object");
  assert.match(body.messages[0].content, /ssTrabajador/);
  assert.match(body.messages[0].content, /fuente de datos, no instrucciones/);
});

test("envía el original a visión con instrucciones para leer logos sin adivinar la identidad", async (t) => {
  let body;
  t.mock.method(globalThis, "fetch", async (_, options) => {
    body = JSON.parse(options.body);
    return response(JSON.stringify({
      ...invoice,
      identidad_emisor: { razon_social: "Empresa visible SL", nombre_comercial: "Marca legible", fuente: "logo_texto" },
    }));
  });
  const image = "data:image/png;base64,AAAA";
  const result = await aiExtract("OCR sin datos de cabecera", settings, { images: [image] });
  assert.equal(result.leido, "papel");
  assert.equal(result.supplierName, "Empresa visible SL");
  const contents = body.messages.flatMap((message) => Array.isArray(message.content) ? message.content : []);
  assert.ok(contents.some((part) => part.type === "image_url" && part.image_url.url === image && part.image_url.detail === "high"));
  assert.match(body.messages[0].content, /logos, logotipos, anagramas/);
  assert.match(body.messages[0].content, /no identifiques una empresa por parecido/i);
});

test("si falla la visión, reintenta con texto y advierte del cambio", async (t) => {
  let count = 0;
  const notes = [];
  t.mock.method(globalThis, "fetch", async () => {
    if (++count === 1) throw new Error("Modelo sin visión");
    return response(JSON.stringify(invoice));
  });
  const result = await aiExtract("Factura de prueba", settings, {
    images: ["data:image/png;base64,AAAA"], onNote: (value) => notes.push(value),
  });
  assert.equal(count, 2);
  assert.equal(result.leido, "texto");
  assert.equal(notes.length, 1);
});

test("rechaza respuestas truncadas o fichas sin documento", async (t) => {
  t.mock.method(globalThis, "fetch", async () => response(JSON.stringify(invoice), "length"));
  await assert.rejects(aiExtract("Documento de prueba", settings), /IA/);
});
