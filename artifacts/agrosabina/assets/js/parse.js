/*
 * Lectura de una factura.
 * Entra el texto (de un PDF o del OCR de una foto) y salen los datos ordenados.
 * Todo son reglas pensadas para facturas españolas: no hay ningún servicio detrás.
 */

import {
  STATUS,
  completeAmounts,
  fold,
  fmtEUR,
  fmtNum,
  nifKey,
  normaliseSpanishNif,
  parseAmount,
  round2,
  todayISO,
} from "./util.js";
import { leerResumenLiquidacion } from "./liquidacion-resumen.js";
import { recoverInvoiceSummary } from "./invoice-summary.js";

/* ------------------------------------------------------------------ */
/* Números                                                             */
/* ------------------------------------------------------------------ */

/*
 * Los lectores de fotos confunden letras con números (O por 0, l por 1, S por
 * 5, B por 8). En los importes se corrigen sin peligro: el patrón exige
 * decimales y un importe nunca lleva letras.
 */
function fixDigits(raw) {
  return String(raw || "")
    .replace(/[OoQ]/g, "0")
    .replace(/[Il|!]/g, "1")
    .replace(/[Ss]/g, "5")
    .replace(/[Bb]/g, "8");
}

const MONEY_2 = String.raw`\d{1,3}(?:[.\s]\d{3})*[.,][\dOoIlSsBb]{2}|\d{1,7}[.,][\dOoIlSsBb]{2}`;
const MONEY_ANY = String.raw`-?\d{1,3}(?:[.\s]\d{3})*(?:[.,]\d{1,2})?|-?\d+(?:[.,]\d{1,2})?`;

/** Todos los importes de un trozo de texto, con su posición. */
export function moneyIn(text) {
  const src = String(text || "");
  const out = [];
  let m;

  const re2 = new RegExp(MONEY_2, "g");
  while ((m = re2.exec(src))) {
    const v = parseAmount(fixDigits(m[0]));
    if (v != null) out.push({ value: v, raw: m[0], index: m.index });
  }
  if (out.length) return out;

  const reAny = new RegExp(MONEY_ANY, "g");
  while ((m = reAny.exec(src))) {
    const after = src[m.index + m[0].length] || "";
    const before = src[m.index - 1] || "";
    if (after === "%" || after === "/" || before === "/" || before === "%") continue;
    const v = parseAmount(m[0]);
    if (v != null && Math.abs(v) > 0) out.push({ value: v, raw: m[0], index: m.index });
  }
  return out;
}

/** El primer importe que aparece después de la etiqueta. */
function moneyAfterLabel(line, labelRe) {
  const m = labelRe.exec(line);
  if (!m) return null;
  const tail = line.slice(m.index + m[0].length);
  const nums = moneyIn(tail);
  return nums.length ? nums[0].value : null;
}

/* ------------------------------------------------------------------ */
/* Fechas                                                             */
/* ------------------------------------------------------------------ */

const MONTHS = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10,
  noviembre: 11, diciembre: 12,
  // Abreviaturas que aparecen en las facturas: «14-nov-2024».
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6,
  jul: 7, ago: 8, sep: 9, sept: 9, set: 9, oct: 10, nov: 11, dic: 12,
  // Y con punto detrás, que se quita al plegar: «14 nov. 2024».
};

function isoFrom(y, m, d) {
  const yy = Number(y);
  const mm = Number(m);
  const dd = Number(d);
  if (!(yy > 1900 && yy < 2200) || mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

/** Busca fechas en una línea y las devuelve en ISO. */
export function datesIn(line) {
  const found = [];
  const src = String(line || "");

  // dd/mm/aaaa, dd-mm-aaaa, dd.mm.aa
  const reNum = /\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})\b/g;
  let m;
  while ((m = reNum.exec(src))) {
    let y = m[3];
    if (y.length === 2) y = String(Number(y) < 70 ? 2000 + Number(y) : 1900 + Number(y));
    const iso = isoFrom(y, m[2], m[1]);
    if (iso) found.push(iso);
  }

  // aaaa-mm-dd
  const reIso = /\b(\d{4})[/.\-](\d{1,2})[/.\-](\d{1,2})\b/g;
  while ((m = reIso.exec(src))) {
    const iso = isoFrom(m[1], m[2], m[3]);
    if (iso) found.push(iso);
  }

  // «12 de marzo de 2024» / «12 marzo 2024»
  const reText = /\b(\d{1,2})\s*(?:de\s+)?([a-záéíóúñ]+)\s*(?:de\s+)?(\d{4})\b/gi;
  while ((m = reText.exec(src))) {
    const key = fold(m[2]);
    const month = MONTHS[key];
    if (month) {
      const iso = isoFrom(m[3], month, m[1]);
      if (iso) found.push(iso);
    }
  }

  return found;
}

/* ------------------------------------------------------------------ */
/* Proveedor                                                          */
/* ------------------------------------------------------------------ */

const NIF_RE = /\b([ABCDEFGHJNPQRSUVW]\s?[-–]?\s?\d{7}\s?[-–]?\s?[0-9A-J])\b|\b(\d{8}\s?[-–]?\s?[A-Z])\b/g;

const CUSTOMER_WORDS = [
  "cliente", "facturar a", "facturado a", "destinatario", "receptor",
  "datos del cliente", "nombre del cliente", "a la atencion de", "a la atención de",
];

const SUPPLIER_WORDS = ["proveedor", "emisor", "vendedor", "expedidor", "datos del emisor"];

const NOISE_WORDS = [
  "factura", "facturas", "fra.", "fra ", "fecha", "cif", "nif", "n.i.f", "c.i.f",
  "telefono", "teléfono", "tel.", "movil", "móvil", "email", "e-mail", "correo",
  "calle", "avda", "avenida", "c/", "plaza", "poligono", "polígono", "cp ", "c.p.",
  "codigo postal", "código postal", "www", "http", "@", "pedido", "albaran", "albarán",
  "cliente", "total", "base", "igic", "iva", "forma de pago", "vencimiento",
  "domicilio", "iban", "banco", "tel", "fax", "pagina", "página", "ref.", "referencia",
];

const LEGAL_SUFFIX = /\b(s\.?\s?l\.?\s?u?\.?|s\.?\s?a\.?\s?u?\.?|s\.?\s?c\.?\s?c\.?\s?l?\.?|s\.?\s?coop\.?|c\.?\s?b\.?|s\.?\s?r\.?\s?l\.?|sociedad|limitada|hermanos|eirl)\b/i;

function looksLikeName(line) {
  const t = String(line || "").trim();
  if (t.length < 3 || t.length > 70) return false;
  const low = fold(t);
  if (!/[a-z]/.test(low)) return false;
  // No buscar subcadenas vacías ni «c/» como la letra «c» de «Comercial».
  // Las palabras de etiquetas se buscan completas; los símbolos, literalmente.
  if (NOISE_WORDS.some((w) => {
    if (w === "c/") return /\bc\//i.test(t);
    const word = fold(w);
    return word ? new RegExp(`(?:^|\\s)${word}(?:\\s|$)`).test(low) : t.includes(w);
  })) return false;
  if (/\d{4,}/.test(t)) return false;
  if (/^[\d\s.,\-\/]+$/.test(t)) return false;
  return true;
}

