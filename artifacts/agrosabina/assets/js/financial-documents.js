import { parseAmount, round2 } from "./util.js";
import { normalizarCodigoCuenta } from "./pgc.js";

export const FINANCIAL_KINDS = ["IGIC", "RECIBO_BANCARIO", "PRESTAMO", "POLIZA_CREDITO"];
export const isFinancial = (kind) => FINANCIAL_KINDS.includes(String(kind || "").toUpperCase());
export function financialHasCash(doc) {
  return !isFinancial(doc?.kind) || !["DECLARACION", "RECLASIFICACION", "JUSTIFICANTE", "ARCHIVO"].includes(doc.financial?.operation);
}
export function financialProfitAmount(doc) {
  const f = doc.financial || {};
  if ((doc.kind === "PRESTAMO" && f.operation === "CUOTA") ||
      (doc.kind === "POLIZA_CREDITO" && f.operation === "LIQUIDACION")) return round2(Number(f.interest || 0) + Number(f.fees || 0));
  return doc.kind === "RECIBO_BANCARIO" && f.operation === "GASTO" ? Number(doc.total || 0) : 0;
}
export const FINANCIAL_OPERATIONS = {
  IGIC: [["DECLARACION", "Declaración / liquidación simple"], ["PAGO", "Justificante de ingreso"], ["DEVOLUCION", "Devolución recibida"], ["ARCHIVO", "Informativo o ajustes · sin asiento automático"]],
  RECIBO_BANCARIO: [["JUSTIFICANTE", "Justificante de documento existente"], ["GASTO", "Gasto bancario nuevo"]],
  PRESTAMO: [["CUOTA", "Cuota de préstamo"], ["ALTA", "Desembolso de préstamo nuevo"], ["RECLASIFICACION", "Reclasificación de largo a corto plazo"]],
  POLIZA_CREDITO: [["LIQUIDACION", "Liquidación de intereses y comisiones"], ["DISPOSICION", "Capital dispuesto"], ["REEMBOLSO", "Reembolso de capital"]],
};
const amounts = ["capitalShort", "capitalLong", "interest", "fees", "reclassAmount", "taxOutput", "taxInput"];
export function normalizeFinancial(value, kind) {
  if (!isFinancial(kind)) return null;
  const raw = value && typeof value === "object" ? value : {};
  const str = (key, fallback = "") => String(raw[key] ?? fallback).trim().slice(0, 160);
  const out = {
    operation: str("operation", FINANCIAL_OPERATIONS[kind][0][0]),
    reference: str("reference"), linkedDocumentId: str("linkedDocumentId"),
    shortAccount: normalizarCodigoCuenta(str("shortAccount", "520000")) || "520000",
    longAccount: normalizarCodigoCuenta(str("longAccount", "170000")) || "170000",
    creditAccount: normalizarCodigoCuenta(str("creditAccount", "520100")) || "520100",
    counterAccount: normalizarCodigoCuenta(str("counterAccount")),
  };
  for (const key of amounts) {
    const value = raw[key];
    out[key] = value == null || value === "" ? null : typeof value === "number"
      ? Number.isFinite(value) ? round2(value) : null : parseAmount(String(value));
  }
  return out;
}
export function financialDirection(kind, financial) {
  return (kind === "PRESTAMO" && financial?.operation === "ALTA") ||
    (kind === "POLIZA_CREDITO" && financial?.operation === "DISPOSICION") ||
    (kind === "IGIC" && financial?.operation === "DEVOLUCION") ? "INGRESO" : "GASTO";
}
export function financialError(doc) {
  if (!isFinancial(doc.kind)) return "";
  const f = normalizeFinancial(doc.financial, doc.kind);
  const n = (key) => Number(f[key] ?? 0);
  if (!FINANCIAL_OPERATIONS[doc.kind].some(([key]) => key === f.operation)) return "Selecciona una operación financiera válida.";
  if (amounts.some((key) => f[key] != null && f[key] < 0)) return "Los importes del desglose no pueden ser negativos.";
  if (doc.kind === "PRESTAMO" || doc.kind === "POLIZA_CREDITO") {
    if (!f.reference) return "Indica la referencia del contrato para controlar su deuda.";
  }
  if (doc.kind === "PRESTAMO" && (!/^5200\d{2}$/.test(f.shortAccount) || !/^170\d{3}$/.test(f.longAccount))) {
    return "Usa subcuentas de seis cifras: 5200xx para corto plazo y 170xxx para largo plazo.";
  }
  if (doc.kind === "POLIZA_CREDITO" && !/^5201\d{2}$/.test(f.creditAccount)) return "Usa una subcuenta 5201xx para la póliza de crédito.";
  let expected = null;
  if (doc.kind === "PRESTAMO") {
    if (f.operation === "RECLASIFICACION") expected = f.reclassAmount;
    else {
      if (f.capitalShort == null || f.capitalLong == null) return "Indica el capital a corto y largo plazo, incluso si uno es cero.";
      if (f.operation === "CUOTA" && (f.interest == null || f.fees == null)) return "Separa capital, intereses y comisiones; escribe cero si no existen.";
      expected = n("capitalShort") + n("capitalLong") + (f.operation === "CUOTA" ? n("interest") + n("fees") : 0);
    }
  } else if (doc.kind === "POLIZA_CREDITO") {
    if (f.operation === "LIQUIDACION") {
      if (f.interest == null || f.fees == null) return "Indica intereses y comisiones de la póliza, incluso cuando sean cero.";
      expected = n("interest") + n("fees");
    } else expected = f.capitalShort;
  } else if (doc.kind === "IGIC" && f.operation === "DECLARACION") {
    if (f.taxOutput == null || f.taxInput == null) return "Indica IGIC repercutido y soportado. Los ajustes y compensaciones requieren un asiento manual.";
    expected = Math.abs(round2(n("taxOutput") - n("taxInput")));
  }
  if (expected != null && Math.abs(round2(expected - Number(doc.total))) > 0.01) return "El desglose financiero no coincide con el importe total.";
  if (expected == null && ["RECLASIFICACION", "DISPOSICION", "REEMBOLSO"].includes(f.operation)) return "Falta el importe de capital o reclasificación.";
  if (!Number.isFinite(doc.total) || doc.total < 0) return "Indica un importe total válido.";
  if (f.operation === "RECLASIFICACION" && !f.reclassAmount) return "Indica el capital que vence en los próximos doce meses.";
  if (doc.kind === "RECIBO_BANCARIO") {
    if (f.operation === "JUSTIFICANTE" && !f.linkedDocumentId) return "Selecciona el documento que justifica el recibo; no se generará otro asiento.";
    if (f.operation === "GASTO" && !/^6\d{5}$/.test(f.counterAccount)) return "Indica una cuenta de gasto de seis cifras (grupo 6). No uses esta opción para un gasto ya registrado.";
  }
  if (doc.status === "PAGADO" && !["DECLARACION", "RECLASIFICACION", "JUSTIFICANTE", "ARCHIVO"].includes(f.operation)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(doc.paidDate || "")) return "Indica la fecha real del movimiento bancario.";
    if (!["transferencia", "tarjeta", "banco"].includes(String(doc.payMethod || "").toLowerCase())) {
      // The app also supports its existing uppercase payment-method identifiers.
      if (!["BANCO", "TRANSFERENCIA", "TARJETA"].includes(doc.payMethod)) return "Selecciona un medio de pago bancario para este documento.";
    }
  }
  return "";
}

