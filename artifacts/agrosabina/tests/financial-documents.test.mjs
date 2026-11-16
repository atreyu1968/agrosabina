import test from "node:test";
import assert from "node:assert/strict";
import { asientosDe, cuenta } from "../assets/js/accounting.js";
import { financialError, financialDirection, normalizeFinancial, debtBalances, parseFinancialText, financialHasCash } from "../assets/js/financial-documents.js";
import { financialFormHtml } from "../assets/js/financial-form.js";
import { leerDocumento } from "../assets/js/importers.js";
import { igicPorTrimestre, tesoreriaPorCuenta } from "../assets/js/erp.js";
import * as store from "../assets/js/store.js";
import { todayISO } from "../assets/js/util.js";

const day = todayISO();
const year = day.slice(0, 4);
const opts = { from: `${year}-01-01`, to: `${year}-12-31` };
const loan = (operation, fields = {}, total = 0) => ({
  id: operation, kind: "PRESTAMO", issueDate: day, paidDate: day,
  status: "PAGADO", payMethod: "BANCO", total, supplierName: "Entidad de prueba",
  financial: normalizeFinancial({ operation, reference: "Contrato de prueba", ...fields }, "PRESTAMO"),
});
const memory = new Map();
globalThis.localStorage = { getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, String(value)) };
const balanced = (entries) => entries.every((entry) => Math.abs(entry.lines.reduce((sum, line) => sum + line.debit - line.credit, 0)) < 0.001);

test("préstamo: alta separada, cuota con costes y reclasificación conservan el principal sin convertirlo en gasto", () => {
  const docs = [
    loan("ALTA", { capitalShort: 2000, capitalLong: 8000 }, 10000),
    loan("CUOTA", { capitalShort: 500, capitalLong: 0, interest: 40, fees: 10 }, 550),
    loan("RECLASIFICACION", { reclassAmount: 1000 }, 1000),
  ];
  docs.forEach((doc) => assert.equal(financialError(doc), ""));
  const entries = asientosDe(docs, opts);
  assert.ok(balanced(entries));
  const debt = debtBalances(entries);
  assert.equal(debt.find((row) => row.account === "520000").amount, 2500);
  assert.equal(debt.find((row) => row.account === "170000").amount, 7000);
  const expenses = entries.flatMap((entry) => entry.lines).filter((line) => line.account.startsWith("6"));
  assert.equal(expenses.reduce((sum, line) => sum + line.debit, 0), 50);
  const reclass = entries.find((entry) => entry.kind === "reclasificacion");
  assert.deepEqual(reclass.lines.map((line) => line.account).sort(), ["170000", "520000"]);
  assert.equal(cuenta("170001").balance, "PNC_II");
  assert.equal(cuenta("520001").balance, "PC_III");
  const report = store.totals(docs);
  assert.equal(report.expense, 50);
  assert.equal(report.income, 0);
});

test("cuota pendiente devenga solo intereses y comisiones; el capital se reduce en la fecha real de pago", () => {
  const doc = loan("CUOTA", { capitalShort: 500, capitalLong: 0, interest: 40, fees: 10 }, 550);
  const pending = asientosDe([{ ...doc, status: "PENDIENTE", paidDate: "" }], opts);
  assert.equal(pending.length, 1);
  assert.deepEqual(pending[0].lines.map((line) => line.account).sort(), ["410000", "527000", "626000", "662000"]);
  assert.ok(balanced(pending));
  const nextYear = `${Number(year) + 1}-01-15`;
  const payment = asientosDe([{ ...doc, paidDate: nextYear }], { from: `${Number(year) + 1}-01-01`, to: `${Number(year) + 1}-12-31` });
  assert.equal(payment.length, 1);
  assert.equal(payment[0].date, nextYear);
  assert.equal(payment[0].lines.find((line) => line.account === "520000").debit, 500);
  assert.equal(payment[0].lines.some((line) => line.account.startsWith("6")), false);
});

test("no contabiliza desgloses incompletos, importes que no cuadran o cuentas de deuda incorrectas", () => {
  const valid = loan("CUOTA", { capitalShort: 500, capitalLong: 0, interest: 40, fees: 10 }, 550);
  for (const doc of [
    { ...valid, total: 551 },
    { ...valid, financial: { ...valid.financial, capitalLong: null } },
    { ...valid, financial: { ...valid.financial, shortAccount: "600000" } },
    { ...valid, financial: { ...valid.financial, interest: -1 } },
    { ...valid, paidDate: "" },
  ]) {
    assert.ok(financialError(doc));
    assert.equal(asientosDe([doc], opts).length, 0);
  }
});

