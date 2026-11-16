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

  assert.equal(balance.get("572000"), 100);
  assert.equal(balance.get("100000"), -100);
  assert.equal(balance.get("400000"), -30);
  assert.equal(balance.get("430000"), 50);
  assert.equal(balance.get("121000"), -20);
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

test("el asiento de apertura admite saldos manuales equilibrados en cuentas de seis cifras", () => {
  const entries = asientosDe([], {
    from: "2026-01-01",
    to: "2026-12-31",
    apertura: {
      lines: [
        { account: "572000", debit: 1000, credit: 0 },
        { account: "211001", debit: 2000, credit: 0 },
        { account: "100000", debit: 0, credit: 3000 },
      ],
    },
  });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].date, "2026-01-01");
  assert.equal(entries[0].kind, "apertura");
  assert.deepEqual(entries[0].lines.map((line) => line.account), ["572000", "211001", "100000"]);
  assert.equal(entries[0].total, 3000);
});

test("traslada facturas pendientes y las cancela al cobrarlas o pagarlas en el ejercicio siguiente", () => {
  const invoices = [
    {
      id: "venta-pendiente",
      number: "V-2025-01",
      kind: "LIQUIDACION",
      issueDate: "2025-12-15",
      status: "PAGADO",
      paidDate: "2026-01-10",
      base: 150,
      igic: 10,
      total: 160,
    },
    {
      id: "compra-pendiente",
      number: "C-2025-01",
      kind: "FACTURA",
      issueDate: "2025-12-20",
      status: "PAGADO",
      paidDate: "2026-01-12",
      base: 100,
      igic: 7,
      total: 107,
    },
  ];
  const closingEntries = asientosDe(invoices, {
    from: "2025-01-01",
    to: "2025-12-31",
  });
  const openingLines = aperturaDesdeCierre(closingEntries);
  const opening = new Map(openingLines.map((line) => [
    line.account,
    Number((line.debit - line.credit).toFixed(2)),
  ]));

  assert.equal(opening.get("430000"), 160);
  assert.equal(opening.get("400000"), -107);
  assert.equal(
    openingLines.some((line) => line.account.startsWith("6") || line.account.startsWith("7")),
    false
  );

  const newYearEntries = asientosDe(invoices, {
    from: "2026-01-01",
    to: "2026-12-31",
    apertura: { fecha: "2026-01-01", lines: openingLines },
  });
  const newYearBalances = new Map();
  for (const entry of newYearEntries) {
    for (const line of entry.lines) {
      const saldo = (newYearBalances.get(line.account) || 0) + line.debit - line.credit;
      newYearBalances.set(line.account, Number(saldo.toFixed(2)));
    }
  }

  assert.deepEqual(
    newYearEntries.map((entry) => entry.kind).sort(),
    ["apertura", "cobro", "pago"]
  );
  assert.equal(newYearBalances.get("430000"), 0);
  assert.equal(newYearBalances.get("400000"), 0);
  assert.equal(newYearBalances.get("572000"), 53);
  assert.equal(
    newYearEntries.find((entry) => entry.kind === "apertura").lines.some(
      (line) => line.account.startsWith("6") || line.account.startsWith("7")
    ),
    false
  );
  assert.equal(
    newYearEntries.some((entry) => entry.lines.some(
      (line) => line.account.startsWith("6") || line.account.startsWith("7")
    )),
    false
  );
});
