import test from "node:test";
import assert from "node:assert/strict";
import { parseAmount } from "../assets/js/util.js";
import { validateBackup } from "../assets/js/backup.js";
import * as store from "../assets/js/store.js";

// Sólo memoria de este proceso: nunca se abre el navegador del usuario.
const memory = new Map();
globalThis.localStorage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, String(value)),
};

for (const [input, expected] of [
  ["-0,853", -0.853], ["-0.853", -0.853], ["0,853", 0.853],
  ["−0,853", -0.853], ["(123,45)", -123.45], ["(123,45 €)", -123.45],
  ["(1.234,56) EUR", -1234.56], ["1.234,56", 1234.56],
  ["1,234.56", 1234.56], ["-1.234", -1234], ["1.234.567", 1234567],
  ["1 234,56", 1234.56], ["", null], ["texto", null],
]) {
  test(`lectura de importe ${JSON.stringify(input)}`, () => {
    assert.equal(parseAmount(input), expected);
  });
}

test("la nómina conserva sus datos al crear, exportar y restaurar", () => {
  const nomina = {
    trabajador: "Auditoría", bruto: 2000, ssTrabajador: 130,
    irpf: 370, neto: 1500, ssEmpresa: 600,
  };
  const { invoice } = store.addInvoice({
    supplierName: "Proveedor de prueba", kind: "NOMINA", number: "TEST-001",
    base: 1500, total: 1500, rate: 0, nomina,
  });
  assert.equal(invoice.nomina.bruto, 2000);
  assert.equal(invoice.nomina.irpf, 370);
  const exported = store.exportJSON();
  store.importJSON(exported);
  assert.equal(store.invoiceById(invoice.id).nomina.ssEmpresa, 600);
});

test("fecha, medio y cuenta de pago sobreviven a la recarga del estado", () => {
  const invoice = store.getState().invoices[0];
  store.updateInvoice(invoice.id, {
    status: "PAGADO", paidDate: "2026-10-12", payMethod: "BANCO", payAccount: "Cuenta prueba",
  });
  store.importJSON(store.exportJSON());
  const restored = store.invoiceById(invoice.id);
  assert.equal(restored.paidDate, "2026-10-12");
  assert.equal(restored.payMethod, "BANCO");
  assert.equal(restored.payAccount, "Cuenta prueba");
  store.updateInvoice(invoice.id, { status: "PENDIENTE" });
  assert.equal(restored.paidDate, "");
  assert.equal(restored.payMethod, "");
  assert.equal(restored.payAccount, "");
});

test("el pago con tarjeta se distingue del banco y conserva su cuenta", () => {
  assert.equal(store.normaliseMedio("TARJETA"), "TARJETA");
  const { invoice } = store.addInvoice({
    supplierName: "Pago con tarjeta",
    kind: "FACTURA",
    number: "CARD-001",
    base: 25,
    rate: 0,
    total: 25,
  });
  store.updateInvoice(invoice.id, {
    status: "PAGADO",
    paidDate: "2026-10-14",
    payMethod: "TARJETA",
    payAccount: "Cuenta TPV",
  });
  store.importJSON(store.exportJSON());
  const restored = store.invoiceById(invoice.id);
  assert.equal(restored.payMethod, "TARJETA");
  assert.equal(restored.payAccount, "Cuenta TPV");
});

test("conciliar un movimiento valida importe y sentido, y al deshacer el pago vuelve a quedar pendiente", () => {
  const { invoice } = store.addInvoice({
    supplierName: "Suministros de prueba",
    kind: "FACTURA",
    number: "BANK-001",
    issueDate: "2026-10-01",
    base: 100,
    rate: 0,
    total: 100,
    status: "PENDIENTE",
  });
  const statements = [{
    id: "statement-test",
    account: "Cuenta de prueba",
    movements: [{ id: "movement-test", date: "2026-10-12", amount: -100, status: "PENDIENTE" }],
  }];
  const rejected = store.applyBankReconciliation(statements, [{
    movementId: "movement-test",
    invoiceId: invoice.id,
    amount: -99,
    date: "2026-10-12",
    method: "BANCO",
    account: "Cuenta de prueba",
  }]);
  assert.deepEqual(rejected, []);
  assert.equal(store.invoiceById(invoice.id).status, "PENDIENTE");
  const applied = store.applyBankReconciliation(statements, [{
    movementId: "movement-test",
    invoiceId: invoice.id,
    amount: -100,
    date: "2026-10-12",
    method: "BANCO",
    account: "Cuenta de prueba",
  }]);
  assert.deepEqual(applied, [invoice.id]);
  assert.equal(store.invoiceById(invoice.id).status, "PAGADO");
  assert.equal(store.getState().settings.bankStatements[0].movements[0].status, "CONCILIADO");

  store.updateInvoice(invoice.id, { status: "PENDIENTE" });
  assert.equal(store.getState().settings.bankStatements[0].movements[0].status, "PENDIENTE");
  assert.equal(store.getState().settings.bankStatements[0].movements[0].matchedInvoiceId, undefined);
});

