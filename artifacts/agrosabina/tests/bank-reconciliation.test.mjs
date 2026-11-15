import test from "node:test";
import assert from "node:assert/strict";

import { classifyRail, parseBankStatement, statementFingerprint, suggestBankMatches } from "../assets/js/bank-reconciliation.js";

test("lee CSV español con cargos, abonos y distingue tarjeta de transferencia", () => {
  const rows = parseBankStatement(
    "Fecha;Concepto;Importe\n12/03/2026;Transferencia factura 24;-1.234,56\n13/03/2026;Pago con tarjeta TPV;-18,50\n14/03/2026;Liquidación recibida;350,00\n",
    "extracto.csv"
  );
  assert.equal(rows.length, 3);
  assert.equal(rows[0].date, "2026-03-12");
  assert.equal(rows[0].amount, -1234.56);
  assert.equal(rows[0].rail, "TRANSFERENCIA");
  assert.equal(rows[1].rail, "TARJETA");
  assert.equal(rows[2].amount, 350);
});

test("interpreta las columnas Debe y Haber como movimientos con signo", () => {
  const rows = parseBankStatement(
    "Fecha;Concepto;Debe;Haber\n12/03/2026;Pago proveedor;100,00;\n13/03/2026;Cobro cliente;;225,50\n",
    "debe-haber.csv"
  );
  assert.deepEqual(rows.map((row) => row.amount), [-100, 225.5]);
});

test("lee movimientos OFX y referencia bancaria", () => {
  const rows = parseBankStatement(
    "<OFX><BANKTRANLIST><STMTTRN><TRNTYPE>DEBIT\n<DTPOSTED>20260312120000\n<TRNAMT>-82.40\n<FITID>op-77\n<NAME>FERTILIZANTES NORTE\n<MEMO>TARJETA\n<STMTTRN><TRNTYPE>CREDIT\n<DTPOSTED>20260313120000\n<TRNAMT>200\n<FITID>op-78\n<NAME>COOPERATIVA\n</BANKTRANLIST></OFX>",
    "cuenta.ofx"
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].date, "2026-03-12");
  assert.equal(rows[0].amount, -82.4);
  assert.equal(rows[0].reference, "op-77");
  assert.equal(rows[0].rail, "TARJETA");
  assert.equal(rows[1].amount, 200);
});

test("lee movimientos QIF y conserva el beneficiario y referencia", () => {
  const rows = parseBankStatement(
    "!Type:Bank\nD14/03/2026\nT-48,90\nPFERRETERIA\nMCOMPRA 91\nNREF-91\n^\n",
    "cuenta.qif"
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, "2026-03-14");
  assert.equal(rows[0].amount, -48.9);
  assert.match(rows[0].description, /FERRETERIA/);
  assert.equal(rows[0].reference, "REF-91");
});

test("propone coincidencias exactas de importe y dirección sin casar dos veces", () => {
  const invoices = [
    { id: "i1", number: "FAC-024", issueDate: "2026-03-01", dueDate: "2026-03-15", total: 1234.56, status: "PENDIENTE", kind: "FACTURA", supplierId: "s1" },
    { id: "i2", number: "FAC-025", issueDate: "2026-03-01", dueDate: "2026-03-15", total: 1234.56, status: "PENDIENTE", kind: "FACTURA", supplierId: "s2" },
    { id: "i3", number: "LIQ-01", issueDate: "2026-03-01", total: 1234.56, status: "PENDIENTE", kind: "LIQUIDACION", supplierId: "s3" },
  ];
  const movement = {
    id: "m1",
    date: "2026-03-12",
    amount: -1234.56,
    description: "Transferencia COOPERATIVA FAC-024",
    reference: "FAC-024",
    status: "PENDIENTE",
  };
  const [result] = suggestBankMatches([movement], invoices, [
    { id: "s1", name: "Cooperativa" },
    { id: "s2", name: "Otro proveedor" },
    { id: "s3", name: "Comprador" },
  ]);
  assert.equal(result.suggestion.invoiceId, "i1");
  assert.equal(result.suggestion.highConfidence, true);
  assert.equal(result.suggestion.alternatives.length, 2);
});

test("no propone movimientos de ingreso para facturas de gasto ni inventa formato", () => {
  const invoice = { id: "i1", number: "FAC-1", issueDate: "2026-03-12", total: 100, status: "PENDIENTE", kind: "FACTURA", supplierId: "s1" };
  const [result] = suggestBankMatches([{ date: "2026-03-12", amount: 100, description: "Abono recibido", status: "PENDIENTE" }], [invoice], []);
  assert.equal(result.suggestion, null);
  const [partial] = suggestBankMatches([{ date: "2026-03-12", amount: -99.99, description: "Pago parcial", status: "PENDIENTE" }], [invoice], []);
  assert.equal(partial.suggestion, null);
  assert.throws(() => parseBankStatement("fecha,concepto,importe", "extracto.pdf"), /CSV, OFX o QIF/);
});

test("la huella del movimiento distingue cuentas bancarias", () => {
  const movement = { date: "2026-03-14", amount: -48.9, description: "FERTILIZANTES", reference: "REF-91" };
  assert.notEqual(statementFingerprint({ ...movement, account: "Cuenta A" }), statementFingerprint({ ...movement, account: "Cuenta B" }));
});

test("no adivina tarjeta o transferencia si el extracto no informa el medio", () => {
  assert.equal(classifyRail("Pago con tarjeta Visa"), "TARJETA");
  assert.equal(classifyRail("Transferencia SEPA"), "TRANSFERENCIA");
  assert.equal(classifyRail("Liquidación recibida"), "OTRO");
});