function cleanName(name) {
  return String(name || "")
    .replace(/^(?:proveedor|emisor|vendedor|raz[oó]n social|nombre|empresa|datos del emisor)\s*[:\-]?\s*/i, "")
    .replace(/\s*[-–|,;]\s*(?:c\.?i\.?f\.?|n\.?i\.?f\.?)?\s*[A-Z]?\d{7,8}\s?[0-9A-Z]?\s*$/i, "")
    .replace(/[\s.,;:\-–]+$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function findNifs(lines) {
  const hits = [];
  lines.forEach((line, i) => {
    NIF_RE.lastIndex = 0;
    const found = new Map();
    let m;
    while ((m = NIF_RE.exec(line))) {
      const raw = (m[1] || m[2] || "").trim();
      found.set(nifKey(raw), raw);
    }
    // El OCR puede confundir un carácter en el cuerpo o en el control del CIF.
    // Se recogen candidatos cercanos al formato, pero solo se aceptan tras
    // validar el control y resolver una única corrección visual posible.
    const ocrCandidates = /\b([A-Z0-9][A-Z0-9\-–]{7,8})\b/gi;
    while ((m = ocrCandidates.exec(line))) {
      const raw = m[1].trim();
      found.set(nifKey(raw), raw);
    }
    for (const raw of found.values()) {
      const nif = normaliseSpanishNif(raw, { repairOcr: true });
      hits.push({
        nif,
        valid: !!nif,
        raw,
        key: nifKey(raw),
        line: i,
      });
    }
  });
  return hits;
}

function pickSupplierName(lines, nifLineIndex) {
  const candidates = [];
  const limit = Math.min(lines.length, 16);

  for (let i = 0; i < limit; i++) {
    const line = lines[i];
    if (!looksLikeName(line)) continue;

    let score = 0;
    const raw = line.trim();
    if (LEGAL_SUFFIX.test(raw)) score += 4;
    if (raw === raw.toUpperCase() && /[A-ZÁÉÍÓÚÑ]/.test(raw)) score += 2;
    if (raw.length >= 4 && raw.length <= 42) score += 1;
    if (/\b(proveedor|emisor)\b/i.test(raw)) score += 3;
    if (nifLineIndex != null && Math.abs(i - nifLineIndex) <= 4) score += 3;
    if (i <= 3) score += 1;
    if (/^[A-Z][a-záéíóúñ]+(?:\s+[A-Z][a-záéíóúñ]+){1,3}$/.test(raw)) score += 1;

    candidates.push({ name: cleanName(raw), score, i });
  }

  candidates.sort((a, b) => b.score - a.score || a.i - b.i);
  const best = candidates[0];
  return best && best.name.length >= 3 ? best.name : null;
}

/**
 * El nombre del cliente o comprador, que es quien emite una liquidación de
 * fruta. Se busca detrás de su etiqueta («Cliente:», «Comprador:»…) y, si la
 * etiqueta va sola, en las dos líneas siguientes.
 */
const CLIENT_LABELS =
  /(?:cliente|comprador|destinatario|facturar\s+a|a\s+nombre\s+de|raz[oó]n\s+social\s+del\s+comprador|empresa\s+compradora|recib[íi]\s+de)\s*[:\-–]?\s*/i;

function pickClientName(lines) {
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] || "";
    const m = CLIENT_LABELS.exec(line);
    if (!m) continue;
    const tail = line.slice(m.index + m[0].length).trim();
    if (tail.length >= 3 && /[a-záéíóúñ]/i.test(tail) && !/^\d/.test(tail)) {
      const name = cleanName(tail);
      if (name.length >= 3) return name;
    }
    for (let k = i + 1; k <= i + 2 && k < lines.length; k += 1) {
      const next = (lines[k] || "").trim();
      if (!next || CLIENT_LABELS.test(next)) continue;
      if (/^\d/.test(next)) continue;
      if (!looksLikeName(next) && !LEGAL_SUFFIX.test(next)) continue;
      const name = cleanName(next);
      if (name.length >= 3) return name;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Número de factura                                                  */
/* ------------------------------------------------------------------ */

const NUMBER_LABELS = /(?:l[íi]quidaci[oó]n\s*(?:n[º°o]\.?|n[úu]m(?:ero)?\.?)?|n[º°o]\.?\s*(?:de\s*)?l[íi]quidaci[oó]n|liq\.?\s*n[º°o]\.?|n[úu]m(?:ero)?\.?\s*(?:de\s*)?factura|n[º°o]\.?\s*(?:de\s*)?factura|factura\s*(?:n[º°o]\.?|n[úu]m\.?|n[úu]mero)?|fra\.?\s*(?:n[º°o]\.?)?|invoice\s*(?:no\.?|number)?|referencia\s*factura|doc(?:umento)?\.?\s*n[º°o]?\.?)\s*[:\-–]?\s*/i;

function looksLikeDocNumber(token) {
  const t = String(token || "").trim();
  if (t.length < 2 || t.length > 26) return false;
  if (!/[0-9]/.test(t)) return false;
  if (/^\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}$/.test(t)) return false; // es una fecha
  return /^[A-Za-z0-9][A-Za-z0-9\-–/._]*$/.test(t);
}

function pickInvoiceNumber(lines) {
  const candidates = [];

  lines.forEach((line, i) => {
    const m = NUMBER_LABELS.exec(line);
    if (!m) return;
    const tail = line.slice(m.index + m[0].length).trim();
    const tokens = tail.split(/[\s|;]+/).filter(Boolean).slice(0, 3);
    for (const tok of tokens) {
      const cleaned = tok.replace(/[.,;:]+$/, "");
      if (looksLikeDocNumber(cleaned)) {
        const bonus = /\d{3,}/.test(cleaned) ? 3 : 1;
        candidates.push({ value: cleaned, score: 5 + bonus - i * 0.05, i });
        break;
      }
    }
  });

  if (!candidates.length) {
    // Series típicas: F-2024/012, 24/001234, A-2024-88
    const re = /\b([A-Z]{1,3}[-/]?\d{2,4}[-/]\d{1,6}|\d{4}[-/]\d{3,6})\b/g;
    lines.slice(0, 24).forEach((line, i) => {
      if (datesIn(line).length) return;
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line))) {
        if (looksLikeDocNumber(m[1])) candidates.push({ value: m[1], score: 2 - i * 0.05, i });
      }
    });
  }

  candidates.sort((a, b) => b.score - a.score || a.i - b.i);
  return candidates.length ? candidates[0].value : null;
}

/* ------------------------------------------------------------------ */
/* Importes                                                           */
/* ------------------------------------------------------------------ */

const BASE_LABEL =
  /(?:base\s*imponible|base\s*impon\.?|base\s*gravable|base\s*de\s*la\s*factura|importe\s*neto|importe\s*sin\s*(?:igic|iva)|base\s*a\s*la\s*que|sub\s*total|subtotal)\s*(?:\([^)]*\)|[:.\s])*/i;