/** Conservative local extraction: only amounts with explicit printed labels. */
export function parseFinancialText(text, kind) {
  const raw = String(text || "");
  const read = (label) => {
    const match = raw.match(new RegExp(`(?:${label})\\s*[:=]?\\s*(\\d[\\d.,]*(?:[ \\u00a0]\\d{3})*(?:[.,]\\d{1,2})?)\\s*(?:€|EUR)?`, "i"));
    return match ? parseAmount(match[1]) : null;
  };
  const financial = normalizeFinancial({
    capitalShort: read("capital (?:a corto plazo|corto plazo)|amortizaci[oó]n (?:de capital|principal)|capital amortizado"),
    capitalLong: read("capital (?:a largo plazo|largo plazo)"),
    interest: read("intereses(?: deudores)?"), fees: read("comisiones"),
    taxOutput: read("IGIC repercutido"), taxInput: read("IGIC soportado"),
  }, kind);
  if (kind === "IGIC" && /modelo\s*425|compensaciones?\s+(?:anteriores|previas)|prorrata/i.test(raw)) financial.operation = "ARCHIVO";
  const total = read("total (?:recibo|cuota|a pagar|liquidaci[oó]n)|importe (?:total|adeudado)|l[ií]quido a (?:ingresar|devolver)");
  return { financial, total };
}

