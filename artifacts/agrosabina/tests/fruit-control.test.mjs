import test from "node:test";
import assert from "node:assert/strict";
import { fruitEntries, fruitStats } from "../assets/js/fruit-control.js";
import { normalizeExtraction } from "../assets/js/ai-extraction.js";
import { renderFruitControl } from "../assets/js/fruit-control-view.js";

const settlement = {
  id: "one", kind: "LIQUIDACION", number: "3158", issueDate: "2026-11-12", base: 1914.46,
  liquidacion: { product: "Plátano", kg: 3434, price: 0.5575, discounts: [], partidas: [
    { categoria: "Gabaceras", kg: 1474, price: 0.7535, gross: 1110.7 },
    { categoria: "Super_", kg: 1224, price: 0.5958, gross: 729.3 },
    { categoria: "Primera", kg: 357, price: 0.2086, gross: 74.46 },
    { categoria: "Segunda", kg: 289, price: 0, gross: 0 },
    { categoria: "2B", kg: 90, price: 0, gross: 0 },
  ] },
};

test("recuenta categorías una sola vez y conserva kilos a precio cero", () => {
  const rows = fruitEntries([settlement, { kind: "FACTURA", base: 500 }]);
  const stats = fruitStats(rows);
  assert.equal(rows.length, 5);
  assert.equal(stats.kg, 3434);
  assert.equal(stats.amount, 1914.46);
  assert.equal(stats.count, 1);
  assert.equal(stats.categories.find((c) => c.category === "Segunda").kg, 289);
  assert.equal(stats.categories.find((c) => c.category === "Segunda").averagePrice, 0);
  assert.equal(rows.find((r) => r.category === "Súper").price, 0.5958);
  assert.equal(stats.averagePrice, 1914.46 / 3434);
});

test("precios ponderados por kilos, nunca media simple entre liquidaciones", () => {
  const rows = [
    { invoiceId: "a", date: "2026-10-01", category: "Primera", kg: 100, price: 1, amount: 100 },
    { invoiceId: "b", date: "2026-11-01", category: "Primera", kg: 900, price: 2, amount: 1800 },
  ];
  const stats = fruitStats(rows);
  assert.equal(stats.averagePrice, 1.9);
  assert.equal(stats.categories[0].averagePrice, 1.9);
  assert.equal(stats.months.length, 2);
});

test("filtra fechas inclusivas, categoría y producto sin tocar los documentos", () => {
  const snapshot = JSON.stringify(settlement);
  assert.equal(fruitEntries([settlement], { from: "2026-11-12", to: "2026-11-12" }).length, 5);
  assert.equal(fruitEntries([settlement], { from: "2026-11-13" }).length, 0);
  assert.equal(fruitEntries([settlement], { to: "2026-11-11" }).length, 0);
  assert.equal(fruitEntries([settlement], { category: "Primera", product: "Plátano" })[0].kg, 357);
  assert.equal(fruitEntries([settlement], { product: "Aguacate" }).length, 0);
  assert.equal(JSON.stringify(settlement), snapshot);
});

test("si hay doble recuento o datos contradictorios conserva el total sin inventar categorías", () => {
  const bad = structuredClone(settlement);
  bad.liquidacion.partidas.push(...structuredClone(bad.liquidacion.partidas));
  const rows = fruitEntries([bad]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].category, "Sin desglose fiable");
  assert.equal(fruitStats(rows).kg, 3434);
  assert.equal(fruitStats(rows).amount, 1914.46);
  assert.equal(fruitStats(rows).warnings.length, 1);
});

test("distingue precios desconocidos de cero y no aplica el precio medio a categorías sin importe", () => {
  const partial = structuredClone(settlement);
  partial.liquidacion.partidas[0].price = null;
  partial.liquidacion.partidas[0].gross = null;
  const stats = fruitStats(fruitEntries([partial]));
  assert.equal(stats.unknownAmountCount, 1);
  assert.equal(stats.pricedKg, 1960);
  assert.equal(stats.amount, 803.76);
  assert.ok(stats.warnings.length > 0);
});

test("la IA conserva el desglose y detecta si vuelve a contar las categorías dos veces", () => {
  const json = {
    tipo: "LIQUIDACION", proveedor: "Comercial de prueba", confianza: 0.95,
    base: 1914.46, igic: 0, total: 1914.46,
    liquidacion: { kilos: 3434, precio: 0.5575, bruto: 1914.46, liquido: 1914.46,
      partidas: settlement.liquidacion.partidas.map((p) => ({
        categoria: p.categoria, kilos: p.kg, precio: p.price, bruto: p.gross,
      })) },
  };
  const valid = normalizeExtraction(json);
  assert.equal(valid.settlementValid, true);
  assert.equal(valid.liquidacion.partidas.length, 5);
  assert.equal(valid.liquidacion.partidas[4].gross, 0);
  assert.equal(valid.liquidacion.partidas[1].price, 0.5958);
  json.liquidacion.partidas.push(...structuredClone(json.liquidacion.partidas));
  assert.equal(normalizeExtraction(json).settlementValid, false);
});

test("la pantalla presenta el recuento real y filtra sin modificar lo guardado", () => {
  const listeners = {};
  const form = { addEventListener: (name, fn) => { listeners[name] = fn; } };
  const container = {
    innerHTML: "", querySelector: (selector) => selector === "[data-fc-form]" ? form : null,
    querySelectorAll: () => [],
  };
  const initial = JSON.stringify(settlement);
  renderFruitControl(container, [settlement]);
  assert.match(container.innerHTML, /Por categoría/);
  assert.match(container.innerHTML, /Por mes de emisión/);
  assert.match(container.innerHTML, /5 líneas/);
  assert.match(container.innerHTML, /0,595800/);
  listeners.change({ target: { name: "category", value: "Primera" } });
  assert.match(container.innerHTML, /1 línea/);
  assert.match(container.innerHTML, /357,00/);
  listeners.change({ target: { name: "from", value: "2026-11-13" } });
  assert.match(container.innerHTML, /Nada con esos filtros/);
  listeners.change({ target: { name: "category", value: "" } });
  listeners.change({ target: { name: "from", value: "" } });
  assert.equal(JSON.stringify(settlement), initial);
});
