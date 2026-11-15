import test from "node:test";
import assert from "node:assert/strict";
import * as store from "../assets/js/store.js";

const savedValues = new Map();
globalThis.localStorage = {
  getItem: (key) => savedValues.get(key) ?? null,
  setItem: (key, value) => savedValues.set(key, String(value)),
};
const validIssueDate = `${store.activeExerciseYear()}-03-01`;

test("guarda documentos con NIF, NIE y CIF válidos y admite el NIF vacío", () => {
  const cases = [
    ["NIF válido", "12345678Z"],
    ["NIE válido", "X1234567L"],
    ["CIF válido", "B12345674"],
    ["sin identificador", ""],
  ];

  for (const [name, nif] of cases) {
    const { invoice, supplier } = store.addInvoice({
      supplierName: `Proveedor ${name}`,
      supplierNif: nif,
      number: `DOC-${name}`,
      issueDate: validIssueDate,
      base: 10,
      total: 10,
    });
    assert.equal(store.invoiceById(invoice.id).id, invoice.id);
    assert.equal(store.supplierById(invoice.supplierId).nif, nif);
    assert.equal(supplier.nif, nif);
  }
});

test("rechaza guardar un documento con un NIF inválido sin crear registros", () => {
  const beforeInvoices = store.getState().invoices.length;
  const beforeSuppliers = store.getState().suppliers.length;

  assert.throws(
    () => store.addInvoice({
      supplierName: "Proveedor con NIF inválido",
      supplierNif: "B12345675",
      number: "DOC-INVALIDO",
      issueDate: validIssueDate,
      base: 10,
      total: 10,
    }),
    /NIF, NIE o CIF/
  );
  assert.equal(store.getState().invoices.length, beforeInvoices);
  assert.equal(store.getState().suppliers.length, beforeSuppliers);
});

test("al editar un documento valida el nuevo proveedor antes de cambiar su ficha", () => {
  const { invoice, supplier: originalSupplier } = store.addInvoice({
    supplierName: "Proveedor original",
    supplierNif: "12345678Z",
    number: "DOC-EDITAR-NIF",
    issueDate: validIssueDate,
    base: 10,
    total: 10,
  });

  assert.throws(() => {
    const nextSupplier = store.ensureSupplier("Proveedor nuevo", "B12345675").supplier;
    store.updateInvoice(invoice.id, { supplierId: nextSupplier.id });
  }, /NIF, NIE o CIF/);
  assert.equal(store.invoiceById(invoice.id).supplierId, originalSupplier.id);

  const nextSupplier = store.ensureSupplier("Proveedor nuevo", "X1234567L").supplier;
  store.updateInvoice(invoice.id, { supplierId: nextSupplier.id });
  assert.equal(store.invoiceById(invoice.id).supplierId, nextSupplier.id);
  assert.equal(store.supplierById(nextSupplier.id).nif, "X1234567L");
});

test("crea y edita proveedores con NIF, NIE y CIF válidos", () => {
  const supplier = store.ensureSupplier("Proveedor editable", "12345678Z").supplier;
  assert.equal(supplier.nif, "12345678Z");

  store.updateSupplier(supplier.id, { nif: "X1234567L" });
  assert.equal(store.supplierById(supplier.id).nif, "X1234567L");

  store.updateSupplier(supplier.id, { nif: "B12345674" });
  assert.equal(store.supplierById(supplier.id).nif, "B12345674");
});

test("rechaza crear o editar proveedores con un NIF inválido", () => {
  const beforeSuppliers = store.getState().suppliers.length;
  assert.throws(
    () => store.ensureSupplier("Proveedor inválido", "B12345675"),
    /NIF, NIE o CIF/
  );
  assert.equal(store.getState().suppliers.length, beforeSuppliers);

  const supplier = store.ensureSupplier("Proveedor protegido", "12345678Z").supplier;
  assert.throws(
    () => store.updateSupplier(supplier.id, { nif: "12345678A" }),
    /NIF, NIE o CIF/
  );
  assert.equal(store.supplierById(supplier.id).nif, "12345678Z");
});

test("permite dejar vacío el NIF de un proveedor al editar", () => {
  const supplier = store.ensureSupplier("Proveedor sin NIF", "12345678Z").supplier;
  store.updateSupplier(supplier.id, { nif: "" });
  assert.equal(store.supplierById(supplier.id).nif, "");
});
