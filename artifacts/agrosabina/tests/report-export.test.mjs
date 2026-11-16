import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { reportMatrix, reportPdf, reportXls } from "../assets/js/report-export.js";
import { informeBalancePdf, informeResultadosPdf, balanceAsOfWindow } from "../assets/js/reports.js";
import { cuenta } from "../assets/js/accounting.js";

const fixture = {
  filename: "informe-prueba", title: "Prueba de informe", period: "2026-01-01 — 2026-12-31",
  filters: "Solo documentos pendientes",
  headers: ["Fecha", "Cuenta", "NIF", "Referencia", "Debe", "Haber", "Concepto"],
  rows: [
    ["2026-01-01", "001700", "B00000001", "0000123", "1.234,56", "0,00", "=SUM(A1:A2)"],
    ["2026-12-31", "520001", "B00000002", "0000124", "-42,50", "", "Revisión del emisor"],
  ],
};

test("tipa los importes y conserva ceros iniciales, referencias y campos vacíos", () => {
  const rows = reportMatrix(fixture);
  assert.equal(rows[0][1], "001700");
  assert.equal(rows[0][3], "0000123");
  assert.equal(rows[0][4], 1234.56);
  assert.equal(rows[0][5], 0);
  assert.equal(rows[1][4], -42.5);
  assert.equal(rows[1][5], "");
});

test("genera XLS binario real con cifras numéricas, metadatos y texto que no se ejecuta como fórmula", async () => {
  const original = JSON.stringify(fixture);
  const result = await reportXls(fixture);
  assert.equal(result.filename, "informe-prueba.xls");
  assert.deepEqual([...new Uint8Array(result.bytes).slice(0, 8)], [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  const book = XLSX.read(result.bytes, { type: "array", cellNF: true });
  assert.deepEqual(book.SheetNames, ["Informe", "Información"]);
  const sheet = book.Sheets.Informe;
  assert.equal(sheet.E2.t, "n");
  assert.equal(sheet.E2.v, 1234.56);
  assert.equal(sheet.B2.t, "s");
  assert.equal(sheet.B2.v, "001700");
  assert.equal(sheet.D2.v, "0000123");
  assert.equal(sheet.G2.v, "=SUM(A1:A2)");
  assert.equal(sheet.G2.f, undefined);
  assert.equal(book.Sheets.Información.B3.v, fixture.period);
  assert.equal(book.Sheets.Información.B4.v, fixture.filters);
  assert.equal(JSON.stringify(fixture), original);
});

test("PDF paginado con cabeceras, importes y continuación de textos largos", () => {
  const result = reportPdf({
    ...fixture,
    rows: Array.from({ length: 150 }, (_, index) => [
      "2026-01-01", "170001", "B00000001", String(index), "123,45", "0,00",
      index === 149 ? "AVISO MUY LARGO ".repeat(20) + "FINDELAVISO" : `Concepto ${index}`,
    ]),
  });
  const pdf = new TextDecoder("latin1").decode(result.bytes);
  assert.ok(pdf.startsWith("%PDF-1.4"));
  assert.ok((pdf.match(/\/Type \/Page\b/g) || []).length > 1);
  assert.match(pdf, /123,45/);
  // A final unique marker must survive wrapping across physical rows.
  assert.match(pdf.replaceAll(/[^A-Z]/g, ""), /FINDELAVISO/);
  assert.match(pdf, /Horario de Canarias/);
  const pageCount = (pdf.match(/\/Type \/Page\b/g) || []).length;
  const pageNumbers = [...pdf.matchAll(/Página (\d+) de \d+/g)].map((match) => Number(match[1])).sort((a, b) => a - b);
  assert.deepEqual(pageNumbers, Array.from({ length: pageCount }, (_, index) => index + 1));
});

test("los índices anchos mantienen todas las columnas en el PDF", () => {
  const result = reportPdf({
    ...fixture, headers: Array.from({ length: 15 }, (_, i) => `Columna${i}`),
    rows: [Array.from({ length: 15 }, (_, i) => `DATOCOLUMNA${i}`)],
  });
  const pdf = new TextDecoder("latin1").decode(result.bytes);
  for (let i = 0; i < 15; i++) assert.ok(pdf.includes(`DATOCOLUMNA${i}`));
});

test("el PDF del balance muestra cuentas bajo el epígrafe contable correcto", () => {
  const mayor = [
    { code: "572", name: "Banco de prueba", saldo: 1000, moves: [{ debit: 1000, credit: 0 }] },
    { code: "100", name: "Capital social", saldo: -700, moves: [{ debit: 0, credit: 700 }] },
    { code: "600", name: "Compras", saldo: 200, moves: [{ debit: 200, credit: 0 }] },
    { code: "700", name: "Ventas", saldo: -500, moves: [{ debit: 0, credit: 500 }] },
  ];
  const result = informeBalancePdf(mayor, { from: "2026-01-01", to: "2026-12-31" });
  const pdf = new TextDecoder("latin1").decode(result.bytes);
  assert.ok(pdf.includes("Banco de prueba"));
  assert.ok(pdf.includes("Capital social"));
  assert.ok(pdf.includes("saldo acumulado"));
  assert.ok(pdf.includes("inicio del ejercicio"));
});

test("el PDF de pérdidas y ganancias envuelve los epígrafes largos y muestra fechas españolas", () => {
  const mayor = [
    { code: "600", name: "Compras", saldo: 20, moves: [] },
    { code: "700", name: "Ventas", saldo: -100, moves: [] },
  ];
  const result = informeResultadosPdf(mayor, { from: "2026-01-01", to: "2026-12-31" });
  const pdf = new TextDecoder("latin1").decode(result.bytes);
  assert.ok(pdf.includes("fabricación"));
  assert.ok(pdf.includes("Del 01/01/2026 al 31/12/2026"));
});

test("el balance ignora el filtro Desde y acumula desde enero hasta la fecha de corte", () => {
  assert.deepEqual(
    balanceAsOfWindow({ from: "2026-10-01", to: "2026-12-15" }, 2026),
    { from: "2026-01-01", to: "2026-12-15" },
  );
});

test("las subcuentas habituales conservan su epígrafe de balance", () => {
  const expected = {
    "100001": "PN_I",
    "113001": "PN_III",
    "130001": "PN_A3",
    "170001": "PNC_II",
    "200001": "AN_I",
    "280001": "AN_I",
    "281001": "AN_II",
    "242001": "AN_IV",
    "252001": "AN_V",
    "460001": "AC_III",
    "465001": "PC_V",
    "480001": "AC_VI",
    "485001": "PC_VI",
    "491001": "AC_III",
    "530001": "AC_IV",
    "540001": "AC_V",
    "520001": "PC_III",
  };
  for (const [code, key] of Object.entries(expected)) {
    assert.equal(cuenta(code).balance, key, `${code} debe ir a ${key}`);
  }
});

test("avisa si no hay datos y rechaza exceder el límite de XLS sin truncar filas", async () => {
  assert.throws(() => reportPdf({ ...fixture, rows: [] }), /No hay datos/);
  await assert.rejects(reportXls({ ...fixture, rows: [] }), /No hay datos/);
  await assert.rejects(reportXls({ ...fixture, rows: Array(65536).fill(fixture.rows[0]) }), /65.535/);
});
