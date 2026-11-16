import test from "node:test";
import assert from "node:assert/strict";
import { isPurchaseExpense, invoiceDirection } from "../assets/js/model.js";

test("las nóminas son gastos de personal y no aparecen como compras", () => {
  const payroll = { kind: "NOMINA", direction: "GASTO" };
  assert.equal(invoiceDirection(payroll), "GASTO");
  assert.equal(isPurchaseExpense(payroll), false);
  assert.equal(isPurchaseExpense({ kind: "FACTURA" }), true);
  assert.equal(isPurchaseExpense({ kind: "PRESTAMO" }), false);
  assert.equal(isPurchaseExpense({ kind: "LIQUIDACION" }), false);
});