test("IGIC: declaración y pago usan cuentas fiscales sin duplicar gastos ni libros de facturas", () => {
  const declaration = { ...loan("", {}, 70), kind: "IGIC", financial: normalizeFinancial({ operation: "DECLARACION", taxOutput: 140, taxInput: 70 }, "IGIC") };
  const payment = { ...declaration, id: "payment", financial: normalizeFinancial({ operation: "PAGO" }, "IGIC") };
  const entries = asientosDe([declaration, payment], opts);
  assert.ok(balanced(entries));
  assert.equal(entries.length, 2);
  assert.equal(entries.flatMap((entry) => entry.lines).some((line) => line.account.startsWith("6")), false);
  assert.equal(entries.find((entry) => entry.docId === "payment").lines.find((line) => line.account === "475000").debit, 70);
  assert.equal(igicPorTrimestre([declaration, payment], { year: +year }).totals.docs, 0);
  assert.equal(financialHasCash(declaration), false);
  const archived = { ...declaration, financial: normalizeFinancial({ operation: "ARCHIVO" }, "IGIC"), total: 0 };
  assert.equal(asientosDe([archived], opts).length, 0);
});

test("póliza: el principal no es ingreso/gasto y los costes se separan del capital dispuesto", () => {
  const doc = (operation, fields, total) => ({ ...loan("", {}, total), kind: "POLIZA_CREDITO", financial: normalizeFinancial({ operation, reference: "Póliza de prueba", ...fields }, "POLIZA_CREDITO") });
  const docs = [doc("DISPOSICION", { capitalShort: 1000 }, 1000), doc("LIQUIDACION", { interest: 20, fees: 5 }, 25), doc("REEMBOLSO", { capitalShort: 100 }, 100)];
  const entries = asientosDe(docs, opts);
  assert.ok(balanced(entries));
  assert.equal(debtBalances(entries).find((row) => row.account === "520100").amount, 900);
  assert.equal(store.totals(docs).expense, 25);
  assert.equal(financialDirection("POLIZA_CREDITO", docs[0].financial), "INGRESO");
});

test("justificante de recibo no repite el asiento bancario ni el gasto de su factura", () => {
  const receipt = { ...loan("", {}, 107), kind: "RECIBO_BANCARIO", financial: normalizeFinancial({ operation: "JUSTIFICANTE", linkedDocumentId: "invoice" }, "RECIBO_BANCARIO") };
  assert.equal(asientosDe([receipt], opts).length, 0);
  assert.equal(store.totals([receipt]).expense, 0);
  assert.equal(tesoreriaPorCuenta([receipt], {}).cuentas.length, 0);
});

test("los importadores financieros están disponibles y no fabrican datos que faltan", () => {
  for (const [kind, text] of [["PRESTAMO", "Cuota de préstamo"], ["IGIC", "Modelo 420 IGIC"], ["RECIBO_BANCARIO", "Recibo bancario SEPA"], ["POLIZA_CREDITO", "Póliza de crédito"]]) {
    const result = leerDocumento(text, { tipo: kind });
    assert.equal(result.doc.kind, kind);
    assert.equal(result.doc.igic, 0);
    assert.equal(result.doc.issueDate, "");
    assert.ok(result.doc.requiresReview);
    assert.ok(financialFormHtml({ kind, financial: result.doc.financial }).includes("Desglose y tratamiento contable"));
  }
  const extracted = parseFinancialText("Préstamo\nAmortización de capital: 500,00\nIntereses: 40,00\nComisiones: 10,00\nTotal recibo: 550,00", "PRESTAMO");
  assert.equal(extracted.financial.capitalShort, 500);
  assert.equal(extracted.financial.capitalLong, null);
  assert.equal(extracted.total, 550);
  assert.equal(parseFinancialText("Modelo 425 resumen anual IGIC", "IGIC").financial.operation, "ARCHIVO");
});

test("el desglose financiero sobrevive a crear, editar, exportar y restaurar sin tocar datos del usuario", () => {
  const input = { ...loan("CUOTA", { capitalShort: 500, capitalLong: 0, interest: 40, fees: 10 }, 550), number: "TEST-LOAN-001" };
  const result = store.addInvoice(input);
  assert.ok(result.invoice, result.error);
  assert.equal(result.invoice.financial.capitalLong, 0);
  assert.equal(store.updateInvoice(result.invoice.id, { financial: { ...result.invoice.financial, reference: "Contrato revisado" } }).financial.reference, "Contrato revisado");
  const exported = store.exportJSON();
  store.importJSON(exported);
  assert.equal(store.invoiceById(result.invoice.id).financial.capitalShort, 500);
  assert.equal(store.invoiceById(result.invoice.id).financial.reference, "Contrato revisado");
});
