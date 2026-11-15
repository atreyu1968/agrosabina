import test from "node:test";
import assert from "node:assert/strict";
import { aperturaDesdeCierre, asientosDe } from "../assets/js/accounting.js";

const cierre = [
  {
    lines: [
      { account: "572", debit: 100, credit: 0 },
      { account: "100", debit: 0, credit: 100 },
    ],
  },
  {
    lines: [
      { account: "602", debit: 30, credit: 0 },
      { account: "400", debit: 0, credit: 30 },
    ],
  },
  {
    lines: [
      { account: "430", debit: 50, credit: 0 },
      { account: "701", debit: 0, credit: 50 },
    ],
  },
];

test("traslada los saldos patrimoniales y cierra ingresos y gastos en la 121", () => {
  const lines = aperturaDesdeCierre(cierre);
  const balance = new Map(lines.map((line) => [
    line.account,
    Number((line.debit - line.credit).toFixed(2)),
  ]));

  assert.equal(balance.get("572"), 100);
  assert.equal(balance.get("100"), -100);
  assert.equal(balance.get("400"), -30);
  assert.equal(balance.get("430"), 50);
  assert.equal(balance.get("121"), -20);
  assert.equal(lines.some((line) => line.account.startsWith("6") || line.account.startsWith("7")), false);
  assert.equal(
    Number([...balance.values()].reduce((sum, amount) => sum + amount, 0).toFixed(2)),
    0
  );
});

test("el asiento de apertura por cuenta conserva el primer día del nuevo ejercicio", () => {
  const lines = aperturaDesdeCierre(cierre);
  const entries = asientosDe([], {
    from: "2026-03-01",
    to: "2026-03-31",
    apertura: { fecha: "2026-01-01", lines },
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].date, "2026-01-01");
  assert.equal(entries[0].kind, "apertura");
  assert.equal(entries[0].lines.some((line) => line.account.startsWith("6") || line.account.startsWith("7")), false);
});
