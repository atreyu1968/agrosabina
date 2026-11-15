/*
 * Los datos: proveedores, facturas y ajustes.
 * Se guardan en una base de datos SQLite que vive dentro del navegador (ver
 * sqlite.js). Si SQLite no puede cargarse, se guarda como antes, en
 * localStorage, y Ajustes lo avisa.
 */

import {
  STATUS,
  completeAmounts,
  fold,
  nifKey,
  round2,
  todayISO,
  uid,
} from "./util.js";
import * as sqlite from "./sqlite.js";
import * as files from "./files.js";
import { validateBackup } from "./backup.js";

const KEY = "facturas.igic.v1";
const listeners = new Set();

let state = emptyState();
let lastSaveOk = true;
let engine = "local"; // "sqlite" | "local"
let persistTimer = null;

/* ------------------------------------------------------------------ */
/* Carga y guardado                                                   */
/* ------------------------------------------------------------------ */

function emptyState() {
  return {
    version: 1,
    settings: {
      defaultRate: 7,
      businessName: "Agrosabina SL",
      // Cuentas que se ofrecen al marcar un cobro o un pago.
      bankAccounts: [],
      cashAccount: "Caja general",
      aiEnabled: false,
      // Con la IA encendida, por defecto lee el documento tal cual (la foto o
      // las hojas del PDF). Se puede desmarcar en Ajustes para mandar solo el
      // texto ya leído.
      aiReadDocument: true,
      aiEndpoint: "https://api.openai.com/v1",
      aiModel: "gpt-4o-mini",
      aiKey: "",
      createdAt: new Date().toISOString(),
    },
    suppliers: [],
    invoices: [],
    messages: [],
  };
}

function normaliseMessage(m) {
  if (!m || typeof m !== "object") return null;
  const subject = String(m.subject || "").trim();
  const text = String(m.text || "").slice(0, 20000);
  if (!subject && !text) return null;
  return {
    id: m.id || uid("msg"),
    from: String(m.from || "").trim(),
    subject: subject || "(sin asunto)",
    date: String(m.date || "").trim(),
    text,
    attachments: Array.isArray(m.attachments)
      ? m.attachments.slice(0, 30).map((a) => {
          if (typeof a === "string") return { name: a, type: "", readable: false, size: 0 };
          const bytes = a && a.bytes;
          return {
            name: String((a && a.name) || "adjunto"),
            type: String((a && a.type) || ""),
            readable: !!(a && a.readable),
            size: Number((a && a.size) || 0) || (bytes && bytes.length ? bytes.length : 0),
          };
        })
      : [],
    importedAt: m.importedAt || new Date().toISOString(),
    usedAt: m.usedAt || "",
  };
}

/**
 * Una liquidación de fruta: kilos, precio por kilo, descuentos y líquido a
 * percibir. El bruto y el líquido se calculan, no se guardan.
 */
function normaliseLiquidacion(liq) {
  if (!liq || typeof liq !== "object") return null;
  const n = (v) => (v !== null && v !== "" && Number.isFinite(+v) ? +v : null);
  const kg = n(liq.kg);
  const price = n(liq.price);
  const product = String(liq.product || "").trim().slice(0, 120);
  const category = String(liq.category || "").trim().slice(0, 40);
  const discounts = Array.isArray(liq.discounts)
    ? liq.discounts
        .map((d) => {
          if (!d || typeof d !== "object") return null;
          const label = String(d.label || "").trim().slice(0, 120);
          const amount = n(d.amount);
          if (!label && amount == null) return null;
          return { label, amount: amount == null ? 0 : amount };
        })
        .filter(Boolean)
        .slice(0, 40)
    : [];
  const partidas = Array.isArray(liq.partidas)
    ? liq.partidas
        .map((p) => {
          if (!p || typeof p !== "object") return null;
          const categoria = String(p.categoria || "").trim().slice(0, 40);
          const pKg = n(p.kg);
          const pPrice = n(p.price);
          const pGross = n(p.gross);
          if (!categoria && pKg == null && pPrice == null && pGross == null) return null;
          return { categoria, kg: pKg, price: pPrice, gross: pGross };
        })
        .filter(Boolean)
        .slice(0, 40)
    : [];
  if (!product && !category && kg == null && price == null && !discounts.length && !partidas.length) return null;
  return { product, category, kg, price, discounts, partidas };
}

