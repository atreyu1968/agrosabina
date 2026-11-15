/*
* Los datos: proveedores, facturas y ajustes.
* Se guardan en una base de datos SQLite que vive dentro del navegador (ver
* sqlite.js). Si SQLite no puede cargarse, se guarda como antes, en
* localStorage, y Ajustes lo avisa.
*/
import { STATUS, completeAmounts, fold, nifKey, round2, todayISO, uid } from "./util.js";
import * as sqlite from "./sqlite.js";
const KEY = "facturas.igic.v1";
const listeners = new Set();
let state = emptyState();
let lastSaveOk = true;
let engine = "local";
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
			aiEnabled: false,
			aiEndpoint: "https://api.openai.com/v1",
			aiModel: "gpt-4o-mini",
			aiKey: "",
			createdAt: new Date().toISOString()
		},
		suppliers: [],
		invoices: [],
		messages: []
	};
}
function normaliseMessage(m) {
	if (!m || typeof m !== "object") return null;
	const subject = String(m.subject || "").trim();
	const text = String(m.text || "").slice(0, 2e4);
	if (!subject && !text) return null;
	return {
		id: m.id || uid("msg"),
		from: String(m.from || "").trim(),
		subject: subject || "(sin asunto)",
		date: String(m.date || "").trim(),
		text,
		attachments: Array.isArray(m.attachments) ? m.attachments.slice(0, 30).map((a) => {
			if (typeof a === "string") return {
				name: a,
				type: "",
				readable: false,
				size: 0
			};
			const bytes = a && a.bytes;
			return {
				name: String(a && a.name || "adjunto"),
				type: String(a && a.type || ""),
				readable: !!(a && a.readable),
				size: Number(a && a.size || 0) || (bytes && bytes.length ? bytes.length : 0)
			};
		}) : [],
		importedAt: m.importedAt || new Date().toISOString(),
		usedAt: m.usedAt || ""
	};
}
/**
* Una liquidación de fruta: kilos, precio por kilo, descuentos y líquido a
* percibir. El bruto y el líquido se calculan, no se guardan.
*/
function normaliseLiquidacion(liq) {
	if (!liq || typeof liq !== "object") return null;
	const n = (v) => v !== null && v !== "" && Number.isFinite(+v) ? +v : null;
	const kg = n(liq.kg);
	const price = n(liq.price);
	const product = String(liq.product || "").trim().slice(0, 120);
	const category = String(liq.category || "").trim().slice(0, 40);
	const discounts = Array.isArray(liq.discounts) ? liq.discounts.map((d) => {
		if (!d || typeof d !== "object") return null;
		const label = String(d.label || "").trim().slice(0, 120);
		const amount = n(d.amount);
		if (!label && amount == null) return null;
		return {
			label,
			amount: amount == null ? 0 : amount
		};
	}).filter(Boolean).slice(0, 40) : [];
	if (!product && !category && kg == null && price == null && !discounts.length) return null;
	return {
		product,
		category,
		kg,
		price,
		discounts
	};
}
function normaliseInvoice(inv) {
	const base = Number.isFinite(+inv.base) && inv.base !== null && inv.base !== "" ? +inv.base : null;
	const igic = Number.isFinite(+inv.igic) && inv.igic !== null && inv.igic !== "" ? +inv.igic : null;
	const total = Number.isFinite(+inv.total) && inv.total !== null && inv.total !== "" ? +inv.total : null;
	const rate = Number.isFinite(+inv.rate) && inv.rate !== null && inv.rate !== "" ? +inv.rate : null;
	const complete = completeAmounts({
		base,
		igic,
		total,
		rate
	});
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
		kind: String(inv.kind || "FACTURA"),
		category: String(inv.category || ""),
		direction: inv.direction === "INGRESO" ? "INGRESO" : inv.direction === "GASTO" ? "GASTO" : [
			"LIQUIDACION",
			"SUBVENCION",
			"COBRO"
		].includes(String(inv.kind || "")) ? "INGRESO" : "GASTO",
		// Un documento puede llevar varios tipos de IGIC: cada línea guarda su base y su tipo.
		lines: Array.isArray(inv.lines) ? inv.lines.map((l) => {
			const lb = Number.isFinite(+l.base) && l.base !== null && l.base !== "" ? +l.base : null;
			const lr = Number.isFinite(+l.rate) && l.rate !== null && l.rate !== "" ? +l.rate : null;
			return lb == null || lr == null ? null : {
				base: lb,
				rate: lr
			};
		}).filter(Boolean) : [],
		// Liquidación de fruta: kilos, precio por kilo, descuentos y líquido a percibir.
		liquidacion: normaliseLiquidacion(inv.liquidacion),
		source: inv.source || "manual",
		fileName: inv.fileName || "",
		rawText: String(inv.rawText || "").slice(0, 8e3),
		notes: Array.isArray(inv.notes) ? inv.notes : [],
		confidence: Number.isFinite(inv.confidence) ? inv.confidence : null,
		createdAt: inv.createdAt || new Date().toISOString(),
		updatedAt: inv.updatedAt || inv.createdAt || new Date().toISOString()
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
		messages: Array.isArray(raw.messages) ? raw.messages.map(normaliseMessage).filter(Boolean) : []
	};
	// Una factura sin proveedor válido se queda sin asignar en lugar de romper.
	const ids = new Set(out.suppliers.map((s) => s.id));
	out.invoices = out.invoices.filter((inv) => !inv.supplierId || ids.has(inv.supplierId));
	return out;
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
		createdAt: s.createdAt || new Date().toISOString()
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
			state = load();
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
			} catch (err) {}
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
		savedAt: sqlite.lastPersistAt()
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
	return fold(name).replace(/\b(sl|slu|sll|sa|sau|sc|scc|sccl|srl|cb|coop|sociedad|limitada|anonima|hermanos|eirl)\b/g, "").replace(/\s{2,}/g, " ").trim();
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
/** Devuelve el proveedor que corresponde y, si no existía, lo crea. */
export function ensureSupplier(name, nif) {
	const cleanName = String(name || "").trim();
	const cleanNif = String(nif || "").trim().toUpperCase();
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
		if (touched) save();
		return {
			supplier: existing,
			created: false
		};
	}
	const supplier = {
		id: uid("sup"),
		name: cleanName || cleanNif || "Proveedor sin nombre",
		nif: cleanNif,
		email: "",
		phone: "",
		note: "",
		createdAt: new Date().toISOString()
	};
	state.suppliers.push(supplier);
	emit();
	return {
		supplier,
		created: true
	};
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
	return state.invoices.find((inv) => inv.supplierId === supplierId && invoiceNumbersMatch(inv.number, number)) || null;
}
/**
* Guarda una factura. Crea el proveedor si hace falta.
* @returns {{invoice: object, supplier: object, supplierCreated: boolean, duplicate: object|null}}
*/
export function addInvoice(data) {
	const { supplier, created } = ensureSupplier(data.supplierName, data.supplierNif);
	const duplicate = findDuplicate(supplier.id, data.number);
	const complete = completeAmounts({
		base: numOrNull(data.base),
		igic: numOrNull(data.igic),
		total: numOrNull(data.total),
		rate: numOrNull(data.rate)
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
		direction: data.direction === "INGRESO" ? "INGRESO" : "GASTO",
		lines: data.lines || [],
		liquidacion: data.liquidacion || null,
		paidDate: data.status === STATUS.PAID ? data.paidDate || todayISO() : "",
		source: data.source || "manual",
		fileName: data.fileName || "",
		rawText: data.rawText || "",
		notes: data.notes || [],
		confidence: data.confidence
	});
	state.invoices.unshift(invoice);
	save();
	return {
		invoice,
		supplier,
		supplierCreated: created,
		duplicate
	};
}
export function updateInvoice(id, patch) {
	const inv = state.invoices.find((i) => i.id === id);
	if (!inv) return null;
	Object.assign(inv, patch);
	const complete = completeAmounts({
		base: numOrNull(inv.base),
		igic: numOrNull(inv.igic),
		total: numOrNull(inv.total),
		rate: numOrNull(inv.rate)
	});
	inv.base = complete.base;
	inv.igic = complete.igic;
	inv.total = complete.total;
	inv.rate = complete.rate;
	inv.lines = normaliseInvoice({ lines: inv.lines }).lines;
	inv.liquidacion = normaliseLiquidacion(inv.liquidacion);
	if (inv.status === STATUS.PAID && !inv.paidDate) inv.paidDate = todayISO();
	if (inv.status === STATUS.PENDING) inv.paidDate = "";
	inv.updatedAt = new Date().toISOString();
	save();
	return inv;
}
export function deleteInvoice(id) {
	state.invoices = state.invoices.filter((i) => i.id !== id);
	save();
}
export function setInvoiceStatus(id, status, paidDate) {
	const patch = { status };
	if (status === STATUS.PAID) {
		// La fecha del cobro o del pago la elige la persona; si no dice nada, hoy.
		const day = String(paidDate || "").slice(0, 10);
		if (day) patch.paidDate = day;
	} else {
		// Vuelve a pendiente: no hay fecha que guardar.
		patch.paidDate = "";
	}
	return updateInvoice(id, patch);
}
export function toggleInvoiceStatus(id, paidDate) {
	const inv = state.invoices.find((i) => i.id === id);
	if (!inv) return null;
	return setInvoiceStatus(id, inv.status === STATUS.PAID ? STATUS.PENDING : STATUS.PAID, paidDate);
}
export function invoiceById(id) {
	return state.invoices.find((i) => i.id === id) || null;
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
		byCategory: {}
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
		const row = out.byCategory[cat] || {
			total: 0,
			count: 0,
			pending: 0,
			direction: isIncome ? "INGRESO" : "GASTO"
		};
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
		map.set(s.id, {
			count: 0,
			total: 0,
			pending: 0,
			lastDate: "",
			countPending: 0
		});
	}
	for (const inv of state.invoices) {
		if (!inv.supplierId) continue;
		const row = map.get(inv.supplierId) || {
			count: 0,
			total: 0,
			pending: 0,
			lastDate: "",
			countPending: 0
		};
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
	const same = state.messages.find((m) => m.subject === msg.subject && m.from === msg.from && m.text.slice(0, 200) === msg.text.slice(0, 200));
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
	save();
}
export function exportJSON() {
	return JSON.stringify({
		...state,
		exportedAt: new Date().toISOString()
	}, null, 2);
}
export function importJSON(text) {
	const parsed = JSON.parse(text);
	if (!parsed || !Array.isArray(parsed.suppliers) && !Array.isArray(parsed.invoices)) {
		throw new Error("El fichero no parece una copia de seguridad de este programa.");
	}
	state = normalise(parsed);
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
			supplier: "Distribuciones Timanfaya S.L.",
			nif: "B38000111",
			rows: [
				{
					number: "2024/0184",
					issueDate: stamp(0, 24),
					dueDate: stamp(-1, 24),
					base: 1240.5,
					rate: 7,
					status: STATUS.PENDING
				},
				{
					number: "2024/0151",
					issueDate: stamp(1, 22),
					dueDate: stamp(0, 22),
					base: 986.2,
					rate: 7,
					status: STATUS.PAID
				},
				{
					number: "2024/0120",
					issueDate: stamp(2, 18),
					dueDate: stamp(1, 18),
					base: 1102.75,
					rate: 7,
					status: STATUS.PAID
				}
			]
		},
		{
			supplier: "Ferretería El Cardón",
			nif: "B38000222",
			rows: [
				{
					number: "FC-1042",
					issueDate: stamp(0, 20),
					dueDate: stamp(-1, 20),
					base: 318.4,
					rate: 7,
					status: STATUS.PENDING
				},
				{
					number: "FC-0988",
					issueDate: stamp(1, 11),
					dueDate: stamp(0, 11),
					base: 254.15,
					rate: 7,
					status: STATUS.PAID
				},
				{
					number: "FC-0901",
					issueDate: stamp(3, 3),
					dueDate: stamp(2, 3),
					base: 145.9,
					rate: 7,
					status: STATUS.PAID
				}
			]
		},
		{
			supplier: "Panificadora Artenara S.C.",
			nif: "G38000333",
			rows: [{
				number: "A/2024-0567",
				issueDate: stamp(0, 15),
				dueDate: stamp(-1, 15),
				base: 642.3,
				rate: 3,
				status: STATUS.PENDING
			}, {
				number: "A/2024-0488",
				issueDate: stamp(1, 14),
				dueDate: stamp(0, 14),
				base: 588.75,
				rate: 3,
				status: STATUS.PAID
			}]
		},
		{
			supplier: "Suministros Añaza S.L.",
			nif: "B38000444",
			rows: [{
				number: "S-2024/0121",
				issueDate: stamp(0, 8),
				dueDate: stamp(-1, 8),
				base: 2087,
				rate: 7,
				status: STATUS.PENDING
			}, {
				number: "S-2024/0099",
				issueDate: stamp(2, 6),
				dueDate: stamp(1, 6),
				base: 342.1,
				rate: 0,
				status: STATUS.PAID
			}]
		},
		{
			supplier: "Talleres Güímar S.L.",
			nif: "B38000555",
			rows: [{
				number: "TG-2210",
				issueDate: stamp(1, 27),
				dueDate: stamp(0, 27),
				base: 780,
				rate: 7,
				status: STATUS.PAID
			}]
		}
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
				notes: []
			});
		}
	}
	save();
}