const TOTAL_LABEL =
  /(?:importe\s*(?:total|factura|a\s*pagar)|total\s*(?:de\s*la\s*)?factura|total\s*(?:a\s*)?(?:pagar|abonar|cobrar)|total\s*general|total\s*eur|total\s*€|total)\s*(?:\([^)]*\)|[:.\s])*/i;
const CUOTA_LABEL =
  /(?:cuota\s*(?:de\s*)?(?:igic|iva)|cuota\s*(?:igic|iva)|igic\s*repercutido|iva\s*repercutido|igic)\s*(?:\([^)]*\)|[:.\s])*/i;

/** «I.G.I.C.» y «I.V.A.» escritos con puntos: se juntan para poder buscarlos. */
function normLabels(line) {
  return String(line || "")
    .replace(/\bi\s*\.?\s*g\s*\.?\s*i\s*\.?\s*c\s*\.?/gi, "igic")
    .replace(/\bi\s*\.?\s*v\s*\.?\s*a\s*\.?/gi, "iva")
    .replace(/\bimpuesto\s+general\s+indirecto\s+(?:de\s+)?canarias\b/gi, "igic");
}

function cuotaFromLine(line) {
  const pct = line.search(/\d(?:[.,]\d+)?\s*%/);
  if (pct > -1) {
    const pctEnd = line.indexOf("%", pct);
    const tail = line.slice(pctEnd + 1);
    const nums = moneyIn(tail);
    if (nums.length) return nums[0].value;
  }
  const nums = moneyIn(line);
  return nums.length ? nums[nums.length - 1].value : null;
}

function readAmounts(lines) {
  let base = null;
  let total = null;
  let igic = null;
  let rate = null;
  let totalWeak = null;

  for (const rawLine of lines) {
    const line = normLabels(rawLine).replace(/\s+/g, " ").trim();
    if (!line) continue;

    if (base == null && BASE_LABEL.test(line)) {
      const v = moneyAfterLabel(line, BASE_LABEL);
      if (v != null) base = v;
    }

    if (TOTAL_LABEL.test(line) && !/(?:sub\s*total|subtotal|base)/i.test(line)) {
      const v = moneyAfterLabel(line, TOTAL_LABEL);
      if (v != null) {
        if (/factura|a\s*pagar|importe/i.test(line)) {
          if (total == null) total = v;
        } else if (totalWeak == null) {
          totalWeak = v;
        }
      }
    }

    const rateMatch = /(?:igic|iva|impuesto)\D{0,24}?(\d{1,2}(?:[.,]\d{1,2})?)\s*%/i.exec(line)
      || /(\d{1,2}(?:[.,]\d{1,2})?)\s*%\s*(?:de\s*)?(?:igic|iva)/i.exec(line);
    if (rateMatch && rate == null) {
      const r = parseAmount(rateMatch[1]);
      if (r != null && r >= 0 && r <= 40) rate = r;
    }

    const mentionsTax = /igic|iva/i.test(line);
    if (mentionsTax && igic == null) {
      const hasCuota = CUOTA_LABEL.test(line);
      if (hasCuota) {
        const v = moneyAfterLabel(line, CUOTA_LABEL);
        if (v != null) igic = v;
      } else if (/\d\s*%/.test(line) && !/base|total/i.test(line)) {
        const v = cuotaFromLine(line);
        if (v != null) igic = v;
      }
    }
  }

  if (total == null && totalWeak != null) total = totalWeak;

  // Si el IGIC «encontrado» es en realidad la base o el total, no vale.
  if (igic != null && base != null && Math.abs(igic - base) < 0.011) igic = null;
  if (igic != null && total != null && Math.abs(igic - total) < 0.011) igic = null;

  return { base, total, igic, rate };
}

/* ------------------------------------------------------------------ */
/* Estado                                                             */
/* ------------------------------------------------------------------ */

function readStatus(text) {
  const low = fold(text);
  const pending = /\b(pendiente|a pagar|por pagar|no pagad|sin pagar|vencid|impagad|deuda)\b/.test(low);
  const paid = /\b(pagad[oa]|abonad[oa]|cobrad[oa]|recibo|transferencia realizada|liquidada)\b/.test(low);

  if (paid && !pending) return { status: STATUS.PAID, note: null };
  if (pending && !paid) return { status: STATUS.PENDING, note: null };
  if (paid && pending) {
    return {
      status: STATUS.PENDING,
      note: "El documento habla de pago y de pendiente a la vez. La he dejado como pendiente.",
    };
  }
  return { status: STATUS.PENDING, note: null };
}

/* ------------------------------------------------------------------ */
/* Lectura completa                                                   */
/* ------------------------------------------------------------------ */

/**
 * Lee una factura a partir de su texto.
 * @param {string} rawText
 * @param {{ defaultRate?: number, fileName?: string, today?: string }} options
 */