/**
 * Los datos del fichero original que se guardó de un documento.
 * Los bytes no están aquí: viven en IndexedDB (files.js). Aquí solo queda lo
 * que hace falta para enseñarlo y ofrecerlo: nombre, tipo y tamaño.
 */
function normaliseOriginal(orig) {
  if (!orig || typeof orig !== "object") return null;
  const name = String(orig.name || "").trim().slice(0, 200);
  const size = Number(orig.size);
  if (!name && !(Number.isFinite(size) && size > 0)) return null;
  return {
    name: name || "documento",
    type: String(orig.type || "").slice(0, 120),
    size: Number.isFinite(size) && size > 0 ? size : 0,
    savedAt: String(orig.savedAt || "").slice(0, 30),
  };
}

/**
 * Los datos de una nómina que se guardan con el documento (en una columna
 * JSON, igual que la liquidación de fruta). Se guardan números, no textos.
 */
function normaliseNomina(nom) {
  if (!nom || typeof nom !== "object") return null;
  const num = (v) => (v == null || v === "" || !Number.isFinite(+v) ? null : +v);
  const txt = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, 160);
  const out = {
    trabajador: txt(nom.trabajador),
    nif: txt(nom.nif),
    puesto: txt(nom.puesto),
    periodo: txt(nom.periodo),
    dias: num(nom.dias),
    bruto: num(nom.bruto),
    ssTrabajador: num(nom.ssTrabajador),
    irpf: num(nom.irpf),
    ssEmpresa: num(nom.ssEmpresa),
    neto: num(nom.neto),
  };
  const algo = Object.keys(out).some((k) => out[k] !== null && out[k] !== "");
  return algo ? out : null;
}

function normaliseInvoice(inv) {
  const base = Number.isFinite(+inv.base) && inv.base !== null && inv.base !== "" ? +inv.base : null;
  const igic = Number.isFinite(+inv.igic) && inv.igic !== null && inv.igic !== "" ? +inv.igic : null;
  const total = Number.isFinite(+inv.total) && inv.total !== null && inv.total !== "" ? +inv.total : null;
  const rate = Number.isFinite(+inv.rate) && inv.rate !== null && inv.rate !== "" ? +inv.rate : null;
  const complete = completeAmounts({ base, igic, total, rate });
  return {
    id: inv.id || uid("inv"),
    supplierId: inv.supplierId || null,
    number: String(inv.number || "").trim(),
    issueDate: inv.issueDate || "",
    dueDate: inv.dueDate || "",
    base: complete.base,
    rate: complete.rate,
    igic: complete.igic,
    total: complete.total,
    status: inv.status === STATUS.PAID ? STATUS.PAID : STATUS.PENDING,
    paidDate: String(inv.paidDate || "").slice(0, 10),
    // Cómo se cobró o se pagó: en efectivo (caja) o por banco, y en qué cuenta.
    payMethod: normaliseMedio(inv.payMethod),
    payAccount: String(inv.payAccount || "").trim().slice(0, 120),
    kind: String(inv.kind || "FACTURA"),
    category: String(inv.category || ""),
    direction:
      inv.direction === "INGRESO"
        ? "INGRESO"
        : inv.direction === "GASTO"
          ? "GASTO"
          : ["LIQUIDACION", "SUBVENCION", "COBRO"].includes(String(inv.kind || ""))
            ? "INGRESO"
            : "GASTO",
    // Un documento puede llevar varios tipos de IGIC: cada línea guarda su base y su tipo.
    lines: Array.isArray(inv.lines)
      ? inv.lines
          .map((l) => {
            const lb = Number.isFinite(+l.base) && l.base !== null && l.base !== "" ? +l.base : null;
            const lr = Number.isFinite(+l.rate) && l.rate !== null && l.rate !== "" ? +l.rate : null;
            return lb == null || lr == null ? null : { base: lb, rate: lr };
          })
          .filter(Boolean)
      : [],
    // Cada tipo guarda solo lo suyo: kilos y €/kg son de la liquidación de
    // fruta y el bruto/IRPF del recibo de salarios. Así una nómina no puede
    // arrastrar kilos que no existen, ni al revés.
    liquidacion:
      String(inv.kind || "").toUpperCase() === "NOMINA" ? null : normaliseLiquidacion(inv.liquidacion),
    // Nómina: bruto, Seguridad Social, IRPF y líquido del recibo de salarios.
    nomina:
      String(inv.kind || "").toUpperCase() === "LIQUIDACION" ? null : normaliseNomina(inv.nomina),
    source: inv.source || "manual",
    fileName: inv.fileName || "",
    // El fichero original (foto, PDF, correo) que se guardó con el documento.
    original: normaliseOriginal(inv.original),
    rawText: String(inv.rawText || "").slice(0, 8000),
    notes: Array.isArray(inv.notes) ? inv.notes : [],
    confidence: Number.isFinite(inv.confidence) ? inv.confidence : null,
    createdAt: inv.createdAt || new Date().toISOString(),
    updatedAt: inv.updatedAt || inv.createdAt || new Date().toISOString(),
  };
}

