import { fold, round2 } from "./util.js";

const number = (value) => {
  if (value == null || value === "" || typeof value === "boolean") return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
};
const sumKg = (n) => Math.round(n * 1e6) / 1e6;
const canonicalCategory = (name) => {
  const label = String(name || "").replace(/_+$/, "").trim();
  const known = { super: "Súper", primera: "Primera", segunda: "Segunda", extra: "Extra", "2b": "2B" };
  return known[fold(label)] || label || "Sin categoría";
};

/** One entry per final-summary category, never an extra entry for its parent total. */
export function fruitEntries(invoices, filters = {}) {
  const entries = [];
  for (const inv of invoices || []) {
    if (inv.kind !== "LIQUIDACION") continue;
    const liquid = inv.liquidacion || {};
    const date = String(inv.issueDate || "");
    if ((filters.from && (!date || date < filters.from)) ||
        (filters.to && (!date || date > filters.to))) continue;
    const product = String(liquid.product || "").trim() || "Sin producto";
    if (filters.product && product !== filters.product) continue;
    const kg = number(liquid.kg);
    const price = number(liquid.price);
    const discounts = (liquid.discounts || []).reduce((s, d) => s + (number(d.amount) ?? 0), 0);
    const base = number(inv.base);
    const amount = base != null ? round2(base + discounts)
      : kg != null && price != null ? round2(kg * price) : null;
    const source = {
      invoiceId: inv.id, number: inv.number || "Sin número", date,
      buyer: inv.supplierName || "Sin comprador", product,
    };
    const detail = (liquid.partidas || []).filter((p) => p && number(p.kg) != null);
    const detailedKg = sumKg(detail.reduce((s, p) => s + number(p.kg), 0));
    const allAmountsKnown = detail.every((p) => number(p.gross) != null);
    const detailedAmount = round2(detail.reduce((s, p) => s + (number(p.gross) ?? 0), 0));
    const matches = detail.length > 0 && (kg == null || Math.abs(detailedKg - kg) <= 0.021) &&
      (!allAmountsKnown || amount == null || Math.abs(detailedAmount - amount) <= 0.021);
    const push = (entry) => {
      if (!filters.category || entry.category === filters.category) entries.push({ ...source, ...entry });
    };
    if (matches) {
      for (const row of detail) {
        const rowKg = number(row.kg);
        const rowPrice = number(row.price);
        const printed = number(row.gross);
        push({
          category: canonicalCategory(row.categoria), kg: rowKg, price: rowPrice,
          amount: printed != null ? printed : rowPrice != null ? round2(rowKg * rowPrice) : null,
          warning: printed == null && rowPrice != null
            ? "Importe de categoría calculado con su precio; puede estar redondeado."
            : printed == null ? "Falta el importe de una categoría." : "",
        });
      }
    } else {
      push({
        category: detail.length ? "Sin desglose fiable" : canonicalCategory(liquid.category),
        kg, price, amount,
        warning: detail.length
          ? "El desglose no coincide con el total de la liquidación. Se cuenta el total una sola vez, sin atribuirlo a categorías."
          : kg == null ? "Liquidación sin kilos registrados."
          : base == null ? "Importe calculado con el precio por kilo; falta la base del documento."
          : "",
      });
    }
  }
  return entries.sort((a, b) => b.date.localeCompare(a.date) || a.number.localeCompare(b.number));
}

function aggregate(entries) {
  const kg = sumKg(entries.reduce((s, e) => s + (e.kg ?? 0), 0));
  const amount = round2(entries.reduce((s, e) => s + (e.amount ?? 0), 0));
  const priced = entries.filter((e) => e.amount != null && e.kg != null && e.kg !== 0);
  const pricedKg = sumKg(priced.reduce((s, e) => s + e.kg, 0));
  const pricedAmount = priced.reduce((s, e) => s + e.amount, 0);
  return {
    kg, amount, pricedKg, averagePrice: pricedKg !== 0 ? pricedAmount / pricedKg : null,
    count: new Set(entries.map((e) => e.invoiceId)).size,
    unknownAmountCount: entries.filter((e) => e.amount == null).length,
  };
}

export function fruitStats(entries) {
  const groups = (getKey, keyName) => {
    const map = new Map();
    for (const entry of entries) {
      const key = getKey(entry);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(entry);
    }
    return [...map].map(([key, list]) => ({ [keyName]: key, ...aggregate(list) }));
  };
  return {
    ...aggregate(entries),
    warnings: [...new Set(entries.map((e) => e.warning).filter(Boolean))],
    categories: groups((e) => e.category, "category").sort((a, b) => b.kg - a.kg),
    months: groups((e) => e.date.slice(0, 7) || "Sin fecha", "month")
      .sort((a, b) => a.month.localeCompare(b.month)),
  };
}