export function parseInvoiceText(rawText, options = {}) {
  const text = String(rawText || "").replace(/\r/g, "");
  const lines = text
    .split("\n")
    .map((l) => l.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trimEnd());

  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  const flat = nonEmpty.join("\n");
  const notes = [];
  const today = options.today || todayISO();

  /* --- proveedor --- */
  const nifs = findNifs(lines);
  const customerLines = new Set();
  lines.forEach((line, i) => {
    const low = fold(line);
    if (/facturar\s*a\b|facturad[oa]\s*a\b|datos del cliente|destinatario/.test(low)) {
      let count = 0;
      for (let k = i; k < lines.length && count < 16; k++) {
        if (k > i && /direcci[oó]n de env[ií]o|forma de pago|descripci[oó]n|detalle de factura/i.test(lines[k])) break;
        customerLines.add(k);
        if (lines[k].trim()) count++;
      }
    } else if (CUSTOMER_WORDS.some((w) => low.includes(fold(w)))) {
      for (let k = i; k <= i + 2 && k < lines.length; k++) customerLines.add(k);
    }
  });

  const firstCustomerLine = customerLines.size ? Math.min(...customerLines) : lines.length;
  const supplierNifCandidates = nifs.filter((h) => h.valid && !customerLines.has(h.line));
  const supplierRank = (hit) => {
    const low = fold(lines[hit.line]);
    let rank = 0;
    if (SUPPLIER_WORDS.some((word) => low.includes(fold(word)))) rank += 8;
    if (/\b(?:nif|cif)\b/i.test(lines[hit.line])) rank += 4;
    if (hit.line < firstCustomerLine) rank += 2;
    if (hit.line < 12) rank += 1;
    return rank;
  };
  const rankedSupplierNifs = supplierNifCandidates
    .map((hit) => ({ hit, rank: supplierRank(hit) }))
    .sort((a, b) => b.rank - a.rank);
  const topSupplierNifs = new Map();
  if (rankedSupplierNifs.length) {
    for (const entry of rankedSupplierNifs) {
      if (entry.rank !== rankedSupplierNifs[0].rank) break;
      topSupplierNifs.set(entry.hit.nif, entry.hit);
    }
  }
  const supplierNifHit =
    topSupplierNifs.size === 1 ? topSupplierNifs.values().next().value : null;
  const supplierNif = supplierNifHit ? supplierNifHit.nif : null;
  const supplierNifOcrOriginal =
    supplierNifHit && nifKey(supplierNifHit.raw) !== supplierNif
      ? supplierNifHit.raw
      : "";
  if (supplierNifOcrOriginal) {
    notes.push(
      `He corregido un carácter del NIF del emisor leído por OCR: «${supplierNifOcrOriginal}» → «${supplierNif}». Compruébalo con el documento.`
    );
  }
  const unreliableSupplierNif = nifs.some(
    (hit) =>
      !hit.valid &&
      (/^\d{8}[A-Z]$/.test(hit.key) ||
        /^[ABCDEFGHJNPQRSUVWXYZ][A-Z0-9]{8}$/.test(hit.key)) &&
      !customerLines.has(hit.line) &&
      (SUPPLIER_WORDS.some((word) => fold(lines[hit.line]).includes(fold(word))) ||
        /\b(?:nif|cif)\b/i.test(lines[hit.line]) ||
        hit.line < Math.min(firstCustomerLine, 12))
  );

  let supplierName = pickSupplierName(lines.map((line, i) => customerLines.has(i) ? "" : line),
    supplierNifHit ? supplierNifHit.line : null);

  if (!supplierName && options.fileName) {
    const guess = String(options.fileName)
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/[_-]+/g, " ")
      .replace(/\b(factura|invoice|scan|img|foto|pdf)\b/gi, "")
      .replace(/\d{2,}/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (guess.length >= 3) supplierName = guess;
  }

  // Una liquidación de fruta la emite el comprador: el nombre que interesa es
  // el del cliente, y en el papel suele ir detrás de «Cliente:» o «Comprador:».
  if (/l[íi]quidaci[oó]n/i.test(flat)) {
    const cliente = pickClientName(lines);
    if (cliente) supplierName = cliente;
  }

  if (!supplierNif) {
    notes.push(
      unreliableSupplierNif
        ? "He leído un posible NIF del proveedor, pero no he podido validarlo; lo he dejado vacío. Revísalo en la factura."
        : "No he visto el NIF del proveedor. Búscalo en la factura y escríbelo."
    );
  }
  if (!supplierName) notes.push("No he reconocido el nombre del proveedor. Escribelo tú.");

  /* --- número --- */
  const number = pickInvoiceNumber(nonEmpty);
  if (!number) notes.push("No he encontrado el número de factura.");

  /* --- fechas --- */
  let issueDate = null;
  let dueDate = null;
  const allDates = [];

  nonEmpty.forEach((line) => {
    const low = fold(line);
    const dates = datesIn(line);
    if (!dates.length) return;
    allDates.push(...dates);
    if (/vencim|vence|fecha de pago|pago hasta|plazo/.test(low) && !dueDate) dueDate = dates[0];
    else if (/fecha|emision|expedicion|factura/.test(low) && !issueDate) issueDate = dates[0];
  });

  if (!issueDate && allDates.length) issueDate = allDates.slice().sort()[0];
  if (!issueDate) {
    issueDate = today;
    notes.push("No he encontrado la fecha de la factura: he puesto la de hoy.");
  }
  if (dueDate && dueDate < issueDate) dueDate = null;

  /* --- importes --- */
  const raw = readAmounts(nonEmpty);
  const recovered = raw.base == null || raw.igic == null || raw.total == null
    ? recoverInvoiceSummary(nonEmpty) : null;
  let usedRecovery = false;
  if (recovered) {
    // No mezclar un resumen recuperado con un importe contradictorio leído antes.
    const conflict = ["base", "igic", "total"].some((key) =>
      raw[key] != null && Math.abs(raw[key] - recovered[key]) > 0.021);
    if (!conflict) {
      Object.assign(raw, recovered);
      usedRecovery = true;
      notes.push("Los importes del resumen estaban separados de sus rótulos. He recuperado una única combinación base + IGIC = total; contrástala con el escaneo.");
    } else {
      notes.push("El resumen del escaneo contradice otros importes leídos. Revisa base, IGIC y total.");
    }
  }
  const complete = completeAmounts({
    base: raw.base,
    rate: raw.rate ?? (raw.igic != null || raw.base != null || raw.total != null ? options.defaultRate ?? null : null),
    igic: raw.igic,
    total: raw.total,
  });

  if (complete.total == null) notes.push("No he encontrado el total. Escribelo tú y el IGIC se calcula solo.");
  if (complete.base == null && complete.total != null) notes.push("No he encontrado la base imponible; la he calculado.");
  if (complete.rate == null) notes.push("No he visto el tipo de IGIC: he puesto el que tengas por defecto.");

  const balanced = complete.base != null && complete.igic != null && complete.total != null
    ? Math.abs(round2(complete.base + complete.igic) - round2(complete.total)) <= 0.05
    : true;
  if (!balanced) {
    notes.push(
      `Los importes no cuadran del todo: base + IGIC no da el total (${(complete.base + complete.igic).toFixed(2)} frente a ${complete.total.toFixed(2)}).`
    );
  }

  /* --- estado --- */
  const st = readStatus(flat);
  if (st.note) notes.push(st.note);

  /* --- confianza --- */
  let score = 0;
  if (supplierName) score += 0.22;
  if (supplierNif) score += 0.22;
  if (number) score += 0.16;
  if (issueDate) score += 0.12;
  if (complete.total != null && !complete.derived.includes("total")) score += 0.2;
  if (raw.rate != null) score += 0.05;
  if (raw.base != null) score += 0.03;
  if (balanced) score += 0.06;

  // El texto se guarda con el documento para poder mirarlo después. Antes se
  // cortaba en 6.000 caracteres y, en un papel largo, lo que quedaba fuera era
  // el final, justo donde van los totales. Ahora el tope es holgado y, si aun
  // así se recorta, se dice en una nota en vez de callarlo.
  const CAPTURA = 30000;
  const cortada = flat.length > CAPTURA;

  const confidence = Math.max(0, Math.min(usedRecovery ? 0.65 : 1, score));

  return {
    supplierName: supplierName || "",
    supplierNif: supplierNif || "",
    supplierNifOcrOriginal,
    number: number || "",
    issueDate,
    dueDate: dueDate || "",
    base: complete.base,
    rate: complete.rate,
    igic: complete.igic,
    total: complete.total,
    derived: complete.derived,
    status: st.status,
    confidence,
    balanced,
    notes: cortada
      ? notes.concat(
          `El texto del papel es muy largo (${flat.length} caracteres) y he guardado los ${CAPTURA} primeros para que la ficha no se haga enorme. Para leerlo entero se vuelve a leer el fichero.`
        )
      : notes,
    rawText: flat.slice(0, CAPTURA),
  };
}

