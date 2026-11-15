import { parseAmount, round2 } from "./util.js";

// No usar fragmentos de un precio de cuatro decimales, NIF, IBAN o teléfono.
const MONEY = /(?<![\d.,])\d{1,3}(?:[.\s]\d{3})*[.,]\d{2}(?![\d.,])|(?<![\d.,])\d+[.,]\d{2}(?![\d.,])/g;

/**
 * Recupera un resumen de columnas desordenadas por inclinación/OCR.
 * Sólo acepta una combinación única base + cuota = total, no escoge
 * simplemente el mayor número de la factura.
 */
export function recoverInvoiceSummary(lines) {
  const normalized = lines.map((s) => String(s).replace(/\s+/g, " ").trim());
  const candidates = [];
  for (let i = 0; i < normalized.length; i++) {
    if (!/\bTOTAL\b/i.test(normalized[i])) continue;
    const window = normalized.slice(Math.max(0, i - 3), i + 9);
    const end = window.findIndex((s, index) => index > 2 && /\b(?:firma|receptor|recib[ií]|carta de porte)\b/i.test(s));
    const footer = (end < 0 ? window : window.slice(0, end)).join("\n");
    if (!/\bBASE\s*(?:IMP|IMPONIBLE)\b/i.test(footer) || !/\bI\.?G\.?I\.?C\b/i.test(footer)) continue;
    const values = [...new Set((footer.match(MONEY) || []).map(parseAmount).filter((n) => n != null))];
    for (const base of values) {
      if (!(base > 0)) continue;
      for (const igic of values) {
        if (!(igic > 0) || igic > base * 0.4) continue;
        const total = values.find((n) => n > base && Math.abs(round2(base + igic) - n) <= 0.011);
        if (total == null) continue;
        const rate = round2(igic / base * 100);
        candidates.push({ base, igic, total, rate });
      }
    }
  }
  const unique = [...new Map(candidates.map((c) => [`${c.base}/${c.igic}/${c.total}`, c])).values()];
  return unique.length === 1 ? unique[0] : null;
}
