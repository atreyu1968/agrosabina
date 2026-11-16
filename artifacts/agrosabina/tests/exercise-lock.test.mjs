import test from "node:test";
import assert from "node:assert/strict";
import * as store from "../assets/js/store.js";
import { packCompleteBackup } from "../assets/js/complete-backup.js";

const memory = new Map();
globalThis.localStorage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, String(value)),
};

test("el cierre protege los datos originales y permite liquidar pendientes en el ejercicio siguiente", async () => {
  const year = store.activeExerciseYear();
  const date = `${year}-08-12`;
  const { invoice, supplier } = store.addInvoice({
    supplierName: "Proveedor ejercicio cerrado",
    number: "CERRADO-001",
    issueDate: date,
    base: 100,
    total: 100,
  });
  assert.ok(invoice);
  const { invoice: directPaymentInvoice } = store.addInvoice({
    supplierName: supplier.name,
    number: "CERRADO-PAGO-001",
    issueDate: date,
    base: 50,
    total: 50,
  });
  assert.ok(directPaymentInvoice);
  const manual = {
    id: "manual-lock-test",
    date,
    concept: "Asiento de prueba",
    lineas: [
      { cuenta: "600", debe: 100, haber: 0 },
      { cuenta: "400", debe: 0, haber: 100 },
    ],
  };
  const batch = {
    id: "statement-lock-test",
    name: "Extracto de prueba",
    account: "Cuenta de prueba",
    movements: [{ id: "movement-lock-test", date, amount: -100, status: "PENDIENTE" }],
  };
  store.updateSettings({ asientosManuales: [manual], bankStatements: [batch] });
  assert.deepEqual(store.setExerciseClosed(year, true), { closed: true, error: "" });
  assert.equal(store.isExerciseClosed(year), true);

  const rejectedAdd = store.addInvoice({
    supplierName: "No se debe añadir",
    number: "CERRADO-002",
    issueDate: date,
    base: 20,
    total: 20,
  });
  assert.equal(rejectedAdd.invoice, null);
  assert.match(rejectedAdd.error, /Reabrir ejercicio/);
  assert.equal(store.updateInvoice(invoice.id, { number: "CAMBIADO" }), null);
  assert.equal(store.invoiceById(invoice.id).number, "CERRADO-001");
  assert.match(store.deleteInvoice(invoice.id), /Reabrir ejercicio/);
  assert.equal(store.updateSupplier(supplier.id, { name: "Nombre cambiado" }), null);
  assert.match(store.deleteSupplier(supplier.id), /Reabrir ejercicio/);

  const changedManuals = [{ ...manual, concept: "No debe cambiar" }];
  assert.equal(store.updateSettings({ asientosManuales: changedManuals }), null);
  assert.equal(store.getState().settings.asientosManuales[0].concept, manual.concept);
  const changedStatements = [{ ...batch, movements: [{ ...batch.movements[0], status: "CONCILIADO" }] }];
  assert.equal(store.updateSettings({ bankStatements: changedStatements }), null);
  assert.equal(store.getState().settings.bankStatements[0].movements[0].status, "PENDIENTE");
  const changedOpening = { aperturasPorEjercicio: { [String(year)]: { sourceYear: year - 1, lines: [] } } };
  const openingBefore = structuredClone(store.getState().settings.aperturasPorEjercicio);
  assert.equal(store.updateSettings(changedOpening), null);
  assert.deepEqual(store.getState().settings.aperturasPorEjercicio, openingBefore);

  store.updateSettings({ activeExerciseYear: year + 1 });
  const futureDate = `${year + 1}-02-03`;
  assert.equal(store.addInvoice({
    supplierName: "No se debe pagar en un ejercicio cerrado",
    number: "PAGO-CERRADO-001",
    issueDate: futureDate,
    paidDate: date,
    status: "PAGADO",
    base: 20,
    total: 20,
  }).invoice, null);
  const { invoice: futureInvoice } = store.addInvoice({
    supplierName: "Documento de ejercicio abierto",
    number: "PAGO-CERRADO-002",
    issueDate: futureDate,
    base: 20,
    total: 20,
  });
  assert.equal(store.updateInvoice(futureInvoice.id, { status: "PAGADO", paidDate: date }), null);
  store.updateSettings({ activeExerciseYear: year });

  assert.deepEqual(store.applyBankReconciliation(changedStatements, [{
    movementId: "movement-lock-test",
    invoiceId: invoice.id,
    amount: -100,
    date,
    method: "BANCO",
    account: batch.account,
  }]), []);

  store.updateSettings({ activeExerciseYear: year + 1 });
  const paymentPatch = {
    status: "PAGADO",
    paidDate: futureDate,
    payMethod: "BANCO",
    payAccount: "Cuenta de prueba",
  };
  assert.equal(store.invoiceWriteError(invoice, paymentPatch), "");
  assert.match(store.invoiceWriteError(invoice, { ...paymentPatch, total: 80 }), /Reabrir ejercicio/);
  assert.equal(store.setInvoiceStatus(invoice.id, "PAGADO", date, {
    method: "BANCO",
    account: "Cuenta de prueba",
  }), null);
  assert.ok(store.setInvoiceStatus(directPaymentInvoice.id, "PAGADO", futureDate, {
    method: "BANCO",
    account: "Cuenta de prueba",
  }));
  assert.equal(store.invoiceById(directPaymentInvoice.id).paidDate, futureDate);

  const currentBatch = {
    id: "statement-current-year",
    name: "Extracto del ejercicio siguiente",
    account: "Cuenta de prueba",
    movements: [{ id: "movement-carryover", date: futureDate, amount: -100, status: "PENDIENTE" }],
  };
  const carryoverStatements = [batch, currentBatch];
  assert.ok(store.updateSettings({ bankStatements: carryoverStatements }));
  assert.deepEqual(store.applyBankReconciliation(carryoverStatements, [{
    movementId: "movement-carryover",
    invoiceId: invoice.id,
    amount: -100,
    date: futureDate,
    method: "BANCO",
    account: currentBatch.account,
  }]), [invoice.id]);
  assert.equal(store.invoiceById(invoice.id).issueDate, date);
  assert.equal(store.invoiceById(invoice.id).total, 100);
  assert.equal(store.invoiceById(invoice.id).paidDate, futureDate);

  assert.match(store.clearAll(), /Reabrir ejercicio/);

  const backup = JSON.parse(store.exportJSON());
  store.importJSON(JSON.stringify(backup));
  assert.equal(store.isExerciseClosed(year), true);
  backup.invoices.find((item) => item.id === invoice.id).number = "CAMBIO EN COPIA";
  assert.throws(() => store.importJSON(JSON.stringify(backup)), /Reabrir ejercicio/);
  assert.equal(store.invoiceById(invoice.id).number, "CERRADO-001");
  const completeBackup = await packCompleteBackup(
    JSON.parse(JSON.stringify(store.getState())),
    new Map()
  );
  await assert.rejects(store.importCompleteBackup(completeBackup), /Reabrir ejercicio/);

  assert.deepEqual(store.setExerciseClosed(year, false), { closed: false, error: "" });
  assert.equal(store.updateInvoice(invoice.id, { number: "REVISADO" }).number, "REVISADO");
  assert.equal(store.deleteInvoice(invoice.id), "");
  assert.equal(store.deleteInvoice(directPaymentInvoice.id), "");
  assert.equal(store.deleteInvoice(futureInvoice.id), "");
});
