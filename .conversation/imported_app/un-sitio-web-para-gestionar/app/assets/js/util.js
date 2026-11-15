/* Utilidades compartidas: importes, fechas, IGIC, texto. */

export const STATUS = Object.freeze({
  PENDING: "PENDIENTE",
  PAID: "PAGADO",
});

/** Tipos de IGIC que se usan en Canarias. */
export const IGIC_RATES = [
  { value: 0, label: "0 % — tipo cero / exento" },
  { value: 3, label: "3 % — reducido" },
  { value: 7, label: "7 % — general" },
  { value: 9.5, label: "9,5 % — incrementado" },
  { value: 15, label: "15 % — especial" },
  { value: 20, label: "20 % — especial" },
];

const eurFmt = new Intl.NumberFormat("es-ES", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const numFmt = new Intl.NumberFormat("es-ES", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const escMap = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function esc(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (c) => escMap[c]);
}

export function fmtEUR(n) {
  const v = Number(n);
  return eurFmt.format(Number.isFinite(v) ? v : 0);
}

export function fmtNum(n, digits = 2) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  if (digits === 2) return numFmt.format(v);
  return new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(v);
}

export function round2(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/** yyyy-mm-dd → dd/mm/aaaa */
export function fmtDate(iso) {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
  if (!m) return String(iso);
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** Fecha local de hoy en formato yyyy-mm-dd (sin líos de zona horaria). */
export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addDaysISO(iso, days) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Diferencia en días entre hoy y una fecha (negativo = ya pasó). */
export function daysUntil(iso) {
  if (!iso) return null;
  const target = new Date(`${iso}T12:00:00`).getTime();
  const now = new Date(`${todayISO()}T12:00:00`).getTime();
  if (!Number.isFinite(target)) return null;
  return Math.round((target - now) / 86400000);
}

export function uid(prefix = "id") {
  const rnd =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `${prefix}_${rnd}`;
}

/** Minúsculas, sin acentos y con los espacios colapsados. */
export function fold(text) {
  return String(text == null ? "" : text)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function nifKey(nif) {
  return String(nif == null ? "" : nif)
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "");
}

/**
 * Convierte lo que aparece en una factura a número.
 * Entiende «1.234,56», «1234.56», «1234,56», «1 234,56» y «-12,30».
 */
export function parseAmount(raw) {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  let s = String(raw).replace(/\s|\u00a0|'/g, "").replace(/[^\d.,-]/g, "");
  if (!s) return null;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");

  if (lastComma > -1 && lastDot > -1) {
    // El último separador es el decimal.
    if (lastComma > lastDot) s = s.replace(/\./g, "").replace(/,/g, ".");
    else s = s.replace(/,/g, "");
  } else if (lastComma > -1) {
    // «0,853 €/kg» es un precio de verdad, no 853: solo son miles si delante
    // hay una cifra que no sea un cero suelto («1,234» → 1.234).
    const decimals = s.length - lastComma - 1;
    const entero = s.slice(0, lastComma);
    const miles = decimals === 3 && entero !== "" && entero !== "0";
    s = miles ? s.replace(/,/g, "") : s.replace(/,/g, ".");
  } else if (lastDot > -1) {
    const decimals = s.length - lastDot - 1;
    const entero = s.slice(0, lastDot);
    const miles = decimals === 3 && entero !== "" && entero !== "0";
    if (miles) s = s.replace(/\./g, "");
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Cuadra los cuatro importes de una factura a partir de los que se conozcan.
 * Devuelve también qué campos se han calculado ('derived').
 */
export function completeAmounts(input) {
  const derived = [];
  let base = Number.isFinite(input.base) ? input.base : null;
  let rate = Number.isFinite(input.rate) ? input.rate : null;
  let igic = Number.isFinite(input.igic) ? input.igic : null;
  let total = Number.isFinite(input.total) ? input.total : null;

  const has = (v) => v != null && Number.isFinite(v);

  if (!has(rate) && has(base) && has(total) && base > 0) {
    rate = round2((total / base - 1) * 100);
    derived.push("rate");
  }
  if (!has(igic) && has(base) && has(rate)) {
    igic = round2((base * rate) / 100);
    derived.push("igic");
  }
  if (!has(total) && has(base) && has(igic)) {
    total = round2(base + igic);
    derived.push("total");
  }
  if (!has(base) && has(total) && has(igic)) {
    base = round2(total - igic);
    derived.push("base");
  }
  if (!has(base) && has(total) && has(rate) && rate !== -100) {
    base = round2(total / (1 + rate / 100));
    derived.push("base");
    if (!has(igic)) {
      igic = round2(total - base);
      derived.push("igic");
    }
  }
  if (!has(igic) && has(total) && has(base)) {
    igic = round2(total - base);
    derived.push("igic");
  }
  if (!has(rate) && has(igic) && has(base) && base > 0) {
    rate = round2((igic / base) * 100);
    derived.push("rate");
  }
  if (!has(total) && has(base)) {
    total = round2(base + (has(igic) ? igic : 0));
    derived.push("total");
  }

  return { base, rate, igic, total, derived };
}

/** Comprueba si base + igic = total (con un céntimo de margen). */
export function amountsBalance(base, igic, total) {
  if (![base, igic, total].every((v) => Number.isFinite(v))) return true;
  return Math.abs(round2(base + igic) - round2(total)) <= 0.02;
}

export function monthKey(iso) {
  return String(iso || "").slice(0, 7);
}

export function monthLabel(key) {
  const names = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const [y, m] = String(key).split("-");
  const idx = Number(m) - 1;
  if (!names[idx] || !y) return key;
  return `${names[idx]} ${y.slice(2)}`;
}

/** Últimos n meses (incluido el actual), del más antiguo al más nuevo. */
export function lastMonths(n) {
  const out = [];
  const d = new Date();
  d.setDate(1);
  for (let i = n - 1; i >= 0; i--) {
    const c = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push(`${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

export function initials(name) {
  const parts = fold(name).split(" ").filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function downloadBytes(filename, bytes, mime = "application/octet-stream") {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function downloadText(filename, text, mime = "text/csv;charset=utf-8") {
  downloadBytes(filename, text, mime);
}