function normalise(raw) {
  const base = emptyState();
  if (!raw || typeof raw !== "object") return base;
  const out = {
    version: 1,
    settings: Object.assign(base.settings, raw.settings || {}),
    suppliers: Array.isArray(raw.suppliers) ? raw.suppliers.map(normaliseSupplier).filter(Boolean) : [],
    invoices: Array.isArray(raw.invoices) ? raw.invoices.map(normaliseInvoice) : [],
    messages: Array.isArray(raw.messages) ? raw.messages.map(normaliseMessage).filter(Boolean) : [],
  };
  // Una factura sin proveedor válido se queda sin asignar en lugar de romper.
  const ids = new Set(out.suppliers.map((s) => s.id));
  out.invoices = out.invoices.filter((inv) => !inv.supplierId || ids.has(inv.supplierId));
  // Cada tercero se coloca como cliente o como proveedor según sus documentos.
  marcarRoles(out.suppliers, out.invoices);
  return out;
}

/** Un tercero puede ser proveedor, cliente, o las dos cosas a la vez. */
function rolValido(valor) {
  const arriba = String(valor || "").trim().toUpperCase();
  return arriba === "CLIENTE" || arriba === "PROVEEDOR" || arriba === "AMBOS" ? arriba : "";
}

/** ¿Este documento es dinero que entra (cliente) o que sale (proveedor)? */
function direccionDeDocumento(doc) {
  const d = doc || {};
  if (d.direction === "INGRESO") return "INGRESO";
  if (d.direction === "GASTO") return "GASTO";
  const tipo = String(d.kind || "").toUpperCase();
  return ["LIQUIDACION", "SUBVENCION", "COBRO", "VENTA"].includes(tipo) ? "INGRESO" : "GASTO";
}

/** El medio de cobro o pago: en efectivo (caja), por banco, o sin decir. */
export function normaliseMedio(valor) {
  const arriba = String(valor || "").trim().toUpperCase();
  if (["CAJA", "EFECTIVO", "METALICO", "METÁLICO"].includes(arriba)) return "CAJA";
  if (["BANCO", "TRANSFERENCIA", "CUENTA", "TARJETA"].includes(arriba)) return "BANCO";
  return "";
}

/** El papel que juega el tercero según el documento. */
function rolDeDocumento(doc) {
  return direccionDeDocumento(doc) === "INGRESO" ? "CLIENTE" : "PROVEEDOR";
}

/** Junta el papel que ya tenía con el que toca: si sale en los dos lados, es AMBOS. */
export function juntarRoles(uno, otro) {
  const a = rolValido(uno);
  const b = rolValido(otro);
  if (!a) return b;
  if (!b) return a;
  return a === b ? a : "AMBOS";
}

/**
 * Pone a cada tercero en su sitio mirando sus documentos: quien solo tiene
 * ingresos es cliente, quien solo tiene gastos es proveedor, y quien tiene de
 * los dos es AMBOS. Así los compradores de fruta dejan de salir como proveedores.
 */
function marcarRoles(suppliers, invoices) {
  const vistos = new Map();
  for (const inv of invoices || []) {
    if (!inv || !inv.supplierId) continue;
    vistos.set(inv.supplierId, juntarRoles(vistos.get(inv.supplierId), rolDeDocumento(inv)));
  }
  for (const s of suppliers || []) {
    const visto = vistos.get(s.id) || "";
    s.role = juntarRoles(rolValido(s.role), visto) || "PROVEEDOR";
  }
}

function normaliseSupplier(s) {
  if (!s || typeof s !== "object") return null;
  const name = String(s.name || "").trim();
  if (!name && !s.nif) return null;
  return {
    id: s.id || uid("sup"),
    name: name || String(s.nif || "Proveedor"),
    nif: String(s.nif || "").trim(),
    email: String(s.email || "").trim(),
    phone: String(s.phone || "").trim(),
    note: String(s.note || "").trim(),
    // Proveedor, cliente o las dos cosas: lo que decide en qué lista sale.
    role: rolValido(s.role),
    createdAt: s.createdAt || new Date().toISOString(),
  };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyState();
    return normalise(JSON.parse(raw));
  } catch (err) {
    console.warn("No se pudieron leer los datos guardados:", err);
    return emptyState();
  }
}