/** ¿Parece una factura? Sirve para avisar cuando se cuela otro documento. */
export function looksLikeInvoice(text) {
  const low = fold(text);
  const hits = [
    /factura/, /total/, /base imponible/, /igic|iva/, /\d{1,3}[.,]\d{2}/, /cif|nif/,
  ].filter((re) => re.test(low)).length;
  return hits >= 3;
}

/* ------------------------------------------------------------------ */
/* Liquidaciones de fruta                                             */
/* ------------------------------------------------------------------ */

/*
 * Una liquidación no es una factura: trae kilos, un precio por kilo, unos
 * descuentos y un líquido a percibir. El lector de facturas se queda con los
 * importes gordos, se come los precios de tres decimales («0,853» → 0,85) y
 * confunde la base con el líquido. Aquí van reglas propias.
 */

/* Un número de una casilla de liquidación. Admite hasta cuatro decimales,
 * porque un precio por kilo se escribe con tres. */
const LIQ_NUM = String.raw`-?\d{1,3}(?:[.\s]\d{3})+(?:,\d{1,4})?|-?\d+(?:[.,]\d{1,4})?`;

const RE_LIQ_KG =
  /(?:kilos?|kgs?\.?|kilogramos?|peso\s*(?:neto|bruto|total)|netos?|cantidad(?:\s*entregada)?|entregad[oa]s?|total\s*(?:de\s*)?kilos)/i;
const RE_LIQ_PRICE =
  /(?:precio\s*(?:de\s*)?(?:\/\s*kgs?|por\s*kgs?|kilo|unidad|unitario|medio|compra)?|p\.?\s?v\.?\s?p\.?|a\s*raz[óo]n\s*de)/i;
const RE_LIQ_EURKG = /(?:€|euros?|eur)\s*(?:\/|por|la)?\s*(?:kgs?|kilos?|kilogramos?)/i;
const RE_LIQ_GROSS =
  /(?:importe\s*bruto|total\s*bruto|bruto|valor\s*(?:de\s*la\s*)?(?:fruta|mercanc[íi]a))/i;
const RE_LIQ_NET =
  /(?:l[íi]quido\s*(?:a\s*percibir|total|neto)?|total\s*l[íi]quido|neto\s*a\s*percibir|a\s*percibir|l[íi]quido|total\s*(?:a\s*)?(?:percibir|cobrar))/i;
const RE_LIQ_DTO =
  /(descuento|deducci|gasto|retenci|manipulaci|envase|comisi|transport|flete|anticipo|merma|c[aá]non|seguro|calibre|cuota|limpieza|confecci|palet|descarga)/i;

const LIQ_FRUITS = [
  ["platano", "Plátano"], ["aguacate", "Aguacate"], ["tomate", "Tomate"],
  ["mango", "Mango"], ["papaya", "Papaya"], ["pepino", "Pepino"],
  ["calabacin", "Calabacín"], ["naranja", "Naranja"], ["mandarina", "Mandarina"],
  ["limon", "Limón"], ["uva", "Uva"], ["melon", "Melón"], ["sandia", "Sandía"],
  ["pina", "Piña"], ["chirimoya", "Chirimoya"], ["granadilla", "Granadilla"],
  ["higo", "Higo"], ["pimiento", "Pimiento"], ["judia", "Judía"],
  ["batata", "Batata"], ["boniato", "Boniato"], ["aguacates", "Aguacate"],
];
const LIQ_CATEGORIES = ["Extra", "Primera", "Segunda", "Tercera", "Destrío"];

/**
 * Kilos. Aquí el punto casi siempre separa miles («4.520» → 4.520), salvo
 * cuando empieza por cero («0,500» → medio kilo).
 */
