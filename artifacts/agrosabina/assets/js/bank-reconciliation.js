import { invoiceDirection } from "./model.js";
import { financialHasCash } from "./financial-documents.js";

const cleanHeader = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function parseDate(value) {
  const text = String(value || "").trim();
  const validDate = (year, month, day) => {
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  };
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const iso = text.slice(0, 10);
    const [year, month, day] = iso.split("-").map(Number);
    return validDate(year, month, day) ? iso : "";
  }
  if (/^\d{8}/.test(text)) {
    const year = Number(text.slice(0, 4));
    const month = Number(text.slice(4, 6));
    const day = Number(text.slice(6, 8));
    return validDate(year, month, day) ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}` : "";
  }
  const parts = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (!parts) return "";
  let [, first, second, year] = parts;
  let day = Number(first);
  let month = Number(second);
  if (day <= 12 && month > 12) [day, month] = [month, day];
  let y = Number(year);
  if (y < 100) y += y < 70 ? 2000 : 1900;
  if (!validDate(y, month, day)) return "";
  return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseMoney(value) {
  let text = String(value == null ? "" : value).trim();
  if (!text) return null;
  const parens = /^\(.*\)$/.test(text);
  text = text.replace(/[€$£\s\u00a0]/g, "").replace(/[()]/g, "").replace(/[−–]/g, "-");
  const comma = text.lastIndexOf(",");
  const dot = text.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    text = comma > dot ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
  } else if (comma >= 0) {
    text = text.length - comma - 1 <= 2 ? text.replace(",", ".") : text.replace(/,/g, "");
  } else if (dot >= 0 && text.length - dot - 1 > 2) {
    text = text.replace(/\./g, "");
  }
  const amount = Number(text);
  if (!Number.isFinite(amount)) return null;
  return Math.round((parens ? -amount : amount) * 100) / 100;
}

function splitDelimited(text, delimiter) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"' && quoted && text[i + 1] === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell.trim());
      if (row.some((part) => part !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell.trim());
  if (row.some((part) => part !== "")) rows.push(row);
  return rows;
}

function chooseDelimiter(header) {
  const candidates = [";", ",", "\t"];
  let best = ";";
  let max = -1;
  for (const delimiter of candidates) {
    let quoted = false;
    let count = 0;
    for (let i = 0; i < header.length; i += 1) {
      if (header[i] === '"') quoted = !quoted;
      else if (header[i] === delimiter && !quoted) count += 1;
    }
    if (count > max) {
      max = count;
      best = delimiter;
    }
  }
  return best;
}

function parseCsv(text) {
  const clean = String(text || "").replace(/^\uFEFF/, "");
  const firstLine = clean.split(/\r?\n/).find((line) => line.trim()) || "";
  const rows = splitDelimited(clean, chooseDelimiter(firstLine));
  if (rows.length < 2) throw new Error("El extracto no tiene filas de movimientos.");
  const headers = rows[0].map(cleanHeader);
  const find = (patterns) => headers.findIndex((h) => patterns.some((pattern) => pattern.test(h)));
  const dateCol = find([/^fecha( .*)?$/, /^date$/, /transaction date/, /posting date/]);
  const descCol = find([/^concepto( .*)?$/, /^descripcion( .*)?$/, /^detalle$/, /^movimiento$/, /^beneficiario$/, /^payee$/, /^name$/]);
  const amountCol = find([/^importe( .*)?$/, /^amount( .*)?$/, /^monto( .*)?$/, /^cantidad$/]);
  const debitCol = find([/^debe$/, /^cargo$/, /^debit$/, /^withdrawal$/, /^salida$/]);
  const creditCol = find([/^haber$/, /^abono$/, /^credit$/, /^deposit$/, /^entrada$/]);
  const refCol = find([/^referencia$/, /^documento$/, /^referencia bancaria$/, /^fitid$/, /^ref$/]);
  if (dateCol < 0 || (amountCol < 0 && debitCol < 0 && creditCol < 0)) {
    throw new Error("No detecté las columnas de fecha e importe. Usa un CSV con encabezados de Fecha e Importe, Debe o Haber.");
  }
  if (descCol < 0) throw new Error("No detecté la columna Concepto o Descripción del extracto.");

  const movements = [];
  let skippedRows = 0;
  for (const row of rows.slice(1)) {
    if (!row.some((cell) => String(cell || "").trim())) continue;
    const date = parseDate(row[dateCol]);
    const description = String(row[descCol] || "").trim().slice(0, 300);
    let amount = amountCol >= 0 ? parseMoney(row[amountCol]) : null;
    if (debitCol >= 0 || creditCol >= 0) {
      const debit = debitCol >= 0 ? parseMoney(row[debitCol]) : null;
      const credit = creditCol >= 0 ? parseMoney(row[creditCol]) : null;
      if (debit != null && debit !== 0) amount = -Math.abs(debit);
      else if (credit != null && credit !== 0) amount = Math.abs(credit);
      else if (amount == null) amount = 0;
    }
    if (!date || amount == null || amount === 0 || !description) {
      skippedRows += 1;
      continue;
    }
    movements.push({
      date,
      amount,
      description,
      reference: refCol >= 0 ? String(row[refCol] || "").trim().slice(0, 120) : "",
      rail: classifyRail(description),
    });
  }
  if (!movements.length) throw new Error("No encontré movimientos con fecha, concepto e importe válidos en el CSV.");
  movements.skippedRows = skippedRows;
  return movements;
}

function ofxValue(block, tag) {
  const match = block.match(new RegExp(`<${tag}>\\s*([^<\\r\\n]+)`, "i"));
  return match ? match[1].trim() : "";
}

function parseOfx(text) {
  const chunks = String(text || "").split(/<STMTTRN>/i).slice(1);
  const movements = [];
  for (const block of chunks) {
    const date = parseDate(ofxValue(block, "DTPOSTED"));
    const amount = parseMoney(ofxValue(block, "TRNAMT"));
    const name = ofxValue(block, "NAME");
    const memo = ofxValue(block, "MEMO");
    const description = [name, memo].filter(Boolean).join(" · ").slice(0, 300);
    if (!date || amount == null || !amount || !description) continue;
    movements.push({
      date,
      amount,
      description,
      reference: ofxValue(block, "FITID").slice(0, 120),
      rail: classifyRail(description),
    });
  }
  if (!movements.length) throw new Error("No encontré movimientos válidos en el archivo OFX.");
  return movements;
}

function parseQif(text) {
  const movements = [];
  for (const record of String(text || "").split("^")) {
    const values = {};
    for (const line of record.split(/\r?\n/)) {
      if (line.length < 2) continue;
      const key = line[0].toUpperCase();
      values[key] = (values[key] || []).concat(line.slice(1).trim());
    }
    const date = parseDate((values.D || [])[0]);
    const amount = parseMoney((values.T || values.U || [])[0]);
    const description = [((values.P || [])[0] || ""), ((values.M || [])[0] || "")]
      .filter(Boolean)
      .join(" · ")
      .slice(0, 300);
    if (!date || amount == null || !amount || !description) continue;
    movements.push({
      date,
      amount,
      description,
      reference: ((values.N || [])[0] || "").slice(0, 120),
      rail: classifyRail(description),
    });
  }
  if (!movements.length) throw new Error("No encontré movimientos válidos en el archivo QIF.");
  return movements;
}

export function classifyRail(description) {
  const text = String(description || "");
  if (/tarjeta|visa|master ?card|maestro|tpv|pos purchase|card purchase|pago con tarjeta/i.test(text)) return "TARJETA";
  if (/transferencia|transfer|sepa|bizum|wire transfer/i.test(text)) return "TRANSFERENCIA";
  return "OTRO";
}

export function statementFingerprint(movement) {
  const base = [
    cleanHeader(movement.account),
    movement.date,
    Number(movement.amount).toFixed(2),
    cleanHeader(movement.description),
    cleanHeader(movement.reference),
  ].join("|");
  let hash = 2166136261;
  for (let i = 0; i < base.length; i += 1) {
    hash ^= base.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export function parseBankStatement(text, fileName = "") {
  const ext = String(fileName).split(".").pop().toLowerCase();
  let movements;
  if (ext === "ofx") movements = parseOfx(text);
  else if (ext === "qif") movements = parseQif(text);
  else if (["csv", "txt"].includes(ext)) movements = parseCsv(text);
  else throw new Error("Formato no compatible. Sube un extracto CSV, OFX o QIF.");
  const skippedRows = movements.skippedRows || 0;
  const parsed = movements.map((movement) => ({
    ...movement,
    fingerprint: statementFingerprint(movement),
  }));
  parsed.skippedRows = skippedRows;
  return parsed;
}

function normalText(value) {
  return cleanHeader(value).replace(/\s+/g, " ").trim();
}

function daysBetween(a, b) {
  const da = Date.parse(`${a}T12:00:00Z`);
  const db = Date.parse(`${b}T12:00:00Z`);
  return Number.isFinite(da) && Number.isFinite(db) ? Math.round(Math.abs(da - db) / 86400000) : null;
}

export function suggestBankMatches(movements, invoices, suppliers = []) {
  const supplierNames = new Map((suppliers || []).map((supplier) => [supplier.id, supplier.name || ""]));
  const candidates = [];
  for (const movement of movements || []) {
    if (movement.status === "CONCILIADO" || movement.status === "CONTABILIZADO") {
      candidates.push({ movement, suggestion: null });
      continue;
    }
    const movementText = normalText(`${movement.description || ""} ${movement.reference || ""}`);
    const expectedDirection = Number(movement.amount) > 0 ? "INGRESO" : "GASTO";
    const ranked = (invoices || [])
      .filter((invoice) => invoice.status !== "PAGADO" && invoice.total != null && financialHasCash(invoice))
      .map((invoice) => {
        const total = Math.abs(Number(invoice.total) || 0);
        if (!total || Math.round(total * 100) !== Math.round(Math.abs(Number(movement.amount)) * 100)) return null;
        if (invoiceDirection(invoice) !== expectedDirection) return null;
        const party = normalText(supplierNames.get(invoice.supplierId) || "");
        const number = normalText(invoice.number || "");
        const hasParty = party.length >= 4 && movementText.includes(party);
        const hasReference = number.length >= 3 && movementText.includes(number);
        const baseDate = invoice.dueDate || invoice.issueDate || "";
        const dateDistance = daysBetween(movement.date, baseDate);
        if (dateDistance != null && dateDistance > 180) return null;
        const score =
          45 +
          20 +
          (hasReference ? 35 : 0) +
          (hasParty ? 20 : 0) +
          (dateDistance == null ? 0 : dateDistance <= 5 ? 15 : dateDistance <= 30 ? 10 : 4);
        return { invoice, score, hasParty, hasReference, dateDistance };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);
    const best = ranked[0];
    if (!best) {
      candidates.push({ movement, suggestion: null });
      continue;
    }
    const runnerUp = ranked[1];
    const unambiguous = !runnerUp || best.score - runnerUp.score >= 15;
    const highConfidence = unambiguous && best.score >= 90 && (best.hasParty || best.hasReference);
    candidates.push({
      movement,
      suggestion: {
        invoiceId: best.invoice.id,
        label: `${best.invoice.number || "Documento"} · ${supplierNames.get(best.invoice.supplierId) || "Tercero"} · ${Number(best.invoice.total).toFixed(2)} €`,
        score: best.score,
        confidence: highConfidence ? "ALTA" : unambiguous ? "REVISAR" : "AMBIGUA",
        highConfidence,
        alternatives: ranked.slice(0, 6).map(({ invoice, score }) => ({
          invoiceId: invoice.id,
          label: `${invoice.number || "Documento"} · ${supplierNames.get(invoice.supplierId) || "Tercero"} · ${Number(invoice.total).toFixed(2)} €`,
          score,
        })),
      },
    });
  }
  return candidates;
}
