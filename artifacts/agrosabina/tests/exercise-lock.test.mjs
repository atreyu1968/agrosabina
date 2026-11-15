import test from "node:test";
import assert from "node:assert/strict";
import * as store from "../assets/js/store.js";
import { packCompleteBackup } from "../assets/js/complete-backup.js";

const memory = new Map();
globalThis.localStorage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, String(value)),
};

test("el cierre protege documentos, asientos y extractos hasta reabrir el ejercicio", async () => {
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
  assert.equal(store.updateSettings(changedOpening), null);
  assert.equal(store.getState().settings.aperturasPorEjercicio, undefined);

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
  assert.equal(store.deleteInvoice(futureInvoice.id), "");
});
