import test from "node:test";
import assert from "node:assert/strict";
import { lineas } from "../assets/js/accounting.js";
import { normalizarCodigoCuenta, PGC_CUENTAS, pgcNombre, pgcTiene } from "../assets/js/pgc.js";

test("el plan presenta todas sus cuentas con seis cifras y sin duplicados", () => {
  const codes = PGC_CUENTAS.map((account) => account.code);
  assert.ok(codes.length > 200);
  assert.ok(codes.every((code) => /^\d{6}$/.test(code)));
  assert.equal(new Set(codes).size, codes.length);
});

test("normaliza códigos antiguos y conserva las subcuentas de seis cifras", () => {
  assert.equal(normalizarCodigoCuenta("430"), "430000");
  assert.equal(normalizarCodigoCuenta("4751"), "475100");
  assert.equal(normalizarCodigoCuenta("430001"), "430001");
  assert.equal(normalizarCodigoCuenta("cuenta"), "");
});

test("los asientos muestran seis cifras aunque reciban códigos antiguos", () => {
  const entryLines = lineas([["572", 120], ["100", -120]]);
  assert.deepEqual(entryLines.map((line) => line.account), ["572000", "100000"]);
  assert.ok(entryLines.every((line) => /^\d{6}$/.test(line.account)));
});

test("el PGC reconoce las cuentas base y las subcuentas con seis cifras", () => {
  assert.equal(pgcNombre("430000"), "Clientes");
  assert.equal(pgcNombre("430001"), "Clientes");
  assert.equal(pgcTiene("430001"), true);
  assert.equal(pgcNombre("170000"), "Préstamos bancarios a largo plazo");
});