/**
 * Arranca el almacén. Se llama una vez, antes de pintar nada.
 * - Abre la base de datos SQLite (o la crea con sus tablas).
 * - Si hay datos, los trae; si la base está vacía y había datos de la versión
 *   anterior en localStorage, los pasa a SQLite (migración de una sola vez).
 * Devuelve "sqlite" o "local".
 */
export async function initStore() {
  const ok = await sqlite.init();

  if (ok) {
    engine = "sqlite";
    const snapshot = sqlite.readState();
    if (snapshot) {
      state = normalise(snapshot);
    } else {
      state = load(); // datos de antes, si los había
      sqlite.writeState(state);
      await sqlite.persist();
    }
  } else {
    engine = "local";
    state = load();
  }

  lastSaveOk = true;
  emit();
  return engine;
}

/** Guarda: primero en SQLite y además una copia en texto, por si acaso. */
export function save() {
  let stored = false;

  if (engine === "sqlite" && sqlite.isAvailable()) {
    try {
      if (sqlite.writeState(state)) {
        stored = true;
        schedulePersist();
      }
    } catch (err) {
      console.warn("No se pudo escribir en SQLite:", err);
    }
  }

  // Copia de seguridad en texto: sirve si SQLite no arranca la próxima vez.
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    stored = true;
  } catch (err) {
    console.warn("No se pudo guardar la copia en texto:", err);
  }

  lastSaveOk = stored;
  emit();
  return lastSaveOk;
}

/** Vuelca la base de datos a IndexedDB sin esperar (con un pequeño retardo). */
function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    sqlite.persist().catch(() => {});
  }, 220);
}

/** Fuerza el guardado pendiente (al cerrar o cambiar de pestaña). */
export async function flush() {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (engine === "sqlite" && sqlite.isAvailable()) {
    try {
      sqlite.writeState(state);
      return await sqlite.persist();
    } catch (err) {
      console.warn("No se pudo volcar la base de datos:", err);
    }
  }
  return false;
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    if (engine === "sqlite" && sqlite.isAvailable()) {
      try {
        sqlite.writeState(state);
        sqlite.persist();
      } catch (err) {
        /* sin tiempo para más */
      }
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && persistTimer) {
      flush();
    }
  });
}

export function saveWorked() {
  return lastSaveOk;
}

/** Dónde están los datos y cuánto hay: lo enseña Ajustes. */
export function storageInfo() {
  const detail = sqlite.counts();
  return {
    engine,
    sqlite: sqlite.isAvailable(),
    reason: sqlite.why(),
    suppliers: state.suppliers.length,
    invoices: state.invoices.length,
    detail,
    savedAt: sqlite.lastPersistAt(),
  };
}

/** El fichero .sqlite para descargar, o null si SQLite no está disponible. */
export function exportSqliteBytes() {
  return sqlite.exportBytes();
}

/** Resumen del IGIC por proveedor y estado, calculado por SQLite. */
export function sqliteIgicSummary() {
  return sqlite.igicSummary();
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) {
    try {
      fn(state);
    } catch (err) {
      console.error(err);
    }
  }
}

export function getState() {
  return state;
}

/* ------------------------------------------------------------------ */
/* Proveedores                                                        */
/* ------------------------------------------------------------------ */

