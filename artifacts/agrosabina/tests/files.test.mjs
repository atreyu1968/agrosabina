import test from "node:test";
import assert from "node:assert/strict";

// Modelo del ciclo de vida IndexedDB; la integración real se comprueba en navegador.
const records = new Map();
let opened = 0;
let closed = 0;
globalThis.window = { indexedDB: true };
globalThis.indexedDB = {
  open() {
    opened++;
    const db = {
      isClosed: false,
      close() { this.isClosed = true; closed++; },
      transaction() {
        if (this.isClosed) throw new DOMException("Conexión cerrada", "InvalidStateError");
        const tx = {
          objectStore() {
            const write = (fn) => {
              fn();
              queueMicrotask(() => tx.oncomplete?.());
            };
            return {
              put: (value, key) => write(() => records.set(key, value)),
              delete: (key) => write(() => records.delete(key)),
              clear: () => write(() => records.clear()),
              get(key) {
                const request = { result: records.get(key) };
                queueMicrotask(() => request.onsuccess());
                return request;
              },
              openCursor() {
                const values = [...records.values()];
                const request = {};
                const next = () => queueMicrotask(() => {
                  const value = values.shift();
                  request.result = value ? { value, continue: next } : null;
                  request.onsuccess();
                });
                next();
                return request;
              },
            };
          },
        };
        return tx;
      },
    };
    const request = { result: db };
    queueMicrotask(() => request.onsuccess());
    return request;
  },
};
const files = await import("../assets/js/files.js");

test("consultar, guardar dos originales, leerlos y borrarlos sin reutilizar conexiones cerradas", async () => {
  assert.deepEqual(await files.originalsUsed(), { count: 0, bytes: 0 });
  await files.keepOriginal("first", new Blob(["uno"]), { name: "uno.txt" });
  await files.keepOriginal("second", new Blob(["dos"]), { name: "dos.txt" });
  assert.equal(await (await files.originalOf("first")).blob.text(), "uno");
  assert.equal(await (await files.originalOf("second")).blob.text(), "dos");
  assert.deepEqual(await files.originalsUsed(), { count: 2, bytes: 6 });
  await files.dropOriginal("first");
  assert.equal(await files.originalOf("first"), null);
  await files.forgetAllOriginals();
  assert.deepEqual(await files.originalsUsed(), { count: 0, bytes: 0 });
  assert.equal(opened, closed);
});
