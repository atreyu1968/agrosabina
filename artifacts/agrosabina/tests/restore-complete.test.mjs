import test from "node:test";
import assert from "node:assert/strict";
import * as store from "../assets/js/store.js";
import * as files from "../assets/js/files.js";

// Modelo transaccional aislado. Los navegadores reales se verifican aparte.
const disk = new Map();
const records = new Map();
let quotaFailure = false;
let attachmentFailure = false;
globalThis.localStorage = {
  getItem: (key) => disk.get(key) ?? null,
  setItem(key, value) {
    if (quotaFailure) { quotaFailure = false; throw new Error("Cuota agotada"); }
    disk.set(key, String(value));
  },
};
globalThis.window = { indexedDB: true };
globalThis.indexedDB = {
  open() {
    const request = {};
    request.result = {
      close() {},
      transaction(_store, mode) {
        const pending = new Map(records);
        const tx = { objectStore: () => ({
          put: (value, key) => pending.set(key, value),
          add(value, key) {
            if (attachmentFailure || pending.has(key)) {
              attachmentFailure = false;
              tx.error = new Error("No se pudo añadir");
            } else pending.set(key, value);
          },
          delete: (key) => pending.delete(key),
          get(key) {
            const rq = { result: records.get(key) };
            queueMicrotask(() => rq.onsuccess?.());
            return rq;
          },
          openCursor() {
            const entries = [...records];
            const rq = {};
            const next = () => queueMicrotask(() => {
              const entry = entries.shift();
              rq.result = entry ? { key: entry[0], value: entry[1], continue: next } : null;
              rq.onsuccess?.();
            });
            next();
            return rq;
          },
        }) };
        setTimeout(() => {
          if (tx.error) { tx.onabort?.(); return; }
          if (mode === "readwrite") {
            records.clear();
            for (const [id, value] of pending) records.set(id, value);
          }
          tx.oncomplete?.();
        }, 0);
        return tx;
      },
    };
    queueMicrotask(() => request.onsuccess());
    return request;
  },
};

test("restauración aditiva conserva registros, claves y originales existentes y revierte errores", async () => {
  store.updateSettings({ aiKey: "CLAVE-SOLO-LOCAL" });
  const { invoice } = store.addInvoice({ supplierName: "Prueba", number: "ORIGINAL-1", total: 12, rate: 0 });
  const file = new Blob(["%PDF-contenido"], { type: "application/pdf" });
  await store.keepInvoiceOriginal(invoice.id, file);
  const archive = await store.exportCompleteBackup();
  const oldState = JSON.stringify(store.getState());
  const oldDisk = disk.get("facturas.igic.v1");
  const oldIds = [...records.keys()];
  const corrupt = JSON.parse(archive);
  corrupt.attachments[0].sha256 = "0".repeat(64);
  await assert.rejects(store.importCompleteBackup(JSON.stringify(corrupt)), /dañado/);
  assert.equal(JSON.stringify(store.getState()), oldState);
  assert.equal(disk.get("facturas.igic.v1"), oldDisk);
  assert.deepEqual([...records.keys()], oldIds);

  attachmentFailure = true;
  await assert.rejects(store.importCompleteBackup(archive), /añadir/);
  assert.equal(JSON.stringify(store.getState()), oldState);
  assert.deepEqual([...records.keys()], oldIds);

  quotaFailure = true;
  await assert.rejects(store.importCompleteBackup(archive), /Cuota agotada/);
  assert.equal(JSON.stringify(store.getState()), oldState);
  assert.deepEqual([...records.keys()], oldIds);

  const result = await store.importCompleteBackup(archive);
  assert.deepEqual(result, { invoices: 1, originals: 1 });
  const imported = store.getState().invoices.find((row) => row.id !== invoice.id);
  assert.notEqual(imported.supplierId, invoice.supplierId);
  assert.ok(store.supplierById(imported.supplierId));
  assert.equal(store.getState().settings.aiKey, "CLAVE-SOLO-LOCAL");
  assert.equal(await (await files.originalOf(imported.id)).blob.text(), "%PDF-contenido");
  assert.equal(await (await files.originalOf(invoice.id)).blob.text(), "%PDF-contenido");
  assert.equal(JSON.parse(disk.get("facturas.igic.v1")).invoices.length, 2);
});