function nameBase(name) {
  return fold(name)
    .replace(/\b(sl|slu|sll|sa|sau|sc|scc|sccl|srl|cb|coop|sociedad|limitada|anonima|hermanos|eirl)\b/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Busca un proveedor ya existente por NIF o por nombre (aunque venga escrito distinto). */
export function findSupplierByNameOrNif(name, nif) {
  const key = nifKey(nif);
  if (key.length >= 8) {
    const byNif = state.suppliers.find((s) => nifKey(s.nif) === key);
    if (byNif) return byNif;
  }
  const wanted = nameBase(name);
  if (wanted.length < 3) return null;

  const exact = state.suppliers.find((s) => nameBase(s.name) === wanted);
  if (exact) return exact;

  const loose = state.suppliers.find((s) => {
    const other = nameBase(s.name);
    if (other.length < 6 || wanted.length < 6) return false;
    return other.startsWith(wanted) || wanted.startsWith(other);
  });
  return loose || null;
}

/** Devuelve el proveedor o cliente que corresponde y, si no existía, lo crea. */
export function ensureSupplier(name, nif, role) {
  const cleanName = String(name || "").trim();
  const cleanNif = String(nif || "").trim().toUpperCase();
  const roleWanted = rolValido(role);
  const existing = findSupplierByNameOrNif(cleanName, cleanNif);

  if (existing) {
    let touched = false;
    if (!existing.nif && cleanNif) {
      existing.nif = cleanNif;
      touched = true;
    }
    if (!existing.name && cleanName) {
      existing.name = cleanName;
      touched = true;
    }
    // Si el mismo nombre aparece como cliente y como proveedor, pasa a AMBOS.
    const roleNow = juntarRoles(existing.role, roleWanted);
    if (roleNow && roleNow !== existing.role) {
      existing.role = roleNow;
      touched = true;
    }
    if (touched) save();
    return { supplier: existing, created: false };
  }

  const supplier = {
    id: uid("sup"),
    name: cleanName || cleanNif || "Proveedor sin nombre",
    nif: cleanNif,
    email: "",
    phone: "",
    note: "",
    role: roleWanted || "PROVEEDOR",
    createdAt: new Date().toISOString(),
  };
  state.suppliers.push(supplier);
  emit();
  return { supplier, created: true };
}

export function updateSupplier(id, patch) {
  const s = state.suppliers.find((x) => x.id === id);
  if (!s) return null;
  Object.assign(s, patch);
  save();
  return s;
}

export function deleteSupplier(id) {
  state.suppliers = state.suppliers.filter((s) => s.id !== id);
  state.invoices = state.invoices.filter((inv) => inv.supplierId !== id);
  save();
}

export function supplierById(id) {
  return state.suppliers.find((s) => s.id === id) || null;
}

/* ------------------------------------------------------------------ */
/* Facturas                                                           */
/* ------------------------------------------------------------------ */

function invoiceNumbersMatch(a, b) {
  const x = fold(a).replace(/\s/g, "");
  const y = fold(b).replace(/\s/g, "");
  return x.length > 1 && x === y;
}

/** ¿Ya tenemos esta factura? Mismo proveedor y mismo número. */
export function findDuplicate(supplierId, number) {
  if (!number) return null;
  return (
    state.invoices.find(
      (inv) => inv.supplierId === supplierId && invoiceNumbersMatch(inv.number, number)
    ) || null
  );
}

/**
 * Guarda una factura. Crea el proveedor si hace falta.
 * @returns {{invoice: object, supplier: object, supplierCreated: boolean, duplicate: object|null}}
 */
export function addInvoice(data) {
  const { supplier, created } = ensureSupplier(
    data.supplierName,
    data.supplierNif,
    rolDeDocumento(data)
  );
  const duplicate = findDuplicate(supplier.id, data.number);

  const complete = completeAmounts({
    base: numOrNull(data.base),
    igic: numOrNull(data.igic),
    total: numOrNull(data.total),
    rate: numOrNull(data.rate),
  });

  const invoice = normaliseInvoice({
    supplierId: supplier.id,
    number: data.number,
    issueDate: data.issueDate,
    dueDate: data.dueDate,
    base: complete.base,
    rate: complete.rate,
    igic: complete.igic,
    total: complete.total,
    status: data.status,
    kind: data.kind || "FACTURA",
    category: data.category || "",
    direction: direccionDeDocumento(data),
    lines: data.lines || [],
    liquidacion: data.liquidacion || null,
    nomina: data.nomina || null,
    paidDate: data.status === STATUS.PAID ? data.paidDate || todayISO() : "",
    payMethod: data.status === STATUS.PAID ? normaliseMedio(data.payMethod) : "",
    payAccount: data.status === STATUS.PAID ? String(data.payAccount || "").slice(0, 120) : "",
    source: data.source || "manual",
    fileName: data.fileName || "",
    original: data.original || null,
    rawText: data.rawText || "",
    notes: data.notes || [],
    confidence: data.confidence,
  });

  state.invoices.unshift(invoice);
  save();
  return { invoice, supplier, supplierCreated: created, duplicate };
}

export function updateInvoice(id, patch) {
  const inv = state.invoices.find((i) => i.id === id);
  if (!inv) return null;
  Object.assign(inv, patch);
  const complete = completeAmounts({
    base: numOrNull(inv.base),
    igic: numOrNull(inv.igic),
    total: numOrNull(inv.total),
    rate: numOrNull(inv.rate),
  });
  inv.base = complete.base;
  inv.igic = complete.igic;
  inv.total = complete.total;
  inv.rate = complete.rate;
  inv.lines = normaliseInvoice({ lines: inv.lines }).lines;
  inv.liquidacion = normaliseLiquidacion(inv.liquidacion);
  inv.original = normaliseOriginal(inv.original);
  inv.payMethod = normaliseMedio(inv.payMethod);
  inv.payAccount = String(inv.payAccount || "").trim().slice(0, 120);
  if (inv.status === STATUS.PAID && !inv.paidDate) inv.paidDate = todayISO();
  if (inv.status === STATUS.PENDING) {
    // Sin cobrar ni pagar no hay ni fecha ni medio que guardar.
    inv.paidDate = "";
    inv.payMethod = "";
    inv.payAccount = "";
  }
  inv.updatedAt = new Date().toISOString();
  save();
  return inv;
}

export function deleteInvoice(id) {
  state.invoices = state.invoices.filter((i) => i.id !== id);
  // El fichero original se va con el documento.
  files.dropOriginal(id).catch(() => {});
  save();
}

export function setInvoiceStatus(id, status, paidDate, pay) {
  const patch = { status };
  if (status === STATUS.PAID) {
    // La fecha del cobro o del pago la elige la persona; si no dice nada, hoy.
    const day = String(paidDate || "").slice(0, 10);
    if (day) patch.paidDate = day;
    // Y con qué se cobró o se pagó: caja o banco, y en qué cuenta corriente.
    const medio = normaliseMedio(pay && pay.method);
    if (medio) patch.payMethod = medio;
    if (pay && pay.account != null) patch.payAccount = String(pay.account || "").slice(0, 120);
  } else {
    // Vuelve a pendiente: no hay fecha ni medio que guardar.
    patch.paidDate = "";
    patch.payMethod = "";
    patch.payAccount = "";
  }
  return updateInvoice(id, patch);
}

export function toggleInvoiceStatus(id, paidDate, pay) {
  const inv = state.invoices.find((i) => i.id === id);
  if (!inv) return null;
  return setInvoiceStatus(
    id,
    inv.status === STATUS.PAID ? STATUS.PENDING : STATUS.PAID,
    paidDate,
    pay
  );
}

export function invoiceById(id) {
  return state.invoices.find((i) => i.id === id) || null;
}

/* ------------------------------------------------------------------ */
/* Los ficheros originales                                            */
/* ------------------------------------------------------------------ */

/**
 * Guarda el fichero del que salieron los datos (la foto, el PDF o el correo),
 * tal y como entró, para poder volver a mirarlo más adelante.
 * Los bytes van a IndexedDB (files.js); en el documento queda solo el nombre,
 * el tipo y el tamaño, que es lo que se enseña en su ficha.
 */
export async function keepInvoiceOriginal(id, blob) {
  const inv = invoiceById(id);
  if (!inv || !blob) return null;
  // Solo se guardan ficheros de verdad: una nota de "texto pegado" no tiene bytes.
  if (typeof Blob === "undefined" || !(blob instanceof Blob)) return null;
  const size = Number(blob.size) || 0;
  if (!size) return null;
  try {
    const info = await files.keepOriginal(id, blob, {
      name: blob.name || inv.fileName || "documento",
      type: blob.type || "",
    });
    inv.original = normaliseOriginal(info);
    inv.updatedAt = new Date().toISOString();
    save();
    return inv.original;
  } catch (err) {
    console.warn("No se pudo guardar el original del documento:", err);
    return null;
  }
}

/** El fichero original de un documento, para verlo o descargarlo. */
export async function invoiceOriginalBody(id) {
  try {
    return await files.originalOf(id);
  } catch (err) {
    console.warn("No se pudo leer el original del documento:", err);
    return null;
  }
}

/** Deja de guardar el original de un documento (el documento sigue igual). */
export async function removeInvoiceOriginal(id) {
  const inv = invoiceById(id);
  try {
    await files.dropOriginal(id);
  } catch (err) {
    console.warn("No se pudo borrar el original del documento:", err);
    return null;
  }
  if (inv) {
    inv.original = null;
    inv.updatedAt = new Date().toISOString();
    save();
  }
  return inv || null;
}

/** Cuántos originales hay guardados y cuánto ocupan (lo enseña Ajustes). */
export async function originalsUsage() {
  if (!files.filesSupported()) return { count: 0, bytes: 0 };
  try {
    return await files.originalsUsed();
  } catch {
    return { count: 0, bytes: 0 };
  }
}

function numOrNull(v) {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/* ------------------------------------------------------------------ */
/* Cifras                                                             */
/* ------------------------------------------------------------------ */

/** Totales de un conjunto de facturas. */
export function totals(invoices) {
  const out = {
    count: invoices.length,
    base: 0,
    igic: 0,
    total: 0,
    paid: 0,
    pending: 0,
    pendingCount: 0,
    paidCount: 0,
    igicPending: 0,
    overdue: 0,
    overdueCount: 0,
    income: 0,
    expense: 0,
    incomeCount: 0,
    expenseCount: 0,
    incomePending: 0,
    expensePending: 0,
    byCategory: {},
  };
  const today = todayISO();
  for (const inv of invoices) {
    const base = Number(inv.base) || 0;
    const igic = Number(inv.igic) || 0;
    const total = Number(inv.total) || 0;
    const isIncome = inv.direction === "INGRESO";
    out.base += base;
    out.igic += igic;
    out.total += total;
    if (isIncome) {
      out.income = round2(out.income + total);
      out.incomeCount++;
      if (inv.status !== STATUS.PAID) out.incomePending = round2(out.incomePending + total);
    } else {
      out.expense = round2(out.expense + total);
      out.expenseCount++;
      if (inv.status !== STATUS.PAID) out.expensePending = round2(out.expensePending + total);
    }
    const cat = inv.category || "SIN";
    const row = out.byCategory[cat] || { total: 0, count: 0, pending: 0, direction: isIncome ? "INGRESO" : "GASTO" };
    row.total = round2(row.total + total);
    row.count++;
    if (inv.status !== STATUS.PAID) row.pending = round2(row.pending + total);
    out.byCategory[cat] = row;
    if (inv.status === STATUS.PAID) {
      out.paid += total;
      out.paidCount++;
    } else {
      out.pending += total;
      out.igicPending += igic;
      out.pendingCount++;
      if (inv.dueDate && inv.dueDate < today) {
        out.overdue += total;
        out.overdueCount++;
      }
    }
  }
  out.base = round2(out.base);
  out.igic = round2(out.igic);
  out.total = round2(out.total);
  out.paid = round2(out.paid);
  out.pending = round2(out.pending);
  out.igicPending = round2(out.igicPending);
  out.overdue = round2(out.overdue);
  return out;
}

/** Cifras por proveedor: { [supplierId]: {...} }. */
export function statsBySupplier() {
  const map = new Map();
  for (const s of state.suppliers) {
    map.set(s.id, { count: 0, total: 0, pending: 0, lastDate: "", countPending: 0 });
  }
  for (const inv of state.invoices) {
    if (!inv.supplierId) continue;
    const row = map.get(inv.supplierId) || { count: 0, total: 0, pending: 0, lastDate: "", countPending: 0 };
    row.count++;
    row.total = round2(row.total + (Number(inv.total) || 0));
    if (inv.status !== STATUS.PAID) {
      row.pending = round2(row.pending + (Number(inv.total) || 0));
      row.countPending++;
    }
    if (inv.issueDate && inv.issueDate > row.lastDate) row.lastDate = inv.issueDate;
    map.set(inv.supplierId, row);
  }
  return map;
}

/* ------------------------------------------------------------------ */
/* Correo: mensajes guardados                                         */
/* ------------------------------------------------------------------ */

export function messages() {
  return state.messages;
}

export function messageById(id) {
  return state.messages.find((m) => m.id === id) || null;
}

export function addMessage(raw) {
  const msg = normaliseMessage(raw);
  if (!msg) return null;
  const same = state.messages.find(
    (m) => m.subject === msg.subject && m.from === msg.from && m.text.slice(0, 200) === msg.text.slice(0, 200)
  );
  if (same) return same;
  state.messages.unshift(msg);
  if (state.messages.length > 200) state.messages.length = 200;
  save();
  return msg;
}

export function markMessageUsed(id) {
  const msg = messageById(id);
  if (!msg) return null;
  msg.usedAt = new Date().toISOString();
  save();
  return msg;
}

export function deleteMessage(id) {
  state.messages = state.messages.filter((m) => m.id !== id);
  save();
}

export function invoicesOf(supplierId) {
  return state.invoices.filter((i) => i.supplierId === supplierId);
}

export function sortedInvoices(list = state.invoices) {
  return list.slice().sort((a, b) => {
    const da = a.issueDate || a.createdAt || "";
    const db = b.issueDate || b.createdAt || "";
    if (da === db) return (b.createdAt || "").localeCompare(a.createdAt || "");
    return db.localeCompare(da);
  });
}

/* ------------------------------------------------------------------ */
/* Ajustes, ejemplo y copia de seguridad                              */
/* ------------------------------------------------------------------ */

export function updateSettings(patch) {
  state.settings = Object.assign(state.settings, patch);
  save();
  return state.settings;
}

export function clearAll() {
  state = emptyState();
  // Los originales también se van: si no, se quedarían ocupando sitio sin dueño.
  files.forgetAllOriginals().catch(() => {});
  save();
}

export function exportJSON() {
  const { aiKey, ...settings } = state.settings;
  return JSON.stringify({ ...state, settings, exportedAt: new Date().toISOString() }, null, 2);
}

export function importJSON(text) {
  const parsed = JSON.parse(text);
  validateBackup(parsed);
  // Las copias antiguas podían contener claves. No importarlas ni sustituir
  // la credencial configurada en este navegador por la de otra instalación.
  const settings = { ...parsed.settings, aiKey: state.settings.aiKey };
  const restored = normalise({ ...parsed, settings });
  state = restored;
  save();
  return state;
}

/** Datos de ejemplo, para que se vea cómo funciona sin tener que subir nada. */
export function seedDemo() {
  const t = todayISO();
  const y = Number(t.slice(0, 4));
  const m = Number(t.slice(5, 7));
  const stamp = (monthOffset, day) => {
    const d = new Date(y, m - 1 - monthOffset, Math.min(day, 28));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  const demo = [
    {
      supplier: "Distribuciones Timanfaya S.L.", nif: "B38000111",
      rows: [
        { number: "2024/0184", issueDate: stamp(0, 24), dueDate: stamp(-1, 24), base: 1240.5, rate: 7, status: STATUS.PENDING },
        { number: "2024/0151", issueDate: stamp(1, 22), dueDate: stamp(0, 22), base: 986.2, rate: 7, status: STATUS.PAID },
        { number: "2024/0120", issueDate: stamp(2, 18), dueDate: stamp(1, 18), base: 1102.75, rate: 7, status: STATUS.PAID },
      ],
    },
    {
      supplier: "Ferretería El Cardón", nif: "B38000222",
      rows: [
        { number: "FC-1042", issueDate: stamp(0, 20), dueDate: stamp(-1, 20), base: 318.4, rate: 7, status: STATUS.PENDING },
        { number: "FC-0988", issueDate: stamp(1, 11), dueDate: stamp(0, 11), base: 254.15, rate: 7, status: STATUS.PAID },
        { number: "FC-0901", issueDate: stamp(3, 3), dueDate: stamp(2, 3), base: 145.9, rate: 7, status: STATUS.PAID },
      ],
    },
    {
      supplier: "Panificadora Artenara S.C.", nif: "G38000333",
      rows: [
        { number: "A/2024-0567", issueDate: stamp(0, 15), dueDate: stamp(-1, 15), base: 642.3, rate: 3, status: STATUS.PENDING },
        { number: "A/2024-0488", issueDate: stamp(1, 14), dueDate: stamp(0, 14), base: 588.75, rate: 3, status: STATUS.PAID },
      ],
    },
    {
      supplier: "Suministros Añaza S.L.", nif: "B38000444",
      rows: [
        { number: "S-2024/0121", issueDate: stamp(0, 8), dueDate: stamp(-1, 8), base: 2087.0, rate: 7, status: STATUS.PENDING },
        { number: "S-2024/0099", issueDate: stamp(2, 6), dueDate: stamp(1, 6), base: 342.1, rate: 0, status: STATUS.PAID },
      ],
    },
    {
      supplier: "Talleres Güímar S.L.", nif: "B38000555",
      rows: [
        { number: "TG-2210", issueDate: stamp(1, 27), dueDate: stamp(0, 27), base: 780.0, rate: 7, status: STATUS.PAID },
      ],
    },
  ];

  for (const group of demo) {
    for (const row of group.rows) {
      addInvoice({
        supplierName: group.supplier,
        supplierNif: group.nif,
        number: row.number,
        issueDate: row.issueDate,
        dueDate: row.dueDate,
        base: row.base,
        rate: row.rate,
        status: row.status,
        source: "manual",
        notes: [],
      });
    }
  }
  save();
}
