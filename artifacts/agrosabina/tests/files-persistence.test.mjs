import test from "node:test";
import assert from "node:assert/strict";
import { persistentStorageStatus, requestPersistentStorage } from "../assets/js/files.js";

async function withNavigator(value, callback) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value,
  });
  try {
    return await callback();
  } finally {
    if (previous) Object.defineProperty(globalThis, "navigator", previous);
    else delete globalThis.navigator;
  }
}

test("solicita protección de almacenamiento y consulta el permiso concedido", async () => {
  let requests = 0;
  let persistent = false;
  await withNavigator({
    storage: {
      persisted: async () => persistent,
      persist: async () => {
        requests += 1;
        persistent = true;
        return true;
      },
    },
  }, async () => {
    assert.deepEqual(await requestPersistentStorage(), { supported: true, persistent: true });
    assert.deepEqual(await persistentStorageStatus(), { supported: true, persistent: true });
    assert.equal(requests, 1);
  });
});

test("informa si el navegador no concede protección persistente", async () => {
  await withNavigator({
    storage: { persisted: async () => false, persist: async () => false },
  }, async () => {
    assert.deepEqual(await requestPersistentStorage(), { supported: true, persistent: false });
  });
});

test("informa cuando el navegador no ofrece almacenamiento persistente", async () => {
  await withNavigator({}, async () => {
    assert.deepEqual(await requestPersistentStorage(), { supported: false, persistent: false });
    assert.deepEqual(await persistentStorageStatus(), { supported: false, persistent: false });
  });
});
