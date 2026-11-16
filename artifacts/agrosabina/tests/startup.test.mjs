import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const key = "facturas.igic.v1";
const localCopy = {
  settings: { businessName: "Copia local anterior" },
  suppliers: [{ id: "previo", name: "Proveedor anterior" }],
  invoices: [],
  messages: [],
};
const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function environment() {
  const memory = new Map([[key, JSON.stringify(localCopy)]]);
  const events = { document: new Map(), window: new Map() };
  globalThis.localStorage = {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, value),
    removeItem: (key) => memory.delete(key),
  };
  globalThis.window = {
    addEventListener: (name, fn) => events.window.set(name, fn),
    scrollTo() {},
  };
  globalThis.document = {
    readyState: "loading",
    addEventListener: (name, fn) => events.document.set(name, fn),
    getElementById: () => null,
    querySelector: () => null,
    createElement: () => ({ remove() {} }),
    body: { append() {} },
  };
  globalThis.location = { hash: "#/compras" };
  globalThis.Element = class {
    constructor(selector) { this.selector = selector; this.dataset = { action: "new" }; }
    closest(selector) { return selector === this.selector ? this : null; }
  };
  return { memory, events };
}

test("más de nueve segundos no libera acciones, filtros ni campos; la resolución sí", async () => {
  const { events } = environment();
  const pending = deferred();
  const calls = [];
  globalThis.__startupTest = { pending, calls };
  const viewsUrl = moduleUrl(`
    const calls = globalThis.__startupTest.calls;
    export const ui = {};
    ${["renderLoading", "render", "wireDropzone", "onAction", "onFilterButton", "onDirectionButton", "onInput", "onChange", "queueFiles"]
      .map((name) => `export const ${name} = (...args) => calls.push(["${name}", ...args]);`).join("\n")}
  `);
  const storeUrl = moduleUrl(`
    export const initStore = () => globalThis.__startupTest.pending.promise;
    export const getState = () => ({ invoices: [{}], suppliers: [] });
    export const storageInfo = () => ({ engine: "sqlite" });
    export const save = () => {};
    export const flush = async () => {};
    export const subscribe = () => {};
  `);
  const domUrl = moduleUrl("export const toast = () => {}; export const escapeKeyCloses = () => {};");
  const source = (await readFile(new URL("../assets/js/main.js", import.meta.url), "utf8"))
    .replace('"./store.js"', JSON.stringify(storeUrl))
    .replace('"./views.js"', JSON.stringify(viewsUrl))
    .replace('"./dom.js"', JSON.stringify(domUrl))
    .replace(
      'const { mountAuthScreen } = await import("./auth-screen.js");',
      'const mountAuthScreen = (_root, finish) => finish({ id: "test", name: "Test", role: "admin" });',
    );
  const timers = new Map();
  const realTimeout = globalThis.setTimeout;
  const realClear = globalThis.clearTimeout;
  globalThis.setTimeout = (fn, ms) => { timers.set(ms, fn); return ms; };
  globalThis.clearTimeout = (id) => timers.delete(id);
  try {
    await import(moduleUrl(source));
    const boot = events.document.get("DOMContentLoaded")();
    await Promise.resolve();
    timers.get(9000)(); // reloj controlado: SQLite continúa sin resolver
    assert.equal(calls.filter(([name]) => name === "render").length, 0);
    assert.match(calls.at(-1)[1], /proteger tus cambios/);
    for (const selector of ["[data-action]", "[data-filter-status]", "[data-filter-direction]"]) {
      events.document.get("click")({ target: new Element(selector), preventDefault() {} });
    }
    events.document.get("input")({});
    events.document.get("change")({});
    location.hash = "#/proveedores";
    events.window.get("hashchange")();
    assert.equal(calls.some(([name]) => name.startsWith("on")), false);
    assert.match(calls.at(-1)[1], /proteger tus cambios/);
    pending.resolve("sqlite");
    await boot;
    assert.equal(calls.filter(([name]) => name === "render").length, 1);
    assert.equal(timers.has(9000), false);
    events.document.get("input")({});
    events.document.get("change")({});
    events.document.get("click")({ target: new Element("[data-action]"), preventDefault() {} });
    assert.deepEqual(calls.slice(-3).map(([name]) => name), ["onInput", "onChange", "onAction"]);
  } finally {
    globalThis.setTimeout = realTimeout;
    globalThis.clearTimeout = realClear;
  }
});

for (const scenario of ["sqlite existente", "migración local", "fallback local"]) {
  test(`carga lenta con ${scenario}: carga una vez y conserva la siguiente edición`, async () => {
    const { memory, events } = environment();
    const pending = deferred();
    let opens = 0;
    const writes = [];
    globalThis.__startupTest = {
      init: () => { opens++; return pending.promise; },
      readState: () => scenario === "sqlite existente"
        ? { ...localCopy, settings: { businessName: "SQLite anterior" } } : null,
      writeState: (state) => { writes.push(structuredClone(state)); return true; },
    };
    const sqliteUrl = moduleUrl(`
      // Escenario aislado: ${scenario}
      const fixture = globalThis.__startupTest;
      export const init = fixture.init;
      export const readState = fixture.readState;
      export const writeState = fixture.writeState;
      export const persist = async () => true;
      export const isAvailable = () => true;
    `);
    const url = new URL("../assets/js/store.js", import.meta.url);
    const source = (await readFile(url, "utf8"))
      .replace('"./sqlite.js"', JSON.stringify(sqliteUrl))
      .replace(/from "(\.\/[^"]+)"/g, (_, path) => `from ${JSON.stringify(new URL(path, url).href)}`);
    const store = await import(moduleUrl(source + `\n// ${scenario}`));
    const first = store.initStore();
    assert.equal(store.initStore(), first);
    assert.equal(opens, 1);
    assert.equal(store.save(), false);
    assert.equal(await store.flush(), false);
    events.window.get("pagehide")();
    assert.deepEqual(writes, []);
    assert.deepEqual(JSON.parse(memory.get(key)), localCopy);
    pending.resolve(scenario !== "fallback local");
    assert.equal(await first, scenario === "fallback local" ? "local" : "sqlite");
    assert.equal(store.getState().suppliers[0].name, "Proveedor anterior");
    assert.equal(store.getState().settings.businessName,
      scenario === "sqlite existente" ? "SQLite anterior" : "Copia local anterior");
    store.updateSettings({ businessName: "Edición reciente" });
    await store.flush();
    await store.initStore();
    assert.equal(opens, 1);
    assert.equal(store.getState().settings.businessName, "Edición reciente");
    assert.equal(JSON.parse(memory.get(key)).settings.businessName, "Edición reciente");
    if (scenario !== "fallback local") assert.equal(writes.at(-1).settings.businessName, "Edición reciente");
  });
}
