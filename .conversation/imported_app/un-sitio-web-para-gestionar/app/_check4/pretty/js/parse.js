/*
* Lectura de una factura.
* Entra el texto (de un PDF o del OCR de una foto) y salen los datos ordenados.
* Todo son reglas pensadas para facturas españolas: no hay ningún servicio detrás.
*/
import { STATUS, completeAmounts, fold, fmtEUR, fmtNum, nifKey, parseAmount, round2, todayISO } from "./util.js";
/* ------------------------------------------------------------------ */
/* Números                                                             */
/* ------------------------------------------------------------------ */
/*
* Los lectores de fotos confunden letras con números (O por 0, l por 1, S por
* 5, B por 8). En los importes se corrigen sin peligro: el patrón exige
* decimales y un importe nunca lleva letras.
*/
function fixDigits(raw) {
	return String(raw || "").replace(/[OoQ]/g, "0").replace(/[Il|!]/g, "1").replace(/[Ss]/g, "5").replace(/[Bb]/g, "8");
}
const MONEY_2 = String.raw`\d{1,3}(?:[.\s]\d{3})*[.,][\dOoIlSsBb]{2}|\d{1,7}[.,][\dOoIlSsBb]{2}`;
const MONEY_ANY = String.raw`-?\d{1,3}(?:[.\s]\d{3})*(?:[.,]\d{1,2})?|-?\d+(?:[.,]\d{1,2})?`;
/** Todos los importes de un trozo de texto, con su posición. */
export function moneyIn(text) {
	const src = String(text || "");
	const out = [];
	let m;
	const re2 = new RegExp(MONEY_2, "g");
	while (m = re2.exec(src)) {
		const v = parseAmount(fixDigits(m[0]));
		if (v != null) out.push({
			value: v,
			raw: m[0],
			index: m.index
		});
	}
	if (out.length) return out;
	const reAny = new RegExp(MONEY_ANY, "g");
	while (m = reAny.exec(src)) {
		const after = src[m.index + m[0].length] || "";
		const before = src[m.index - 1] || "";
		if (after === "%" || after === "/" || before === "/" || before === "%") continue;
		const v = parseAmount(m[0]);
		if (v != null && Math.abs(v) > 0) out.push({
			value: v,
			raw: m[0],
			index: m.index
		});
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
	enero: 1,
	febrero: 2,
	marzo: 3,
	abril: 4,
	mayo: 5,
	junio: 6,
	julio: 7,
	agosto: 8,
	septiembre: 9,
	setiembre: 9,
	octubre: 10,
	noviembre: 11,
	diciembre: 12,
	// Abreviaturas que aparecen en las facturas: «14-nov-2024».
	ene: 1,
	feb: 2,
	mar: 3,
	abr: 4,
	may: 5,
	jun: 6,
	jul: 7,
	ago: 8,
	sep: 9,
	sept: 9,
	set: 9,
	oct: 10,
	nov: 11,
	dic: 12
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
	while (m = reNum.exec(src)) {
		let y = m[3];
		if (y.length === 2) y = String(Number(y) < 70 ? 2e3 + Number(y) : 1900 + Number(y));
		const iso = isoFrom(y, m[2], m[1]);
		if (iso) found.push(iso);
	}
	// aaaa-mm-dd
	const reIso = /\b(\d{4})[/.\-](\d{1,2})[/.\-](\d{1,2})\b/g;
	while (m = reIso.exec(src)) {
		const iso = isoFrom(m[1], m[2], m[3]);
		if (iso) found.push(iso);
	}
	// «12 de marzo de 2024» / «12 marzo 2024»
	const reText = /\b(\d{1,2})\s*(?:de\s+)?([a-záéíóúñ]+)\s*(?:de\s+)?(\d{4})\b/gi;
	while (m = reText.exec(src)) {
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
	"cliente",
	"facturar a",
	"facturado a",
	"destinatario",
	"receptor",
	"datos del cliente",
	"nombre del cliente",
	"a la atencion de",
	"a la atención de"
];
const SUPPLIER_WORDS = [
	"proveedor",
	"emisor",
	"vendedor",
	"expedidor",
	"datos del emisor"
];
const NOISE_WORDS = [
	"factura",
	"facturas",
	"fra.",
	"fra ",
	"fecha",
	"cif",
	"nif",
	"n.i.f",
	"c.i.f",
	"telefono",
	"teléfono",
	"tel.",
	"movil",
	"móvil",
	"email",
	"e-mail",
	"correo",
	"calle",
	"avda",
	"avenida",
	"c/",
	"plaza",
	"poligono",
	"polígono",
	"cp ",
	"c.p.",
	"codigo postal",
	"código postal",
	"www",
	"http",
	"@",
	"pedido",
	"albaran",
	"albarán",
	"cliente",
	"total",
	"base",
	"igic",
	"iva",
	"forma de pago",
	"vencimiento",
	"domicilio",
	"iban",
	"banco",
	"tel",
	"fax",
	"pagina",
	"página",
	"ref.",
	"referencia"
];
const LEGAL_SUFFIX = /\b(s\.?\s?l\.?\s?u?\.?|s\.?\s?a\.?\s?u?\.?|s\.?\s?c\.?\s?c\.?\s?l?\.?|s\.?\s?coop\.?|c\.?\s?b\.?|s\.?\s?r\.?\s?l\.?|sociedad|limitada|hermanos|eirl)\b/i;
function looksLikeName(line) {
	const t = String(line || "").trim();
	if (t.length < 3 || t.length > 70) return false;
	const low = fold(t);
	if (!/[a-z]/.test(low)) return false;
	if (NOISE_WORDS.some((w) => low.includes(fold(w)))) return false;
	if (/\d{4,}/.test(t)) return false;
	if (/^[\d\s.,\-\/]+$/.test(t)) return false;
	return true;
}
function cleanName(name) {
	return String(name || "").replace(/^(?:proveedor|emisor|vendedor|raz[oó]n social|nombre|empresa|datos del emisor)\s*[:\-]?\s*/i, "").replace(/\s*[-–|,;]\s*(?:c\.?i\.?f\.?|n\.?i\.?f\.?)?\s*[A-Z]?\d{7,8}\s?[0-9A-Z]?\s*$/i, "").replace(/[\s.,;:\-–]+$/, "").replace(/\s{2,}/g, " ").trim();
}
function findNifs(lines) {
	const hits = [];
	lines.forEach((line, i) => {
		NIF_RE.lastIndex = 0;
		let m;
		while (m = NIF_RE.exec(line)) {
			const raw = (m[1] || m[2] || "").trim();
			const key = nifKey(raw);
			if (key.length < 9) continue;
			hits.push({
				nif: raw.replace(/\s/g, ""),
				key,
				line: i
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
		candidates.push({
			name: cleanName(raw),
			score,
			i
		});
	}
	candidates.sort((a, b) => b.score - a.score || a.i - b.i);
	const best = candidates[0];
	return best && best.name.length >= 3 ? best.name : null;
}
/* ------------------------------------------------------------------ */
/* Número de factura                                                  */
/* ------------------------------------------------------------------ */
const NUMBER_LABELS = /(?:n[úu]m(?:ero)?\.?\s*(?:de\s*)?factura|n[º°o]\.?\s*(?:de\s*)?factura|factura\s*(?:n[º°o]\.?|n[úu]m\.?|n[úu]mero)?|fra\.?\s*(?:n[º°o]\.?)?|invoice\s*(?:no\.?|number)?|referencia\s*factura|doc(?:umento)?\.?\s*n[º°o]?\.?)\s*[:\-–]?\s*/i;
function looksLikeDocNumber(token) {
	const t = String(token || "").trim();
	if (t.length < 2 || t.length > 26) return false;
	if (!/[0-9]/.test(t)) return false;
	if (/^\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}$/.test(t)) return false;
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
				candidates.push({
					value: cleaned,
					score: 5 + bonus - i * .05,
					i
				});
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
			while (m = re.exec(line)) {
				if (looksLikeDocNumber(m[1])) candidates.push({
					value: m[1],
					score: 2 - i * .05,
					i
				});
			}
		});
	}
	candidates.sort((a, b) => b.score - a.score || a.i - b.i);
	return candidates.length ? candidates[0].value : null;
}
/* ------------------------------------------------------------------ */
/* Importes                                                           */
/* ------------------------------------------------------------------ */
const BASE_LABEL = /(?:base\s*imponible|base\s*impon\.?|base\s*gravable|base\s*de\s*la\s*factura|importe\s*neto|importe\s*sin\s*(?:igic|iva)|base\s*a\s*la\s*que|sub\s*total|subtotal)\s*(?:\([^)]*\)|[:.\s])*/i;
const TOTAL_LABEL = /(?:importe\s*(?:total|factura|a\s*pagar)|total\s*(?:de\s*la\s*)?factura|total\s*(?:a\s*)?(?:pagar|abonar|cobrar)|total\s*general|total\s*eur|total\s*€|total)\s*(?:\([^)]*\)|[:.\s])*/i;
const CUOTA_LABEL = /(?:cuota\s*(?:de\s*)?(?:igic|iva)|cuota\s*(?:igic|iva)|igic\s*repercutido|iva\s*repercutido|igic)\s*(?:\([^)]*\)|[:.\s])*/i;
/** «I.G.I.C.» y «I.V.A.» escritos con puntos: se juntan para poder buscarlos. */
function normLabels(line) {
	return String(line || "").replace(/\bi\s*\.?\s*g\s*\.?\s*i\s*\.?\s*c\s*\.?/gi, "igic").replace(/\bi\s*\.?\s*v\s*\.?\s*a\s*\.?/gi, "iva").replace(/\bimpuesto\s+general\s+indirecto\s+(?:de\s+)?canarias\b/gi, "igic");
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
		const rateMatch = /(?:igic|iva|impuesto)\D{0,24}?(\d{1,2}(?:[.,]\d{1,2})?)\s*%/i.exec(line) || /(\d{1,2}(?:[.,]\d{1,2})?)\s*%\s*(?:de\s*)?(?:igic|iva)/i.exec(line);
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
	if (igic != null && base != null && Math.abs(igic - base) < .011) igic = null;
	if (igic != null && total != null && Math.abs(igic - total) < .011) igic = null;
	return {
		base,
		total,
		igic,
		rate
	};
}
/* ------------------------------------------------------------------ */
/* Estado                                                             */
/* ------------------------------------------------------------------ */
function readStatus(text) {
	const low = fold(text);
	const pending = /\b(pendiente|a pagar|por pagar|no pagad|sin pagar|vencid|impagad|deuda)\b/.test(low);
	const paid = /\b(pagad[oa]|abonad[oa]|cobrad[oa]|recibo|transferencia realizada|liquidada)\b/.test(low);
	if (paid && !pending) return {
		status: STATUS.PAID,
		note: null
	};
	if (pending && !paid) return {
		status: STATUS.PENDING,
		note: null
	};
	if (paid && pending) {
		return {
			status: STATUS.PENDING,
			note: "El documento habla de pago y de pendiente a la vez. La he dejado como pendiente."
		};
	}
	return {
		status: STATUS.PENDING,
		note: null
	};
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
	const lines = text.split("\n").map((l) => l.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trimEnd());
	const nonEmpty = lines.filter((l) => l.trim().length > 0);
	const flat = nonEmpty.join("\n");
	const notes = [];
	const today = options.today || todayISO();
	/* --- proveedor --- */
	const nifs = findNifs(lines);
	const customerLines = new Set();
	lines.forEach((line, i) => {
		const low = fold(line);
		if (CUSTOMER_WORDS.some((w) => low.includes(fold(w)))) {
			for (let k = i; k <= i + 2 && k < lines.length; k++) customerLines.add(k);
		}
	});
	const supplierNifHit = nifs.find((h) => !customerLines.has(h.line) && SUPPLIER_WORDS.some((w) => fold(lines[h.line]).includes(fold(w)))) || nifs.find((h) => !customerLines.has(h.line)) || null;
	const customerNif = nifs.find((h) => customerLines.has(h.line)) || null;
	const supplierNif = supplierNifHit && supplierNifHit !== customerNif ? supplierNifHit.nif : null;
	let supplierName = pickSupplierName(lines, supplierNifHit ? supplierNifHit.line : null);
	if (!supplierName && options.fileName) {
		const guess = String(options.fileName).replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").replace(/\b(factura|invoice|scan|img|foto|pdf)\b/gi, "").replace(/\d{2,}/g, "").replace(/\s{2,}/g, " ").trim();
		if (guess.length >= 3) supplierName = guess;
	}
	if (!supplierNif) notes.push("No he visto el NIF del proveedor. Búscalo en la factura y escríbelo.");
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
	const complete = completeAmounts({
		base: raw.base,
		rate: raw.rate ?? (raw.igic != null || raw.base != null || raw.total != null ? options.defaultRate ?? null : null),
		igic: raw.igic,
		total: raw.total
	});
	if (complete.total == null) notes.push("No he encontrado el total. Escribelo tú y el IGIC se calcula solo.");
	if (complete.base == null && complete.total != null) notes.push("No he encontrado la base imponible; la he calculado.");
	if (complete.rate == null) notes.push("No he visto el tipo de IGIC: he puesto el que tengas por defecto.");
	const balanced = complete.base != null && complete.igic != null && complete.total != null ? Math.abs(round2(complete.base + complete.igic) - round2(complete.total)) <= .05 : true;
	if (!balanced) {
		notes.push(`Los importes no cuadran del todo: base + IGIC no da el total (${(complete.base + complete.igic).toFixed(2)} frente a ${complete.total.toFixed(2)}).`);
	}
	/* --- estado --- */
	const st = readStatus(flat);
	if (st.note) notes.push(st.note);
	/* --- confianza --- */
	let score = 0;
	if (supplierName) score += .22;
	if (supplierNif) score += .22;
	if (number) score += .16;
	if (issueDate) score += .12;
	if (complete.total != null && !complete.derived.includes("total")) score += .2;
	if (raw.rate != null) score += .05;
	if (raw.base != null) score += .03;
	if (balanced) score += .06;
	const confidence = Math.max(0, Math.min(1, score));
	return {
		supplierName: supplierName || "",
		supplierNif: supplierNif || "",
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
		notes,
		rawText: flat.slice(0, 6e3)
	};
}
/** ¿Parece una factura? Sirve para avisar cuando se cuela otro documento. */
export function looksLikeInvoice(text) {
	const low = fold(text);
	const hits = [
		/factura/,
		/total/,
		/base imponible/,
		/igic|iva/,
		/\d{1,3}[.,]\d{2}/,
		/cif|nif/
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
const RE_LIQ_KG = /(?:kilos?|kgs?\.?|kilogramos?|peso\s*(?:neto|bruto|total)|netos?|cantidad(?:\s*entregada)?|entregad[oa]s?|total\s*(?:de\s*)?kilos)/i;
const RE_LIQ_PRICE = /(?:precio\s*(?:de\s*)?(?:\/\s*kgs?|por\s*kgs?|kilo|unidad|unitario|medio|compra)?|p\.?\s?v\.?\s?p\.?|a\s*raz[óo]n\s*de)/i;
const RE_LIQ_EURKG = /(?:€|euros?|eur)\s*(?:\/|por|la)?\s*(?:kgs?|kilos?|kilogramos?)/i;
const RE_LIQ_GROSS = /(?:importe\s*bruto|total\s*bruto|bruto|valor\s*(?:de\s*la\s*)?(?:fruta|mercanc[íi]a))/i;
const RE_LIQ_NET = /(?:l[íi]quido\s*(?:a\s*percibir|total|neto)?|total\s*l[íi]quido|neto\s*a\s*percibir|a\s*percibir|l[íi]quido|total\s*(?:a\s*)?(?:percibir|cobrar))/i;
const RE_LIQ_DTO = /(descuento|deducci|gasto|retenci|manipulaci|envase|comisi|transport|flete|anticipo|merma|c[aá]non|seguro|calibre|cuota|limpieza|confecci|palet|descarga)/i;
const LIQ_FRUITS = [
	["platano", "Plátano"],
	["aguacate", "Aguacate"],
	["tomate", "Tomate"],
	["mango", "Mango"],
	["papaya", "Papaya"],
	["pepino", "Pepino"],
	["calabacin", "Calabacín"],
	["naranja", "Naranja"],
	["mandarina", "Mandarina"],
	["limon", "Limón"],
	["uva", "Uva"],
	["melon", "Melón"],
	["sandia", "Sandía"],
	["pina", "Piña"],
	["chirimoya", "Chirimoya"],
	["granadilla", "Granadilla"],
	["higo", "Higo"],
	["pimiento", "Pimiento"],
	["judia", "Judía"],
	["batata", "Batata"],
	["boniato", "Boniato"],
	["aguacates", "Aguacate"]
];
const LIQ_CATEGORIES = [
	"Extra",
	"Primera",
	"Segunda",
	"Tercera",
	"Destrío"
];
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
/** El primer número que hay después de una etiqueta. */
function numAfter(text, labelRe) {
	const look = new RegExp(`(?:${labelRe.source})[^0-9%\\-]{0,40}?(${LIQ_NUM})`, "i");
	const m = look.exec(text);
	return m ? m[1] : null;
}
/** El número que hay justo antes de una unidad o etiqueta. */
function numBefore(text, labelRe) {
	const look = new RegExp(`(${LIQ_NUM})\\s*(?:${labelRe.source})`, "i");
	const m = look.exec(text);
	return m ? m[1] : null;
}
/** Un nombre para la persona («plátano» → «Plátano»). */
function properCase(word) {
	const w = String(word || "").trim();
	if (!w) return "";
	return w.charAt(0).toUpperCase() + w.slice(1);
}
function liquidacionProduct(text) {
	const labelled = new RegExp(`(?:producto|art[íi]culo|mercanc[íi]a|variedad|fruta)\\s*[:\\-]?\\s*([A-Za-zÁÉÍÓÚÜÑáéíóúüñ ]{3,32})`, "i").exec(text);
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
/** Una línea con kilos, precio e importe que cuadra (kilos × precio ≈ importe). */
function liquidacionFromTable(text) {
	for (const line of String(text || "").split(/\r?\n/)) {
		const nums = line.match(new RegExp(LIQ_NUM, "g")) || [];
		if (nums.length !== 3) continue;
		const kg = parseKg(nums[0]);
		const price = parsePrice(nums[1]);
		const gross = parseAmount(nums[2]);
		if (!(kg > 0 && price > 0 && gross > 0)) continue;
		if (price > 100) continue;
		if (Math.abs(kg * price - gross) / gross <= .02) return {
			kg,
			price,
			gross
		};
	}
	return null;
}
/** Los descuentos, uno por línea, con su nombre y su importe. */
function liquidacionDiscounts(text) {
	const rows = [];
	for (const line of String(text || "").split(/\r?\n| · /)) {
		if (!line.trim() || !RE_LIQ_DTO.test(line)) continue;
		if (RE_LIQ_GROSS.test(line) || RE_LIQ_NET.test(line)) continue;
		if (/%/.test(line) && !/€|eur/i.test(line)) continue;
		const nums = line.match(new RegExp(LIQ_NUM, "g")) || [];
		if (!nums.length) continue;
		const amount = Math.abs(parseAmount(nums[nums.length - 1]) ?? 0);
		if (!amount) continue;
		let label = line.replace(/[-\d.,:;€%]/g, " ").replace(/\s+/g, " ").trim().slice(0, 48);
		if (!label) label = "Descuento";
		rows.push({
			label: properCase(label),
			amount: round2(amount),
			bare: /^(descuentos?|deducciones?|gastos?)$/i.test(label)
		});
		if (rows.length >= 8) break;
	}
	// Si además aparecen las líneas de detalle, el renglón «Descuentos 322,44»
	// es el total: sobra.
	if (rows.length > 1) return rows.filter((r) => !r.bare).map(({ label, amount }) => ({
		label,
		amount
	}));
	return rows.map(({ label, amount }) => ({
		label,
		amount
	}));
}
/**
* Lee una liquidación de fruta del texto ya extraído (de un PDF o del OCR).
* No decide nada: devuelve lo que ha entendido y avisa cuando los números del
* papel no cuadran, para que la persona lo mire antes de guardar.
*/
export function parseLiquidacion(rawText) {
	const text = String(rawText == null ? "" : rawText).replace(/\u00a0/g, " ");
	const out = {
		product: "",
		category: "",
		kg: null,
		price: null,
		gross: null,
		discounts: [],
		net: null,
		ok: false,
		notes: []
	};
	if (!text.trim()) return out;
	out.product = liquidacionProduct(text);
	out.category = liquidacionCategory(text);
	let kg = parseKg(numAfter(text, RE_LIQ_KG) || numBefore(text, /(?:kgs?\.?|kilos?|kilogramos?)/i));
	let price = parsePrice(numBefore(text, RE_LIQ_EURKG) || numAfter(text, RE_LIQ_PRICE));
	let gross = parseAmount(numAfter(text, RE_LIQ_GROSS));
	let net = parseAmount(numAfter(text, RE_LIQ_NET));
	// La etiqueta «precio» a veces se lleva por delante un total.
	if (price != null && price > 100) {
		const candidate = round2(price);
		if (net != null && Math.abs(Math.abs(net) - candidate) < .02) net = null;
		else if (gross != null && Math.abs(Math.abs(gross) - candidate) < .02) gross = null;
		out.notes.push(`El precio que he leído (${fmtNum(candidate, 2)} €/kg) no puede ser el de un kilo de fruta: míralo.`);
		price = null;
	}
	// Si falta algo, se prueba la línea de la tabla que cuadra.
	if (kg == null || price == null || gross == null) {
		const t = liquidacionFromTable(text);
		if (t) {
			if (kg == null) kg = t.kg;
			if (price == null) price = t.price;
			if (gross == null) gross = t.gross;
			out.notes.push("He sacado los kilos y el precio de la línea que cuadra (kilos × precio = importe).");
		}
	}
	out.discounts = liquidacionDiscounts(text);
	const dto = round2(out.discounts.reduce((a, d) => a + d.amount, 0));
	if (kg != null && price != null) {
		const calc = round2(kg * price);
		if (gross == null) {
			gross = calc;
		} else if (Math.abs(calc - gross) > Math.max(1, gross * .02)) {
			out.notes.push(`No cuadra: ${fmtNum(kg, 2)} kg × ${fmtNum(price, 3)} €/kg son ${fmtEUR(calc)}, y el bruto del papel es ${fmtEUR(gross)}. Revísalo.`);
		}
	}
	if (net == null) {
		if (gross != null) net = round2(gross - dto);
	} else if (gross != null && dto) {
		const calc = round2(gross - dto);
		if (Math.abs(calc - net) > Math.max(1, Math.abs(net) * .02)) {
			out.notes.push(`No cuadra: bruto menos descuentos son ${fmtEUR(calc)}, y el líquido del papel dice ${fmtEUR(net)}. Revísalo.`);
		}
	}
	out.kg = kg != null && kg > 0 ? kg : null;
	out.price = price != null && price > 0 ? price : null;
	out.gross = gross;
	out.net = net;
	out.ok = out.kg != null && out.price != null;
	if (!out.ok) {
		out.notes.push("No he sabido leer los kilos o el precio por kilo de esta liquidación. Escríbelos a mano antes de guardar.");
	}
	return out;
}