export function parseKg(raw) {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  let s = String(raw).replace(/[^\d.,-]/g, "");
  if (!s) return null;
  const neg = s.startsWith("-");
  s = s.replace(/-/g, "");
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma > -1) {
    const d = s.length - lastComma - 1;
    const entero = s.slice(0, lastComma);
    s = d === 3 && entero !== "0" ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if (lastDot > -1) {
    const d = s.length - lastDot - 1;
    const entero = s.slice(0, lastDot);
    if (d === 3 && entero !== "0") s = s.replace(/\./g, "");
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

/**
 * Precio por kilo. Aquí es al revés: «0,853» y «0.853» son 0,853 €/kg, y un
 * punto suelto siempre es decimal, porque nadie paga 1.234 euros por kilo.
 */
export function parsePrice(raw) {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  let s = String(raw).replace(/[^\d.,-]/g, "");
  if (!s) return null;
  const neg = s.startsWith("-");
  s = s.replace(/-/g, "");
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma > -1) {
    s = s.replace(",", ".");
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

/** El total de kilos, si el papel lo dice con nombre propio. */
const RE_LIQ_TOTAL_KG = /(?:total\s*(?:de\s*)?kilos|kilos?\s*(?:netos|totales)|total\s*kgs?)/i;

/**
 * El texto quitando las fechas: «15/04/2024» no es un importe y, al buscar el
 * número que va detrás de «kilos», se colaba el día del albarán.
 */
function liqLimpio(text) {
  return String(text == null ? "" : text)
    .replace(/\u00a0/g, " ")
    .replace(/\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/g, " ")
    .replace(/\d{1,2}\/\d{1,2}/g, " ");
}

/** El texto sin fechas y sin porcentajes: solo quedan importes y cantidades. */
function liqSinPct(text) {
  return liqLimpio(text).replace(/\d+(?:[.,]\d+)?\s*%/g, " ");
}

/** Todos los números del texto, cada uno con el trozo de texto que lleva delante. */
function liqTokens(text) {
  const limpio = liqLimpio(text);
  const re = new RegExp(LIQ_NUM, "g");
  const out = [];
  let antes = 0;
  let m = re.exec(limpio);
  while (m) {
    const fin = m.index + m[0].length;
    out.push({
      raw: m[0],
      chunk: limpio.slice(antes, m.index),
      esPct: /^\s*%/.test(limpio.slice(fin, fin + 3)),
    });
    antes = fin;
    m = re.exec(limpio);
  }
  return out;
}

/** ¿Estos dos importes son el mismo, con margen para el redondeo? */
function cuadra(uno, otro) {
  return Math.abs(uno - otro) <= Math.max(1, Math.abs(otro) * 0.02);
}

/*
 * Las palabras que llevan los encabezados de las tablas de estos papeles
 * («Producto  Kilos  Precio  Importe»). Van sin tildes porque se comparan con
 * el texto plegado (fold quita los acentos).
 */
const PALABRAS_ENCABEZADO = new Set([
  "n", "no", "num", "numero", "ref", "referencia", "concepto", "descripcion",
  "producto", "articulo", "variedad", "fruta", "categoria", "calibre", "unidad",
  "uds", "unidades", "cantidad", "kilo", "kilos", "kg", "kgs", "peso", "neto",
  "netos", "bruto", "precio", "pvp", "euro", "euros", "importe", "total", "base",
  "tipo", "cuota", "iva", "igic", "dto", "descuento", "descuentos", "porcentaje",
  "liquido", "fecha", "albaran", "comprador", "cliente", "proveedor", "trabajador",
  "dias", "dia", "salario", "devengos", "deducciones", "retencion", "irpf",
  "seguridad", "social", "ss", "periodo", "pago", "vencimiento", "banco", "ccc",
  "nif", "dni", "cif", "nombre", "apellidos", "empleado", "puesto", "grupo",
  "nivel", "codigo", "horas", "empresa", "centro", "alta", "baja", "cuenta",
  "iban", "percibir", "devengado", "contingencias", "desempleo", "formacion",
  "mei", "complemento", "plus", "pagas", "prorrata", "horas", "extras",
]);

/**
 * ¿Esta línea es el encabezado de una tabla y no un dato? Se reconoce porque no
 * lleva ningún número y todas sus palabras son nombres de columna. Sirve para
 * no leer el número de la fila de abajo como si fuera el de la columna que
 * nombra el encabezado, ni tomar «Trabajador  NIF  Días» por el nombre de una
 * persona.
 */
export function lineaEsEncabezado(linea) {
  const limpia = String(linea == null ? "" : linea).trim();
  if (!limpia) return false;
  if (/[0-9]/.test(limpia)) return false; // un dato, aunque sea un «7 %», lleva números
  const palabras = fold(limpia)
    .replace(/[^a-z%\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (!palabras.length || palabras.length > 8) return false;
  return palabras.every((p) => p === "%" || PALABRAS_ENCABEZADO.has(p));
}

/**
 * El número que va con una etiqueta («Kilos: 1.000,00»; «0,85 €/kg»).
 *
 * Antes se buscaba «el primer número detrás de la palabra» saltando de línea
 * sin mirar: en una tabla con encabezado la palabra está arriba, sin número, y
 * el número que se tomaba era el de la fila de abajo —el de otra columna—. Eso
 * es confundir el encabezado con el dato. Ahora manda el número de la MISMA
 * línea que la etiqueta; solo si la etiqueta está sola en su línea y debajo hay
 * un único número se acepta el de debajo.
 */
function liqDespues(text, labelRe) {
  const limpio = liqSinPct(text);
  const lineas = limpio.split(/\r?\n/);
  const hay = new RegExp(labelRe.source, "i");
  const nums = (l) => l.match(new RegExp(LIQ_NUM, "g")) || [];

  // 1) Etiqueta y número en la misma línea: esto es un dato, no un encabezado.
  for (const linea of lineas) {
    if (!hay.test(linea)) continue;
    const todos = nums(linea);
    if (!todos.length) continue;
    const pos = linea.search(hay);
    const detras = linea.slice(pos).match(new RegExp(LIQ_NUM, "g")) || [];
    return detras.length ? detras[0] : todos[todos.length - 1];
  }

  // 2) Etiqueta sola arriba y el dato justo debajo (papel con las columnas
  //    puestas en vertical). Si la línea nombra varias columnas, el número de
  //    debajo es el de la primera y no el de esta: no se toca.
  for (let i = 0; i < lineas.length; i += 1) {
    const linea = lineas[i];
    if (!hay.test(linea) || !lineaEsEncabezado(linea)) continue;
    const palabras = fold(linea).replace(/[^a-z%\s]/g, " ").split(/\s+/).filter(Boolean);
    if (palabras.length > 2) continue;
    for (let k = i + 1; k < Math.min(lineas.length, i + 3); k += 1) {
      const sig = lineas[k].trim();
      if (!sig) continue;
      const n = nums(sig);
      if (n.length === 1) return n[0];
      break;
    }
  }
  return null;
}

/** El número que va justo delante de una unidad o etiqueta, en su misma línea. */
function liqAntes(text, labelRe) {
  const limpio = liqSinPct(text);
  const hay = new RegExp(labelRe.source, "i");
  const look = new RegExp("(" + LIQ_NUM + ")\\s*(?:" + labelRe.source + ")", "i");
  for (const linea of limpio.split(/\r?\n/)) {
    if (!hay.test(linea)) continue;
    const m = look.exec(linea);
    if (m) return m[1];
  }
  return null;
}

/** El IGIC que trae el papel: si lo nombra, su tipo y su cuota. */
function liqIgic(text) {
  const todo = String(text == null ? "" : text).replace(/\u00a0/g, " ");
  const aparece = /\bigic\b|\biva\b/i.test(todo);
  const out = { aparece, rate: null, cuota: null };
  if (!aparece) return out;
  for (const linea of todo.split(/\r?\n/)) {
    if (!/\bigic\b|\biva\b/i.test(linea)) continue;
    const mR = /(\d{1,2}(?:[.,]\d{1,2})?)\s*%/.exec(linea);
    if (mR) {
      const r = parsePrice(mR[1]);
      if (r != null && r >= 0 && r <= 30) out.rate = r;
    }
    const resto = linea.replace(/\d{1,2}(?:[.,]\d{1,2})?\s*%/g, " ");
    const nums = resto.match(new RegExp(LIQ_NUM, "g")) || [];
    if (nums.length) {
      const c = Math.abs(parseAmount(nums[nums.length - 1]) || 0);
      if (c) out.cuota = round2(c);
    }
    if (out.rate != null || out.cuota != null) break;
  }
  return out;
}

/** Un nombre para la persona («plátano» → «Plátano»). */
function properCase(word) {
  const w = String(word || "").trim();
  if (!w) return "";
  return w.charAt(0).toUpperCase() + w.slice(1);
}

function liquidacionProduct(text) {
  const labelled = new RegExp(
    `(?:producto|art[íi]culo|mercanc[íi]a|variedad|fruta)\\s*[:\\-]?\\s*([A-Za-zÁÉÍÓÚÜÑáéíóúüñ ]{3,32})`,
    "i"
  ).exec(text);
  if (labelled) {
    const name = labelled[1].replace(/\s+/g, " ").trim();
    const key = fold(name);
    const hit = LIQ_FRUITS.find(([k]) => key.includes(k));
    if (hit) return hit[1];
  }
  const low = fold(text);
  for (const [key, name] of LIQ_FRUITS) {
    if (new RegExp(String.raw`\b` + key + String.raw`s?\b`).test(low)) return name;
  }
  return "";
}

function liquidacionCategory(text) {
  const low = fold(text);
  for (const c of LIQ_CATEGORIES) {
    if (new RegExp(String.raw`\b` + fold(c) + String.raw`\b`).test(low)) return c;
  }
  return "";
}

/**
 * Las filas de la tabla de una liquidación: cada fila es una partida con sus
 * kilos, su precio por kilo y su importe. Vale cualquier fila cuyo importe
 * cuadre con kilos × precio, y también la que lleva un % de descuento en medio.
 * Antes solo se aceptaba la línea con exactamente tres números, así que en un
 * papel de verdad (con fecha, albarán y número de línea alrededor) no cuadraba
 * nunca y se perdían las partidas.
 */
/**
 * Los nombres de categoría que llevan las liquidaciones de fruta. Se buscan
 * sobre el texto sin tildes (fold quita los acentos), así que van sin ellas.
 */
const CATEGORIA_RE = [
  [/\bextra\b/, "Extra"],
  [/\bprimera\b|\b1[ªa]\b|\bcat\.?\s*(?:i|1)\b/, "Primera"],
  [/\bsegunda\b|\b2[ªa]\b|\bcat\.?\s*(?:ii|2)\b/, "Segunda"],
  [/\btercera\b|\b3[ªa]\b|\bcat\.?\s*(?:iii|3)\b/, "Tercera"],
  [/\bcuarta\b|\b4[ªa]\b/, "Cuarta"],
  [/\bquinta\b|\b5[ªa]\b/, "Quinta"],
  [/\bdestrio\b|\bdestrios\b/, "Destrío"],
  [/\bindustria/, "Industria"],
  [/\bgruesa\b/, "Gruesa"],
  [/\bmediana\b/, "Mediana"],
  [/\bpequena\b|\bpequenas\b/, "Pequeña"],
  [/\bcomercial\b/, "Comercial"],
];

/** La categoría que nombra un trozo de texto (vacío si no nombra ninguna). */
function categoriaDeTexto(txt) {
  const t = fold(String(txt == null ? "" : txt));
  for (const [re, nombre] of CATEGORIA_RE) {
    if (re.test(t)) return nombre;
  }
  return "";
}

/**
 * Los kilos de cada categoría cuando la tabla no trae el importe de cada fila.
 * Muchas liquidaciones solo ponen los kilos por categoría y el precio arriba,
 * así que aquí se aceptan filas con kilos (y precio) aunque no traigan importe.
 * Se miran los números de la propia línea de la categoría y, si van debajo, los
 * de las dos líneas siguientes.
 */
function liquidacionPorCategoria(text) {
  const filas = [];
  const lineas = String(text || "").split(/\r?\n/);
  const reNum = new RegExp(LIQ_NUM, "g");
  for (let i = 0; i < lineas.length; i += 1) {
    const cat = categoriaDeTexto(lineas[i]);
    if (!cat) continue;
    let nums = liqSinPct(lineas[i]).match(reNum) || [];
    if (!nums.length && i + 1 < lineas.length) {
      nums = liqSinPct(lineas[i + 1]).match(reNum) || [];
    }
    if (!nums.length) continue;
    const kg = parseKg(nums[0]);
    if (!(kg > 0)) continue;
    let price = null;
    let gross = null;
    if (nums.length >= 2) {
      const p = parsePrice(nums[1]);
      if (p != null && p > 0 && p <= 50) price = p;
    }
    if (price != null && nums.length >= 3) {
      const g = parseAmount(nums[2]);
      if (g > 0 && cuadra(kg * price, g)) gross = g;
    }
    if (price == null && nums.length >= 2) {
      const g = parseAmount(nums[1]);
      if (g > 0 && g > kg) gross = g;
    }
    filas.push({ categoria: cat, kg, price, gross });
  }
  return filas;
}

function liquidacionFromTable(text) {
  const toks = liqTokens(text);
  const filas = [];
  const usados = new Set();
  const noEsFila =
    /(descuento|deducci|comisi|gasto|retenci|anticipo|manipul|envase|transport|flete|merma|c[aá]non|seguro|cuota|igic|iva|l[íi]quido|total)/i;
  for (let i = 0; i < toks.length - 1; i += 1) {
    if (usados.has(i)) continue;
    const a = toks[i];
    const b = toks[i + 1];
    if (a.esPct || b.esPct) continue;
    if (noEsFila.test(fold(a.chunk))) continue;
    const kg = parseKg(a.raw);
    const price = parsePrice(b.raw);
    if (!(kg > 0) || !(price > 0) || price > 50) continue;
    const c = toks[i + 2];
    const d = toks[i + 3];
    let gross = null;
    let salto = 3;
    if (c && !c.esPct) {
      const g = parseAmount(c.raw);
      if (g > 0 && cuadra(kg * price, g)) {
        gross = g;
        salto = 3;
      }
    }
    if (gross == null && c && c.esPct && d && !d.esPct) {
      const pct = parsePrice(c.raw);
      const g = parseAmount(d.raw);
      if (g > 0 && pct != null && pct >= 0 && pct < 100 && cuadra(kg * price * (1 - pct / 100), g)) {
        gross = g;
        salto = 4;
      }
    }
    if (gross == null) continue;
    filas.push({ kg, price, gross, label: a.chunk });
    for (let k = i; k < i + salto; k += 1) usados.add(k);
    i += salto - 1;
  }
  return filas;
}

/**
 * Los descuentos, uno por línea, con su nombre y su importe en euros.
 * Una línea como «Manipulación 3 % 319,36» es un descuento de 319,36 €: el
 * porcentaje solo dice cómo se ha calculado y antes se tiraba la línea entera
 * por llevarlo, así que faltaban descuentos. Un renglón que solo dice
 * «Comisión 3 %», sin importe, no es un descuento.
 */
function liquidacionDiscounts(text) {
  const rows = [];
  for (const cruda of String(text || "").split(/\r?\n| · |\s{4,}/)) {
    const line = liqSinPct(cruda).trim();
    if (!line || line.length > 120 || !RE_LIQ_DTO.test(line)) continue;
    if (RE_LIQ_GROSS.test(line) || RE_LIQ_NET.test(line)) continue;
    if (/\bigic\b|\biva\b/i.test(line)) continue;
    const nums = line.match(new RegExp(LIQ_NUM, "g")) || [];
    if (!nums.length) continue;
    // Una línea que ya es una partida (kilos × precio = importe) no es un
    // descuento, aunque diga «calibre» o «descarga».
    if (nums.length >= 3) {
      const k0 = parseKg(nums[0]);
      const p0 = parsePrice(nums[1]);
      const ultimo = Math.abs(parseAmount(nums[nums.length - 1]) || 0);
      if (k0 > 0 && p0 > 0 && p0 <= 50 && ultimo > 0 && cuadra(k0 * p0, ultimo)) continue;
    }
    const amount = Math.abs(parseAmount(nums[nums.length - 1]) || 0);
    if (!amount) continue;
    let label = line
      .replace(/[-\d.,:;€%]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 48);
    if (!label) label = "Descuento";
    if (label.split(" ").length > 6) continue;
    rows.push({
      label: properCase(label),
      amount: round2(amount),
      bare:
        /^(descuentos?|deducciones?|gastos?)$/i.test(label) || /\btotal\b|\bsuma\b|\bimporte\b/i.test(label),
    });
    if (rows.length >= 12) break;
  }
  // Si además aparecen las líneas de detalle, el renglón «Descuentos 322,44»
  // es el total: sobra.
  const detalle = rows.filter((r) => !r.bare);
  const usar = detalle.length ? detalle : rows;
  return usar.map(({ label, amount }) => ({ label, amount }));
}

/**
 * Lee una liquidación de fruta del texto ya extraído (de un PDF o del OCR).
 * No decide nada: devuelve lo que ha entendido y avisa cuando los números del
 * papel no cuadran, para que la persona lo mire antes de guardar.
 *
 * Devuelve también las partidas que ha leído y el IGIC tal y como viene en el
 * papel, para no inventarse un tipo que el documento no dice.
 */
export function parseLiquidacion(rawText) {
  const original = String(rawText == null ? "" : rawText).replace(/\u00a0/g, " ");
  const out = {
    product: "",
    category: "",
    partidas: [],
    kg: null,
    price: null,
    gross: null,
    discounts: [],
    net: null,
    rate: null,
    igic: null,
    ok: false,
    notes: [],
  };
  if (!original.trim()) return out;

  out.product = liquidacionProduct(original);
  out.category = liquidacionCategory(original);
  const resumen = leerResumenLiquidacion(original);
  if (resumen) {
    return { ...out, ...resumen, product: out.product, discounts: liquidacionDiscounts(original) };
  }

  // 1) Las filas de la tabla: los kilos y el precio cuyo importe cuadra.
  const partidas = liquidacionFromTable(original);
  if (partidas.length) {
    const kgSum = round2(partidas.reduce((a, p) => a + p.kg, 0));
    const grossSum = round2(partidas.reduce((a, p) => a + p.gross, 0));
    out.partidas = partidas.map((p) => ({
      categoria: categoriaDeTexto(p.label),
      kg: round2(p.kg),
      price: p.price,
      gross: round2(p.gross),
    }));
    if (kgSum > 0) out.kg = kgSum;
    if (grossSum > 0) out.gross = grossSum;
    if (kgSum > 0 && grossSum > 0) out.price = Math.round((grossSum / kgSum) * 1000) / 1000;
    if (partidas.length > 1 && out.price != null) {
      out.notes.push(
        `He leído ${partidas.length} partidas y las he sumado: ${fmtNum(kgSum, 2)} kg y ${fmtEUR(grossSum)} de bruto (precio medio ${fmtNum(out.price, 3)} €/kg).`
      );
    }
  }

  // 1 bis) Si la tabla no dice la categoría de cada fila (o no hay filas con
  // importe), se leen los kilos categoría por categoría: así una liquidación
  // que solo trae «EXTRA 1.234 kg / PRIMERA 800 kg» no se queda en un bulto.
  if (!out.partidas || !out.partidas.some((p) => p.categoria)) {
    const porCat = liquidacionPorCategoria(original);
    if (porCat.length) {
      out.partidas = porCat.map((p) => ({
        categoria: p.categoria,
        kg: round2(p.kg),
        price: p.price,
        gross: p.gross != null ? round2(p.gross) : null,
      }));
      const kgCat = round2(porCat.reduce((a, p) => a + p.kg, 0));
      const brutoCat = round2(porCat.reduce((a, p) => a + (p.gross || 0), 0));
      if (kgCat > 0) out.kg = kgCat;
      if (brutoCat > 0) out.gross = brutoCat;
      if (kgCat > 0 && brutoCat > 0) out.price = Math.round((brutoCat / kgCat) * 1000) / 1000;
      out.notes.push(
        `He leído los kilos por categorías (${porCat.map((p) => p.categoria).join(", ")}). Míralos antes de guardar.`
      );
    }
  }

  // 2) Lo que el papel dice con nombre propio completa lo que falte.
  const kgPapel = parseKg(liqDespues(original, RE_LIQ_TOTAL_KG) || liqDespues(original, RE_LIQ_KG));
  if (kgPapel != null && kgPapel > 0) {
    if (out.kg == null) out.kg = kgPapel;
    else if (!cuadra(kgPapel, out.kg)) {
      out.notes.push(
        `El papel dice ${fmtNum(kgPapel, 2)} kg y las partidas suman ${fmtNum(out.kg, 2)} kg. Me quedo con las partidas: míralo.`
      );
    }
  }

  const pricePapel = parsePrice(liqAntes(original, RE_LIQ_EURKG) || liqDespues(original, RE_LIQ_PRICE));
  if (pricePapel != null && pricePapel > 0 && pricePapel <= 50) {
    if (out.price == null) out.price = pricePapel;
  } else if (pricePapel != null && pricePapel > 50) {
    out.notes.push(
      `El precio que he leído (${fmtNum(pricePapel, 2)} €/kg) no puede ser el de un kilo de fruta: míralo.`
    );
  }

  const grossPapel = parseAmount(liqDespues(original, RE_LIQ_GROSS));
  if (grossPapel != null && grossPapel > 0) {
    if (out.gross == null) out.gross = grossPapel;
    else if (!cuadra(grossPapel, out.gross)) {
      out.notes.push(
        `El bruto del papel (${fmtEUR(grossPapel)}) no coincide con la suma de las partidas (${fmtEUR(out.gross)}). Me quedo con las partidas: míralo.`
      );
    }
  }
  if (out.gross == null && out.kg != null && out.price != null) out.gross = round2(out.kg * out.price);
  if (out.price == null && out.kg && out.gross) {
    out.price = Math.round((out.gross / out.kg) * 1000) / 1000;
    out.notes.push(`El papel no dice el precio por kilo; lo he sacado yo: ${fmtNum(out.price, 3)} €/kg.`);
  }

  // 3) Descuentos e IGIC: tal y como vienen escritos en el papel.
  out.discounts = liquidacionDiscounts(original);
  const dto = round2(out.discounts.reduce((a, d) => a + d.amount, 0));

  const netPapel = parseAmount(liqDespues(original, RE_LIQ_NET));
  out.net = netPapel != null ? netPapel : out.gross != null ? round2(out.gross - dto) : null;

  const ig = liqIgic(original);
  if (!ig.aparece) {
    out.rate = 0;
    if (out.net != null) {
      out.notes.push(
        "En el papel no aparece IGIC: entra al 0 %, así que el total que se guarda es el líquido a percibir."
      );
    }
  } else if (ig.rate != null) {
    out.rate = ig.rate;
  } else if (ig.cuota != null && out.net) {
    out.rate = Math.round(((ig.cuota * 100) / out.net) * 100) / 100;
  } else {
    out.rate = 0;
    out.notes.push("Aparece el IGIC pero no he sabido leer su tipo: entra al 0 %. Cámbialo en la ficha si hace falta.");
  }
  if (ig.cuota != null) out.igic = ig.cuota;
  else if (out.net != null && out.rate != null) out.igic = round2((out.net * out.rate) / 100);

  // 4) Avisos cuando los números del papel no cuadran entre ellos.
  if (netPapel != null && out.gross != null && dto) {
    const calc = round2(out.gross - dto);
    if (!cuadra(calc, netPapel)) {
      out.notes.push(
        `No cuadra: el bruto menos los descuentos que he leído son ${fmtEUR(calc)}, y el líquido del papel dice ${fmtEUR(netPapel)}. Puede que falte algún descuento: revísalo.`
      );
    }
  }

  out.ok = out.kg != null && out.price != null;
  if (!out.ok) {
    out.notes.push(
      "No he sabido leer los kilos o el precio por kilo de esta liquidación. Escríbelos a mano antes de guardar."
    );
  }
  return out;
}