test("una factura importada como pagada conserva la fecha vacía al editar y recargar", () => {
  const { invoice } = store.addInvoice({
    supplierName: "Proveedor sin fecha de prueba",
    number: "PAGADA-SIN-FECHA",
    base: 100,
    total: 107,
    status: "PAGADO",
    source: "ocr",
  });

  assert.equal(invoice.status, "PAGADO");
  assert.equal(invoice.paidDate, "");

  // Una edición de otros campos no debe completar la fecha por su cuenta.
  store.updateInvoice(invoice.id, { notes: ["Importada sin fecha de pago"] });
  store.importJSON(store.exportJSON());
  assert.equal(store.invoiceById(invoice.id).paidDate, "");

  // La fecha sigue siendo introducible manualmente y también sobrevive a la recarga.
  store.updateInvoice(invoice.id, { paidDate: "2026-11-14" });
  store.importJSON(store.exportJSON());
  assert.equal(store.invoiceById(invoice.id).paidDate, "2026-11-14");
});

test("exportar no incluye la clave ficticia ni modifica los ajustes", () => {
  store.updateSettings({ aiKey: "CREDENCIAL-FICTICIA-LOCAL" });
  const exported = store.exportJSON();
  assert.equal(exported.includes("CREDENCIAL-FICTICIA-LOCAL"), false);
  assert.equal(Object.hasOwn(JSON.parse(exported).settings, "aiKey"), false);
  assert.equal(store.getState().settings.aiKey, "CREDENCIAL-FICTICIA-LOCAL");
});

test("una copia antigua no sobreescribe la clave configurada", () => {
  const oldBackup = JSON.parse(store.exportJSON());
  oldBackup.settings.aiKey = "CREDENCIAL-FICTICIA-AJENA";
  store.importJSON(JSON.stringify(oldBackup));
  assert.equal(store.getState().settings.aiKey, "CREDENCIAL-FICTICIA-LOCAL");
});

test("las copias dañadas se rechazan sin cambiar los datos ni el guardado", () => {
  const valid = JSON.parse(store.exportJSON());
  const invalid = [
    null, [], {}, { suppliers: [] }, { invoices: [] },
    { ...valid, version: 999 }, { ...valid, settings: [] },
    { ...valid, invoices: [null] },
    { ...valid, suppliers: [] },
    { ...valid, invoices: [...valid.invoices, valid.invoices[0]] },
    { ...valid, invoices: [{ ...valid.invoices[0], lines: [null] }] },
    { ...valid, invoices: [{ ...valid.invoices[0], total: "no es un número" }] },
    { ...valid, messages: [null] },
  ];
  for (const backup of invalid) {
    const before = JSON.stringify(store.getState());
    const persisted = memory.get("facturas.igic.v1");
    assert.throws(() => store.importJSON(JSON.stringify(backup)), /Copia no válida/);
    assert.equal(JSON.stringify(store.getState()), before);
    assert.equal(memory.get("facturas.igic.v1"), persisted);
  }
});

test("las copias antiguas completas y las copias vacías completas son válidas", () => {
  assert.doesNotThrow(() => validateBackup({ suppliers: [], invoices: [] }));
  const legacy = JSON.parse(store.exportJSON());
  delete legacy.version;
  delete legacy.messages;
  assert.doesNotThrow(() => validateBackup(legacy));
});
