import test from "node:test";
import assert from "node:assert/strict";

import { crmPaymentMethod, crmPaymentMethodLabel, normalizeCrmRows } from "../assets/js/crm-import.js";

const savedValues = new Map();
globalThis.localStorage = {
  getItem: (key) => savedValues.get(key) ?? null,
  setItem: (key, value) => savedValues.set(key, String(value)),
};
const store = await import("../assets/js/store.js");

test("normaliza columnas españolas de contacto, tipo y condiciones de pago", () => {
  const result = normalizeCrmRows([{
    "Razón social": "  Agricola   Verde SL ",
    CIF: "B12345674",
    "Tipo de tercero": "Cliente y proveedor",
    "Persona de contacto": "Ana Pérez",
    "Correo electrónico": "ana@example.test",
    Teléfono: "922 000 000",
    Dirección: "Calle Uno 2",
    Población: "San Bartolomé",
    CP: "35500",
    "Forma de pago": "Transferencia bancaria",
    "Plazo de pago (días)": "30",
  }]);

  assert.equal(result.errors.length, 0);
  assert.deepEqual(result.records[0], {
    name: "Agricola Verde SL",
    nif: "B12345674",
    role: "AMBOS",
    contactName: "Ana Pérez",
    email: "ana@example.test",
    phone: "922 000 000",
    address: "Calle Uno 2",
    city: "San Bartolomé",
    postalCode: "35500",
    country: "",
    website: "",
    paymentMethod: "TRANSFERENCIA",
    paymentTermDays: 30,
    note: "",
    sourceRow: 2,
  });
});

test("no convierte empleados o acreedores en proveedores y muestra errores de fila", () => {
  const result = normalizeCrmRows([
    { Nombre: "Empleado ejemplo", Tipo: "Empleado" },
    { Nombre: "Acreedor ejemplo", Tipo: "Acreedor" },
    { Nombre: "Sin NIF", NIF: "B12345675", "Forma de pago": "Bitcoin" },
  ]);

  assert.equal(result.records.length, 0);
  assert.equal(result.errors.length, 3);
  assert.match(result.errors[0].issues.join(" "), /Tipo de tercero no reconocido/);
  assert.match(result.errors[1].issues.join(" "), /Tipo de tercero no reconocido/);
  assert.match(result.errors[2].issues.join(" "), /NIF\/NIE\/CIF no es válido/);
});

test("interpreta formas habituales de pago y rechaza plazos fuera de rango", () => {
  assert.equal(crmPaymentMethod("efectivo"), "CAJA");
  assert.equal(crmPaymentMethod("TPV"), "TARJETA");
  assert.equal(crmPaymentMethod("domiciliación bancaria"), "DOMICILIACION");
  assert.equal(crmPaymentMethodLabel("TRANSFERENCIA"), "Transferencia");

  const result = normalizeCrmRows([{ Nombre: "Contacto", "Plazo de pago": 4000 }]);
  assert.equal(result.records.length, 0);
  assert.match(result.errors[0].issues.join(" "), /0 y 3650/);
});

test("ignora filas completamente vacías", () => {
  assert.deepEqual(normalizeCrmRows([{}, { Nombre: " ", Correo: "" }]), { records: [], errors: [] });
});

test("guarda los nuevos datos CRM y distingue plazo vacío de plazo cero", () => {
  const supplier = store.ensureSupplier("Contacto CRM de prueba", "", "PROVEEDOR").supplier;
  assert.equal(supplier.paymentTermDays, null);
  store.updateSupplier(supplier.id, {
    contactName: "Persona de contacto",
    email: "contacto@example.test",
    phone: "922 111 222",
    address: "Calle Uno 2",
    city: "Arrecife",
    postalCode: "35500",
    country: "España",
    website: "https://example.test",
    paymentMethod: "TRANSFERENCIA",
    paymentTermDays: 0,
  });
  const saved = store.supplierById(supplier.id);
  assert.equal(saved.contactName, "Persona de contacto");
  assert.equal(saved.email, "contacto@example.test");
  assert.equal(saved.paymentMethod, "TRANSFERENCIA");
  assert.equal(saved.paymentTermDays, 0);
});

test("importa varios contactos en un guardado y completa coincidencias sin borrar datos vacíos", () => {
  const summary = store.importSupplierContacts([
    { name: "Importado una vez", nif: "B12345674", role: "PROVEEDOR", email: "uno@example.test" },
    { name: "Importado una vez", nif: "B12345674", role: "PROVEEDOR", phone: "922 333 444" },
    { name: "No convertir a proveedor", nif: "", role: "EMPLEADO" },
  ]);

  assert.deepEqual(
    { created: summary.created, updated: summary.updated, failed: summary.failed },
    { created: 1, updated: 1, failed: 1 },
  );
  const matches = store.getState().suppliers.filter((item) => item.name === "Importado una vez");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].email, "uno@example.test");
  assert.equal(matches[0].phone, "922 333 444");
});

test("no fusiona contactos con el mismo nombre pero NIF diferentes", () => {
  store.ensureSupplier("Empresa Coincidente", "X1234567L", "PROVEEDOR");
  const result = store.importSupplierContacts([
    { name: "Empresa Coincidente", nif: "12345678Z", role: "CLIENTE" },
  ]);

  assert.equal(result.created, 1);
  assert.equal(result.updated, 0);
  assert.equal(store.getState().suppliers.filter((item) => item.name === "Empresa Coincidente").length, 2);
});

test("borra correos seleccionados de una vez y deja los demás", () => {
  const first = store.addMessage({ subject: "CRM correo 1", text: "Contenido uno" });
  const second = store.addMessage({ subject: "CRM correo 2", text: "Contenido dos" });
  assert.equal(store.deleteMessages([first.id]), 1);
  assert.equal(store.messageById(first.id), null);
  assert.ok(store.messageById(second.id));
});
