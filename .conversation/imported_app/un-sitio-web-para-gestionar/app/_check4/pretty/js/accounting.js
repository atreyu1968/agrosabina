/*
* Contabilidad de Agrosabina SL.
*
* De cada documento guardado (facturas, liquidaciones, subvenciones, cobros,
* nóminas) sale un asiento, y de los asientos salen los cuatro libros que
* pide la persona: diario, mayor, balance de sumas y saldos, balance de
* situación y cuenta de pérdidas y ganancias. Los dos últimos se presentan
* con los epígrafes del modelo oficial del Plan General de Contabilidad.
*
* Este fichero no toca la pantalla ni la base de datos: solo hace cuentas.
* Todas las funciones son puras y devuelven datos listos para pintar.
*/
import { round2 } from "./util.js";
import { directionOf } from "./model.js";
import { pgcNombre } from "./pgc.js";
/* ------------------------------------------------------------------ */
/* Plan de cuentas                                                    */
/* ------------------------------------------------------------------ */
/**
* Las cuentas que usa el programa. `pl` dice en qué línea de la cuenta de
* pérdidas y ganancias va; `balance`, en qué epígrafe del balance. Las de
* gastos e ingresos no van al balance (su saldo acaba en el resultado).
*/
export const CUENTAS = Object.freeze([
	{
		code: "100",
		name: "Capital social",
		balance: "PN_I"
	},
	{
		code: "113",
		name: "Reservas voluntarias",
		balance: "PN_III"
	},
	{
		code: "121",
		name: "Resultados negativos de ejercicios anteriores",
		balance: "PN_V"
	},
	{
		code: "400",
		name: "Proveedores",
		balance: "PC_V"
	},
	{
		code: "430",
		name: "Clientes",
		balance: "AC_III"
	},
	{
		code: "472",
		name: "Hacienda Pública, IGIC soportado",
		balance: "AC_III"
	},
	{
		code: "477",
		name: "Hacienda Pública, IGIC repercutido",
		balance: "PC_V"
	},
	{
		code: "570",
		name: "Caja",
		balance: "AC_VII"
	},
	{
		code: "572",
		name: "Bancos e instituciones de crédito c/c",
		balance: "AC_VII"
	},
	{
		code: "602",
		name: "Compras de otros aprovisionamientos",
		pl: "4"
	},
	{
		code: "623",
		name: "Servicios de profesionales independientes",
		pl: "7"
	},
	{
		code: "628",
		name: "Suministros",
		pl: "7"
	},
	{
		code: "629",
		name: "Otros servicios",
		pl: "7"
	},
	{
		code: "630",
		name: "Impuesto sobre beneficios",
		pl: "17"
	},
	{
		code: "631",
		name: "Otros tributos",
		pl: "7"
	},
	{
		code: "640",
		name: "Sueldos y salarios",
		pl: "6"
	},
	{
		code: "642",
		name: "Seguridad Social a cargo de la empresa",
		pl: "6"
	},
	{
		code: "701",
		name: "Ventas de productos terminados",
		pl: "1"
	},
	{
		code: "740",
		name: "Subvenciones a la explotación",
		pl: "5"
	},
	{
		code: "759",
		name: "Ingresos por servicios diversos",
		pl: "5"
	}
]);
/**
* Epígrafe de balance que le toca a una cuenta que no está en la lista. Se
* mira el grupo y, dentro del 4 y del 5, el subgrupo: 430 Clientes es dinero
* que nos deben (activo) y 400 Proveedores es dinero que debemos (pasivo).
*/
function balancePorDefecto(code) {
	const c = String(code || "").slice(0, 3);
	const first = c.charAt(0);
	if (first === "1") return "PN_V";
	if (first === "2") return "AN_II";
	if (first === "3") return "AC_II";
	if (first === "4") {
		if (c >= "430" && c <= "449") return "AC_III";
		if (c >= "470" && c <= "474") return "AC_III";
		if (c >= "480" && c <= "489") return "AC_III";
		return "PC_V";
	}
	if (first === "5") {
		if (c >= "500" && c <= "509") return "PC_II";
		if (c >= "520" && c <= "559") return "PC_III";
		return "AC_VII";
	}
	return "";
}
/**
* Línea de la cuenta de pérdidas y ganancias para una cuenta que no está en
* la lista. Solo para las de gasto (6) e ingreso (7): así un asiento manual
* con una cuenta nueva no se queda fuera del modelo.
*/
function plPorDefecto(code) {
	const c = String(code || "");
	if (c.charAt(0) === "6") {
		const sub = c.slice(0, 2);
		if (sub === "60" || sub === "61") return "4";
		if (sub === "62" || sub === "63") return "7";
		if (sub === "64") return "6";
		if (sub === "66") return "13";
		if (sub === "68") return "8";
		if (sub === "69") return "11";
		return "";
	}
	if (c.charAt(0) === "7") {
		const sub = c.slice(0, 2);
		if (sub === "70") return "1";
		if (sub === "71") return "2";
		if (sub === "73") return "3";
		if (sub === "74" || sub === "75") return "5";
		if (sub === "76") return "12";
		return "";
	}
	return "";
}
const CACHE_CUENTAS = new Map();
/**
* Las subcuentas y las cuentas propias que la persona ha dado de alta, para
* que su nombre salga en el diario y en el mayor. Se las dice la pantalla con
* setPlanDeCuentas(); este fichero no las guarda él mismo.
*/
let PLANO = {
	subcuentas: [],
	propias: []
};
/**
* Le pasa a la contabilidad las subcuentas abiertas (a cada cliente, a cada
* proveedor, a cada banco) y las cuentas propias. Si cambian, se olvida de los
* nombres que tenía apuntados para volver a leerlos.
*/
export function setPlanDeCuentas(plan) {
	const p = plan || {};
	const subcuentas = (p.subcuentas || []).map((s) => ({
		code: String(s.code || "").trim(),
		name: String(s.name || "").trim(),
		key: String(s.key == null ? "" : s.key),
		cuenta: String(s.cuenta || String(s.code || "").slice(0, 3))
	}));
	const propias = (p.propias || []).map((c) => ({
		code: String(c.code || "").trim(),
		name: String(c.name || "").trim()
	}));
	const firma = subcuentas.map((s) => `${s.code}=${s.name}`).join("|") + "#" + propias.map((c) => `${c.code}=${c.name}`).join("|");
	const antes = PLANO.subcuentas.map((s) => `${s.code}=${s.name}`).join("|") + "#" + PLANO.propias.map((c) => `${c.code}=${c.name}`).join("|");
	PLANO = {
		subcuentas,
		propias
	};
	if (firma !== antes) CACHE_CUENTAS.clear();
}
/** La ficha de una cuenta: código, nombre, epígrafe de balance y línea de P&G. */
export function cuenta(code) {
	const key = String(code == null ? "" : code).trim();
	if (CACHE_CUENTAS.has(key)) return CACHE_CUENTAS.get(key);
	const found = CUENTAS.find((c) => c.code === key);
	let row;
	if (found) {
		row = {
			code: key,
			name: found.name,
			balance: found.balance || balancePorDefecto(key),
			pl: found.pl || ""
		};
	} else {
		const propia = PLANO.propias.find((c) => c.code === key);
		const sub = PLANO.subcuentas.find((s) => s.code === key);
		const madre = pgcNombre(key);
		const nombre = propia && propia.name || sub && sub.name || madre;
		row = {
			code: key,
			name: nombre || `Cuenta ${key}`,
			balance: balancePorDefecto(key),
			pl: plPorDefecto(key)
		};
	}
	CACHE_CUENTAS.set(key, row);
	return row;
}
/* ------------------------------------------------------------------ */
/* De documento a cuenta                                              */
/* ------------------------------------------------------------------ */
const GASTO_POR_CONCEPTO = {
	AGUA: "628",
	ELECTRICIDAD: "628",
	COMBUSTIBLE: "628",
	SERVICIOS: "623",
	FITOSANITARIOS: "602",
	ABONOS: "602",
	IMPUESTOS: "631",
	LABORALES: "640"
};
const INGRESO_POR_CONCEPTO = {
	FRUTA: "701",
	SUBVENCIONES: "740"
};
/** La cuenta de gasto o de ingreso que le toca a un documento. */
export function cuentaDeDocumento(inv) {
	const kind = String(inv && inv.kind || "FACTURA");
	const cat = String(inv && inv.category || "");
	if (kind === "LIQUIDACION") return "701";
	if (kind === "SUBVENCION") return "740";
	if (kind === "NOMINA") return "640";
	if (kind === "COBRO") return cat === "SUBVENCIONES" ? "740" : cat === "FRUTA" ? "701" : "759";
	if (directionOf(kind) === "INGRESO") return INGRESO_POR_CONCEPTO[cat] || "759";
	return GASTO_POR_CONCEPTO[cat] || "629";
}
/* ------------------------------------------------------------------ */
/* Quién es el tercero: cada cliente y proveedor con su subcuenta     */
/* ------------------------------------------------------------------ */
/**
* La clave con la que se reconoce a un cliente o a un proveedor: su nombre en
* minúsculas y sin acentos, para que «Pérez, S.L.» y «perez sl» cuenten como
* el mismo. Si el documento no trae nombre, se usa el del proveedor guardado.
*/
export function claveDeTercero(inv) {
	const d = inv || {};
	const bruto = String(d.party || d.supplierName || "").trim();
	if (!bruto && d.supplierId != null) return `id:${d.supplierId}`;
	const limpio = bruto.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[.,;:]/g, " ").replace(/\s+/g, " ").trim();
	return limpio || "sin-nombre";
}
/** La subcuenta que le toca a un tercero, si ya se le abrió una. */
export function cuentaTerceroPorClave(ingreso, clave) {
	const prefijo = ingreso ? "430" : "400";
	const buscada = String(clave == null ? "" : clave);
	const found = PLANO.subcuentas.find((s) => s.cuenta === prefijo && s.key === buscada);
	return found && found.code ? found.code : prefijo;
}
/** La subcuenta de un documento concreto: 430001, 400003… o la cuenta madre. */
export function cuentaTercero(inv, ingreso) {
	return cuentaTerceroPorClave(ingreso, claveDeTercero(inv));
}
/** Base, cuota y total de un documento, cuadrados entre sí. */
function importes(inv) {
	let base = round2(Number(inv.base) || 0);
	const igic = round2(Number(inv.igic) || 0);
	let total = round2(Number(inv.total) || 0);
	if (!total) total = round2(base + igic);
	if (!total) return {
		base: 0,
		igic: 0,
		total: 0
	};
	if (!base) base = round2(total - igic);
	// Si el total guardado no cuadra con base + cuota, manda el total del papel.
	if (Math.abs(round2(base + igic) - total) > .02) base = round2(total - igic);
	return {
		base,
		igic,
		total
	};
}
/**
* Convierte una lista de [cuenta, importe] en renglones con debe y haber.
* Un importe positivo va al debe; uno negativo, al haber. Si bailan céntimos,
* se los lleva la cuenta de mayor importe para que el asiento cuadre.
*/
export function lineas(raw) {
	const rows = (raw || []).map((pair) => ({
		code: String(pair[0]),
		value: round2(Number(pair[1]) || 0)
	})).filter((r) => Math.abs(r.value) >= .005);
	if (!rows.length) return [];
	const suma = round2(rows.reduce((n, r) => n + r.value, 0));
	if (suma !== 0) {
		let biggest = rows[0];
		for (const r of rows) if (Math.abs(r.value) > Math.abs(biggest.value)) biggest = r;
		biggest.value = round2(biggest.value - suma);
	}
	return rows.filter((r) => Math.abs(r.value) >= .005).map((r) => ({
		account: r.code,
		name: cuenta(r.code).name,
		debit: r.value > 0 ? r.value : 0,
		credit: r.value < 0 ? Math.abs(r.value) : 0
	}));
}
function totalLineas(lines) {
	return round2((lines || []).reduce((n, l) => n + l.debit, 0));
}
/* ------------------------------------------------------------------ */
/* Asientos                                                           */
/* ------------------------------------------------------------------ */
const ORDEN = {
	apertura: 0,
	manual: 1,
	devengo: 1,
	cobro: 2,
	pago: 3
};
/**
* Los asientos del periodo. Uno por documento (cuando se emite) y, si está
* cobrado o pagado, otro por el movimiento de tesorería. Más el asiento de
* apertura, si se han dicho el capital y el saldo de bancos.
*
* `invoices` son los documentos guardados; se les puede añadir `party` con el
* nombre del proveedor o del comprador para que salga en el concepto.
*/
export function asientosDe(invoices, opts = {}) {
	const from = String(opts.from || "").slice(0, 10);
	const to = String(opts.to || "").slice(0, 10);
	const dentro = (day) => {
		const d = String(day || "").slice(0, 10);
		if (!d) return false;
		if (from && d < from) return false;
		if (to && d > to) return false;
		return true;
	};
	const out = [];
	const ap = opts.apertura;
	if (ap) {
		const capital = round2(Number(ap.capital) || 0);
		const tesoreria = round2(Number(ap.tesoreria) || 0);
		if (capital || tesoreria) {
			// La apertura entra siempre, aunque el periodo elegido empiece más
			// tarde: es la posición de partida y sin ella el balance no cuadra.
			const dia = String(ap.fecha || "").slice(0, 10) || from || `${new Date().getFullYear()}-01-01`;
			{
				const resto = round2(tesoreria - capital);
				const raw = [
					["572", tesoreria],
					["100", -capital],
					resto >= 0 ? ["113", -resto] : ["121", -resto]
				];
				const lines = lineas(raw);
				if (lines.length) {
					out.push({
						id: "apertura",
						date: dia || from,
						concept: "Asiento de apertura",
						ref: "",
						kind: "apertura",
						lines
					});
				}
			}
		}
	}
	for (const inv of invoices || []) {
		if (!inv) continue;
		const dia = String(inv.issueDate || inv.createdAt || "").slice(0, 10);
		if (!dentro(dia)) continue;
		const { base, igic, total } = importes(inv);
		if (!total) continue;
		const ingreso = directionOf(inv.kind) === "INGRESO";
		const cuentaDoc = cuentaDeDocumento(inv);
		const tercero = cuentaTercero(inv, ingreso);
		const numero = String(inv.number || "").trim();
		const quien = inv.party ? ` · ${String(inv.party)}` : "";
		const tipo = ingreso ? "Ingreso" : "Gasto";
		const concept = `${tipo}${numero ? ` ${numero}` : ""}${quien}`;
		const raw = ingreso ? [
			[cuentaDoc, base],
			["477", igic],
			[tercero, -total]
		] : [
			[cuentaDoc, base],
			["472", igic],
			[tercero, -total]
		];
		const lines = lineas(raw);
		if (!lines.length) continue;
		out.push({
			id: `${inv.id}:devengo`,
			date: dia,
			concept,
			ref: numero,
			kind: "devengo",
			docId: inv.id,
			lines
		});
		if (String(inv.status || "") === "PAGADO") {
			const diaPago = String(inv.paidDate || "").slice(0, 10) || dia;
			if (dentro(diaPago)) {
				const linesPago = lineas(ingreso ? [["572", total], [tercero, -total]] : [[tercero, total], ["572", -total]]);
				if (linesPago.length) {
					out.push({
						id: `${inv.id}:${ingreso ? "cobro" : "pago"}`,
						date: diaPago,
						concept: `${ingreso ? "Cobro" : "Pago"}${numero ? ` ${numero}` : ""}${quien}`,
						ref: numero,
						kind: ingreso ? "cobro" : "pago",
						docId: inv.id,
						lines: linesPago
					});
				}
			}
		}
	}
	// Asientos escritos a mano, que se mezclan con los demás por fecha.
	for (const m of opts.manuales || []) {
		if (!m) continue;
		const dia = String(m.date || "").slice(0, 10);
		if (!dentro(dia)) continue;
		const raw = [];
		for (const l of m.lineas || []) {
			const code = String(l && l.cuenta || "").trim();
			if (!/^\d{3,6}$/.test(code)) continue;
			const valor = round2((Number(l.debe) || 0) - (Number(l.haber) || 0));
			if (!valor) continue;
			raw.push([code, valor]);
		}
		const lines = lineas(raw);
		if (!lines.length) continue;
		const concepto = String(m.concept || "").trim() || "Asiento manual";
		out.push({
			id: String(m.id || `manual-${out.length + 1}`),
			date: dia,
			concept: concepto,
			ref: String(m.ref || "").trim(),
			kind: "manual",
			manual: true,
			lines
		});
	}
	out.sort((a, b) => {
		if (a.date !== b.date) return a.date < b.date ? -1 : 1;
		const oa = ORDEN[a.kind] == null ? 9 : ORDEN[a.kind];
		const ob = ORDEN[b.kind] == null ? 9 : ORDEN[b.kind];
		if (oa !== ob) return oa - ob;
		return a.concept.localeCompare(b.concept);
	});
	out.forEach((e, i) => {
		e.number = i + 1;
		e.total = totalLineas(e.lines);
	});
	return out;
}
/* ------------------------------------------------------------------ */
/* Libro mayor                                                        */
/* ------------------------------------------------------------------ */
/** Una fila por cuenta: lo que se ha movido y el saldo que queda. */
export function libroMayor(entries) {
	const map = new Map();
	for (const e of entries || []) {
		for (const l of e.lines || []) {
			let row = map.get(l.account);
			if (!row) {
				const c = cuenta(l.account);
				row = {
					code: l.account,
					name: c.name,
					balance: c.balance,
					pl: c.pl,
					debit: 0,
					credit: 0,
					moves: []
				};
				map.set(l.account, row);
			}
			row.debit = round2(row.debit + (l.debit || 0));
			row.credit = round2(row.credit + (l.credit || 0));
			row.moves.push({
				date: e.date,
				number: e.number,
				concept: e.concept,
				debit: l.debit || 0,
				credit: l.credit || 0,
				running: 0
			});
		}
	}
	const rows = [...map.values()];
	for (const r of rows) {
		let acc = 0;
		for (const m of r.moves) {
			acc = round2(acc + m.debit - m.credit);
			m.running = acc;
		}
		r.saldo = round2(r.debit - r.credit);
	}
	rows.sort((a, b) => a.code < b.code ? -1 : a.code > b.code ? 1 : 0);
	return rows;
}
/* ------------------------------------------------------------------ */
/* Balance de sumas y saldos                                          */
/* ------------------------------------------------------------------ */
/**
* Sumas y saldos: por cuenta, cuánto se ha movido al debe y al haber y el
* saldo que queda, deudor o acreedor. Las dos últimas columnas tienen que
* sumar lo mismo: si no, algo se ha quedado fuera.
*/
export function balanceSumasYSaldos(mayor) {
	const rows = (mayor || []).map((r) => ({
		code: r.code,
		name: r.name,
		debit: r.debit,
		credit: r.credit,
		deudor: r.saldo > .004 ? r.saldo : 0,
		acreedor: r.saldo < -.004 ? round2(-r.saldo) : 0
	}));
	const totals = rows.reduce((t, r) => ({
		debit: round2(t.debit + r.debit),
		credit: round2(t.credit + r.credit),
		deudor: round2(t.deudor + r.deudor),
		acreedor: round2(t.acreedor + r.acreedor)
	}), {
		debit: 0,
		credit: 0,
		deudor: 0,
		acreedor: 0
	});
	return {
		rows,
		totals,
		cuadra: Math.abs(totals.deudor - totals.acreedor) < .01
	};
}
/* ------------------------------------------------------------------ */
/* Cuenta de pérdidas y ganancias (modelo oficial)                    */
/* ------------------------------------------------------------------ */
export const LINEAS_RESULTADOS = Object.freeze([
	{
		key: "1",
		label: "1. Importe neto de la cifra de negocios"
	},
	{
		key: "2",
		label: "2. Variación de existencias de productos terminados y en curso de fabricación"
	},
	{
		key: "3",
		label: "3. Trabajos realizados por la empresa para su activo"
	},
	{
		key: "4",
		label: "4. Aprovisionamientos"
	},
	{
		key: "5",
		label: "5. Otros ingresos de explotación"
	},
	{
		key: "6",
		label: "6. Gastos de personal"
	},
	{
		key: "7",
		label: "7. Otros gastos de explotación"
	},
	{
		key: "8",
		label: "8. Amortización del inmovilizado"
	},
	{
		key: "9",
		label: "9. Imputación de subvenciones de inmovilizado no financiero y otras"
	},
	{
		key: "10",
		label: "10. Excesos de provisiones"
	},
	{
		key: "11",
		label: "11. Deterioro y resultado por enajenaciones del inmovilizado"
	},
	{
		key: "A",
		label: "A) RESULTADO DE EXPLOTACIÓN (1+2+3+4+5+6+7+8+9+10+11)",
		total: true
	},
	{
		key: "12",
		label: "12. Ingresos financieros"
	},
	{
		key: "13",
		label: "13. Gastos financieros"
	},
	{
		key: "14",
		label: "14. Variación de valor razonable en instrumentos financieros"
	},
	{
		key: "15",
		label: "15. Diferencias de cambio"
	},
	{
		key: "16",
		label: "16. Deterioro y resultado por enajenaciones de instrumentos financieros"
	},
	{
		key: "B",
		label: "B) RESULTADO FINANCIERO (12+13+14+15+16)",
		total: true
	},
	{
		key: "C",
		label: "C) RESULTADO ANTES DE IMPUESTOS (A + B)",
		total: true
	},
	{
		key: "17",
		label: "17. Impuestos sobre beneficios"
	},
	{
		key: "D",
		label: "D) RESULTADO DEL EJERCICIO (C + 17)",
		total: true
	}
]);
const EXPLOTACION = [
	"1",
	"2",
	"3",
	"4",
	"5",
	"6",
	"7",
	"8",
	"9",
	"10",
	"11"
];
const FINANCIERO = [
	"12",
	"13",
	"14",
	"15",
	"16"
];
/** El resultado del ejercicio: los ingresos menos los gastos del periodo. */
export function resultadoEjercicio(mayor) {
	let total = 0;
	for (const r of mayor || []) {
		const first = String(r.code).charAt(0);
		if (first === "6" || first === "7") total = round2(total - r.saldo);
	}
	return total;
}
/**
* La cuenta de pérdidas y ganancias con las líneas del modelo oficial.
* Los gastos salen en negativo y los ingresos en positivo, que es como se
* presenta en el Registro. Las líneas sin movimiento salen a cero.
*/
export function cuentaResultados(mayor) {
	const porClave = {};
	let sinClasificar = 0;
	for (const r of mayor || []) {
		const first = String(r.code).charAt(0);
		if (first !== "6" && first !== "7") continue;
		const value = round2(-r.saldo);
		const key = cuenta(r.code).pl;
		if (!key) {
			sinClasificar = round2(sinClasificar + value);
			continue;
		}
		porClave[key] = round2((porClave[key] || 0) + value);
	}
	const valor = (k) => round2(porClave[k] || 0);
	const explotacion = round2(EXPLOTACION.reduce((n, k) => n + valor(k), 0));
	const financiero = round2(FINANCIERO.reduce((n, k) => n + valor(k), 0));
	const antes = round2(explotacion + financiero);
	const impuesto = valor("17");
	const resultado = round2(antes + impuesto);
	const lines = LINEAS_RESULTADOS.map((l) => {
		let value = valor(l.key);
		if (l.key === "A") value = explotacion;
		else if (l.key === "B") value = financiero;
		else if (l.key === "C") value = antes;
		else if (l.key === "D") value = resultado;
		return {
			key: l.key,
			label: l.label,
			value,
			total: !!l.total
		};
	});
	return {
		lines,
		explotacion,
		financiero,
		antes,
		impuesto,
		resultado,
		sinClasificar
	};
}
/* ------------------------------------------------------------------ */
/* Balance de situación (modelo oficial)                              */
/* ------------------------------------------------------------------ */
/**
* Los epígrafes del balance, en el orden en que se presentan. `kind` manda en
* el dibujo: "head" es el bloque (A, B, C), "sub" un apartado (A-1…), "line"
* un epígrafe numerado y "total" una suma.
*/
export const EPIGRAFES = Object.freeze([
	{
		key: "AN",
		kind: "head",
		label: "A) ACTIVO NO CORRIENTE"
	},
	{
		key: "AN_I",
		kind: "line",
		label: "I. Inmovilizado intangible"
	},
	{
		key: "AN_II",
		kind: "line",
		label: "II. Inmovilizado material"
	},
	{
		key: "AN_III",
		kind: "line",
		label: "III. Inversiones inmobiliarias"
	},
	{
		key: "AN_IV",
		kind: "line",
		label: "IV. Inversiones en empresas del grupo y asociadas a largo plazo"
	},
	{
		key: "AN_V",
		kind: "line",
		label: "V. Inversiones financieras a largo plazo"
	},
	{
		key: "AN_VI",
		kind: "line",
		label: "VI. Activos por impuesto diferido"
	},
	{
		key: "AN_T",
		kind: "total",
		label: "TOTAL ACTIVO NO CORRIENTE (A)"
	},
	{
		key: "AC",
		kind: "head",
		label: "B) ACTIVO CORRIENTE"
	},
	{
		key: "AC_I",
		kind: "line",
		label: "I. Activos no corrientes mantenidos para la venta"
	},
	{
		key: "AC_II",
		kind: "line",
		label: "II. Existencias"
	},
	{
		key: "AC_III",
		kind: "line",
		label: "III. Deudores comerciales y otras cuentas a cobrar"
	},
	{
		key: "AC_IV",
		kind: "line",
		label: "IV. Inversiones en empresas del grupo y asociadas a corto plazo"
	},
	{
		key: "AC_V",
		kind: "line",
		label: "V. Inversiones financieras a corto plazo"
	},
	{
		key: "AC_VI",
		kind: "line",
		label: "VI. Periodificaciones a corto plazo"
	},
	{
		key: "AC_VII",
		kind: "line",
		label: "VII. Efectivo y otros activos líquidos equivalentes"
	},
	{
		key: "AC_T",
		kind: "total",
		label: "TOTAL ACTIVO CORRIENTE (B)"
	},
	{
		key: "ACTIVO",
		kind: "grand",
		label: "TOTAL ACTIVO (A + B)"
	},
	{
		key: "PN",
		kind: "head",
		label: "A) PATRIMONIO NETO"
	},
	{
		key: "PN_A1",
		kind: "sub",
		label: "A-1) Fondos propios"
	},
	{
		key: "PN_I",
		kind: "line",
		label: "I. Capital"
	},
	{
		key: "PN_II",
		kind: "line",
		label: "II. Prima de emisión"
	},
	{
		key: "PN_III",
		kind: "line",
		label: "III. Reservas"
	},
	{
		key: "PN_IV",
		kind: "line",
		label: "IV. (Acciones y participaciones en patrimonio propias)"
	},
	{
		key: "PN_V",
		kind: "line",
		label: "V. Resultados de ejercicios anteriores"
	},
	{
		key: "PN_VI",
		kind: "line",
		label: "VI. Otras aportaciones de socios"
	},
	{
		key: "PN_VII",
		kind: "line",
		label: "VII. Resultado del ejercicio"
	},
	{
		key: "PN_VIII",
		kind: "line",
		label: "VIII. (Dividendo a cuenta)"
	},
	{
		key: "PN_IX",
		kind: "line",
		label: "IX. Otros instrumentos de patrimonio neto"
	},
	{
		key: "PN_A1_T",
		kind: "total",
		label: "TOTAL FONDOS PROPIOS (A-1)"
	},
	{
		key: "PN_A2",
		kind: "sub",
		label: "A-2) Ajustes por cambios de valor"
	},
	{
		key: "PN_A2_I",
		kind: "line",
		label: "I. Activos financieros disponibles para la venta"
	},
	{
		key: "PN_A2_II",
		kind: "line",
		label: "II. Operaciones de cobertura"
	},
	{
		key: "PN_A2_III",
		kind: "line",
		label: "III. Otros"
	},
	{
		key: "PN_A2_T",
		kind: "total",
		label: "TOTAL AJUSTES POR CAMBIOS DE VALOR (A-2)"
	},
	{
		key: "PN_A3",
		kind: "line",
		label: "A-3) Subvenciones, donaciones y legados recibidos"
	},
	{
		key: "PN_T",
		kind: "total",
		label: "TOTAL PATRIMONIO NETO (A)"
	},
	{
		key: "PNC",
		kind: "head",
		label: "B) PASIVO NO CORRIENTE"
	},
	{
		key: "PNC_I",
		kind: "line",
		label: "I. Provisiones a largo plazo"
	},
	{
		key: "PNC_II",
		kind: "line",
		label: "II. Deudas a largo plazo"
	},
	{
		key: "PNC_III",
		kind: "line",
		label: "III. Deudas con empresas del grupo y asociadas a largo plazo"
	},
	{
		key: "PNC_IV",
		kind: "line",
		label: "IV. Pasivos por impuesto diferido"
	},
	{
		key: "PNC_V",
		kind: "line",
		label: "V. Periodificaciones a largo plazo"
	},
	{
		key: "PNC_T",
		kind: "total",
		label: "TOTAL PASIVO NO CORRIENTE (B)"
	},
	{
		key: "PC",
		kind: "head",
		label: "C) PASIVO CORRIENTE"
	},
	{
		key: "PC_I",
		kind: "line",
		label: "I. Pasivos vinculados con activos no corrientes mantenidos para la venta"
	},
	{
		key: "PC_II",
		kind: "line",
		label: "II. Provisiones a corto plazo"
	},
	{
		key: "PC_III",
		kind: "line",
		label: "III. Deudas a corto plazo"
	},
	{
		key: "PC_IV",
		kind: "line",
		label: "IV. Deudas con empresas del grupo y asociadas a corto plazo"
	},
	{
		key: "PC_V",
		kind: "line",
		label: "V. Acreedores comerciales y otras cuentas a pagar"
	},
	{
		key: "PC_VI",
		kind: "line",
		label: "VI. Periodificaciones a corto plazo"
	},
	{
		key: "PC_T",
		kind: "total",
		label: "TOTAL PASIVO CORRIENTE (C)"
	},
	{
		key: "PNYP",
		kind: "grand",
		label: "TOTAL PATRIMONIO NETO Y PASIVO (A + B + C)"
	}
]);
const SUMA_AN = [
	"AN_I",
	"AN_II",
	"AN_III",
	"AN_IV",
	"AN_V",
	"AN_VI"
];
const SUMA_AC = [
	"AC_I",
	"AC_II",
	"AC_III",
	"AC_IV",
	"AC_V",
	"AC_VI",
	"AC_VII"
];
const SUMA_FONDOS = [
	"PN_I",
	"PN_II",
	"PN_III",
	"PN_IV",
	"PN_V",
	"PN_VI",
	"PN_VII",
	"PN_VIII",
	"PN_IX"
];
const SUMA_AJUSTES = [
	"PN_A2_I",
	"PN_A2_II",
	"PN_A2_III"
];
const SUMA_PNC = [
	"PNC_I",
	"PNC_II",
	"PNC_III",
	"PNC_IV",
	"PNC_V"
];
const SUMA_PC = [
	"PC_I",
	"PC_II",
	"PC_III",
	"PC_IV",
	"PC_V",
	"PC_VI"
];
/**
* El balance de situación: cada cuenta al epígrafe que le toca y las sumas
* del modelo. El activo va por su saldo deudor y el patrimonio y el pasivo
* por el acreedor. Si el total del activo no coincide con el del patrimonio
* más el pasivo, se dice cuánto falta; no se inventa ninguna cifra.
*/
export function balanceSituacion(mayor, resultado) {
	const valores = {};
	for (const r of mayor || []) {
		const key = cuenta(r.code).balance;
		if (!key) continue;
		const activo = key.indexOf("AN_") === 0 || key.indexOf("AC_") === 0;
		const value = activo ? r.saldo : round2(-r.saldo);
		valores[key] = round2((valores[key] || 0) + value);
	}
	valores.PN_VII = round2(resultado || 0);
	const v = (k) => round2(valores[k] || 0);
	const suma = (keys) => round2(keys.reduce((n, k) => n + v(k), 0));
	valores.AN_T = suma(SUMA_AN);
	valores.AC_T = suma(SUMA_AC);
	valores.ACTIVO = round2(valores.AN_T + valores.AC_T);
	valores.PN_A1_T = suma(SUMA_FONDOS);
	valores.PN_A2_T = suma(SUMA_AJUSTES);
	valores.PN_T = round2(valores.PN_A1_T + valores.PN_A2_T + v("PN_A3"));
	valores.PNC_T = suma(SUMA_PNC);
	valores.PC_T = suma(SUMA_PC);
	valores.PNYP = round2(valores.PN_T + valores.PNC_T + valores.PC_T);
	const rows = EPIGRAFES.map((e) => ({
		key: e.key,
		kind: e.kind,
		label: e.label,
		value: v(e.key)
	}));
	const descuadre = round2(valores.ACTIVO - valores.PNYP);
	return {
		rows,
		totalActivo: valores.ACTIVO,
		totalPatrimonioYpasivo: valores.PNYP,
		descuadre,
		cuadra: Math.abs(descuadre) < .01
	};
}
/* ------------------------------------------------------------------ */
/* Todo junto                                                         */
/* ------------------------------------------------------------------ */
/**
* Arma los cuatro libros de una vez para un periodo. La pantalla solo pinta
* lo que necesita, pero así se comprueba que cuadran entre ellos.
*/
export function libros(invoices, opts = {}) {
	const entries = asientosDe(invoices, opts);
	const mayor = libroMayor(entries);
	const sumas = balanceSumasYSaldos(mayor);
	const pyg = cuentaResultados(mayor);
	const balance = balanceSituacion(mayor, pyg.resultado);
	return {
		entries,
		mayor,
		sumas,
		pyg,
		balance
	};
}
