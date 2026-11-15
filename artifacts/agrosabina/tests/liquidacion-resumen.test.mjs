import test from "node:test";
import assert from "node:assert/strict";
import { leerDocumento } from "../assets/js/importers.js";
import { leerResumenLiquidacion } from "../assets/js/liquidacion-resumen.js";

// Cabecera anonimizada, misma estructura de tablas y acumulados que el documento contrastado.
const fixture = `LIQUIDACIÓN
Comercial de prueba S.A.           Empresa receptora S.L.
NIF: A00000000
Fecha Nº Liquidación Factura S/Factura
12/11/2026 3158 RE/261101280 LI/00000057
PRODUCTO AMPARADO PLATANO
Sem. Concepto Kilos Precio Importe
37 Gabaceras 474 35,22 % 0,5500 260,70
37 Super_ 425 31,58 % 0,4000 170,00
37 Primera 187 13,89 % 0,0800 14,96
37 Segunda 170 12,63 % 0,0000 0,00
37 2B 90 6,69 % 0,0000 0,00
TOTAL Semana 1.346 100,00 % 0,3311 445,66
Sem. Concepto Kilos Precio Importe
39 Gabaceras 1.000 47,89 % 0,8500 850,00
39 Super_ 799 38,27 % 0,7000 559,30
39 Primera 170 8,14 % 0,3500 59,50
39 Segunda 119 5,70 % 0,0000 0,00
TOTAL Semana 2.088 100,00 % 0,7034 1.468,80
Concepto Kilos Precio Importe
Gabaceras 1.474 42,92 % 0,7535 1.110,70
Super_ 1.224 35,64 % 0,5958 729,30
Primera 357 10,40 % 0,2086 74,46
Segunda 289 8,42 % 0,0000 0,00
2B 90 2,62 % 0,0000 0,00
TOTAL Liquidación 3.434 100,00 % 0,5575 1.914,46
Importe base: 1.914,46
Igic 0,00 % 1.914,46 0,00
Total: 1.914,46`;

test("usa sólo el resumen final, no mezcla kilos con semanas ni porcentajes", () => {
  const summary = leerResumenLiquidacion(fixture);
  assert.equal(summary.kg, 3434);
  assert.equal(summary.price, 0.5575);
  assert.equal(summary.gross, 1914.46);
  assert.equal(summary.net, 1914.46);
  assert.equal(summary.partidas.length, 5);
  assert.deepEqual(summary.partidas.map((p) => p.kg), [1474, 1224, 357, 289, 90]);
  assert.deepEqual(summary.partidas.map((p) => p.gross), [1110.7, 729.3, 74.46, 0, 0]);
  assert.equal(summary.partidas.reduce((s, p) => s + p.kg, 0), 3434);
});

test("el importador conserva identificador, emisor, precisión, IGIC y categorías", () => {
  const doc = leerDocumento(fixture, { fileName: "documento.pdf" }).doc;
  assert.equal(doc.kind, "LIQUIDACION");
  assert.equal(doc.direction, "INGRESO");
  assert.equal(doc.number, "3158");
  assert.equal(doc.supplierName, "Comercial de prueba S.A.");
  assert.equal(doc.issueDate, "2026-11-12");
  assert.equal(doc.base, 1914.46);
  assert.equal(doc.total, 1914.46);
  assert.equal(doc.igic, 0);
  assert.equal(doc.rate, 0);
  assert.equal(doc.liquidacion.price, 0.5575);
  assert.equal(doc.liquidacion.partidas.length, 5);
  assert.equal(doc.liquidacion.category, "");
});

test("advierte si el resumen no cuadra; no sustituye el total impreso por una suma errónea", () => {
  const result = leerResumenLiquidacion(fixture.replace("Gabaceras 1.474", "Gabaceras 1.400"));
  assert.equal(result.kg, 3434);
  assert.match(result.notes.join(" "), /categorías del resumen no coinciden/);
});

test("no aplica el lector de resumen si no existe TOTAL Liquidación", () => {
  assert.equal(leerResumenLiquidacion("Liquidación\n1240 kg\nPrecio/kg 0,853\nBruto 1057,72"), null);
});