/** Raw journal lines. Payment is separate from accrual; principal is never expense. */
export function financialJournal(doc, bankAccount) {
  const error = financialError(doc);
  if (error) return [];
  const f = normalizeFinancial(doc.financial, doc.kind);
  const n = (key) => Number(f[key] || 0);
  const total = Number(doc.total || 0);
  const events = [];
  const add = (suffix, date, raw) => {
    if (date && raw.some(([, amount]) => amount)) events.push({ suffix, date, raw });
  };
  const paid = doc.status === "PAGADO" && doc.paidDate;
  const payment = (raw) => { if (paid) add("movimiento", doc.paidDate, raw); };
  const costs = () => {
    add("devengo", doc.issueDate, [["662000", n("interest")], ["626000", n("fees")], ["527000", -n("interest")], ["410000", -n("fees")]]);
  };
  if (doc.kind === "PRESTAMO") {
    if (f.operation === "RECLASIFICACION") add("reclasificacion", doc.issueDate, [[f.longAccount, n("reclassAmount")], [f.shortAccount, -n("reclassAmount")]]);
    if (f.operation === "ALTA") payment([[bankAccount, total], [f.shortAccount, -n("capitalShort")], [f.longAccount, -n("capitalLong")]]);
    if (f.operation === "CUOTA") {
      costs();
      payment([[f.shortAccount, n("capitalShort")], [f.longAccount, n("capitalLong")], ["527000", n("interest")], ["410000", n("fees")], [bankAccount, -total]]);
    }
  } else if (doc.kind === "POLIZA_CREDITO") {
    if (f.operation === "LIQUIDACION") {
      costs();
      payment([["527000", n("interest")], ["410000", n("fees")], [bankAccount, -total]]);
    } else payment(f.operation === "DISPOSICION"
      ? [[bankAccount, total], [f.creditAccount, -total]]
      : [[f.creditAccount, total], [bankAccount, -total]]);
  } else if (doc.kind === "IGIC") {
    if (f.operation === "DECLARACION") {
      const difference = round2(n("taxOutput") - n("taxInput"));
      add("liquidacion-igic", doc.issueDate, [["477000", n("taxOutput")], ["472000", -n("taxInput")], [difference >= 0 ? "475000" : "470000", -difference]]);
    } else if (f.operation !== "ARCHIVO") payment(f.operation === "DEVOLUCION"
      ? [[bankAccount, total], ["470000", -total]] : [["475000", total], [bankAccount, -total]]);
  } else if (doc.kind === "RECIBO_BANCARIO" && f.operation === "GASTO") {
    add("devengo", doc.issueDate, [[f.counterAccount, total], ["410000", -total]]);
    payment([["410000", total], [bankAccount, -total]]);
  }
  return events;
}

/** Short and long debt from journal balances, including opening and manual entries. */
export function debtBalances(entries) {
  const balances = new Map();
  for (const entry of entries) for (const line of entry.lines || []) {
    const account = String(line.account || "");
    if (!/^(170|520)/.test(account)) continue;
    balances.set(account, round2((balances.get(account) || 0) + Number(line.credit || 0) - Number(line.debit || 0)));
  }
  return [...balances].map(([account, amount]) => ({ account, amount, term: account.startsWith("170") ? "Largo plazo" : "Corto plazo" }));
}
