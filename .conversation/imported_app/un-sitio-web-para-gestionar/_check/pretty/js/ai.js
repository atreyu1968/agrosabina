/*
* Clasificación automática de la documentación.
*
* Dos caminos:
*  1. Reglas (model.js): siempre, sin internet, sin enviar nada.
*  2. Una IA externa, si la persona la enciende en Ajustes y pone su clave.
*     En ese caso se envía SOLO el texto ya leído del documento (no la foto
*     ni el PDF, ni ningún otro dato de la empresa), y únicamente para que
*     diga de qué tipo es y en qué concepto encaja.
*
* Si la IA falla, se sigue con las reglas: el programa nunca se queda colgado.
*/
import { CATEGORIES, DOC_KINDS, categoryInfo, classifyLocal, kindInfo } from "./model.js";
import { nifKey, parseAmount } from "./util.js";
export const AI_DEFAULTS = Object.freeze({
	aiEnabled: false,
	aiEndpoint: "https://api.deepseek.com/v1",
	aiModel: "deepseek-chat",
	aiKey: ""
});
/*
* Servicios que se pueden elegir en Ajustes. Todos hablan el mismo idioma que
* OpenAI (`/chat/completions` con una clave Bearer), así que solo cambian la
* dirección y el nombre del modelo. DeepSeek es el más barato de los tres y
* lee bien los documentos en castellano; Groq es el más rápido.
*/
export const AI_PROVIDERS = Object.freeze([
	{
		id: "deepseek",
		label: "DeepSeek",
		endpoint: "https://api.deepseek.com/v1",
		model: "deepseek-chat",
		hint: "Barato y lee bien el castellano. La clave se saca en platform.deepseek.com."
	},
	{
		id: "openai",
		label: "OpenAI",
		endpoint: "https://api.openai.com/v1",
		model: "gpt-4o-mini",
		hint: "La clave se saca en platform.openai.com."
	},
	{
		id: "groq",
		label: "Groq",
		endpoint: "https://api.groq.com/openai/v1",
		model: "llama-3.3-70b-versatile",
		hint: "El más rápido. La clave se saca en console.groq.com."
	},
	{
		id: "otro",
		label: "Otro servicio compatible",
		endpoint: "",
		model: "",
		hint: "Cualquier servicio que hable el idioma de OpenAI, o una IA en tu propio ordenador."
	}
]);
/** Qué servicio de la lista corresponde a la dirección guardada. */
export function aiProviderOf(settings) {
	const ep = String(settings && settings.aiEndpoint || "").replace(/\/+$/, "").toLowerCase();
	return AI_PROVIDERS.find((p) => p.endpoint && p.endpoint.replace(/\/+$/, "").toLowerCase() === ep) || AI_PROVIDERS[AI_PROVIDERS.length - 1];
}
export function aiConfigured(settings) {
	return !!(settings && settings.aiEnabled && String(settings.aiKey || "").trim() && String(settings.aiEndpoint || "").trim());
}
function completionsUrl(endpoint) {
	const clean = String(endpoint || "").trim().replace(/\/+$/, "");
	if (!clean) return "";
	if (/\/chat\/completions$/.test(clean)) return clean;
	return `${clean}/chat/completions`;
}
function promptFor(text) {
	const kinds = DOC_KINDS.map((k) => `${k.id} (${k.label}, ${k.direction.toLowerCase()})`).join("; ");
	const cats = CATEGORIES.filter((c) => c.id).map((c) => `${c.id} (${c.label})`).join("; ");
	return [
		"Eres el auxiliar contable de Agrosabina SL, una empresa agrícola de las Islas Canarias.",
		"No emite facturas: recibe liquidaciones y pagos de fruta y subvenciones de la explotación,",
		"y paga agua, electricidad, laborales, servicios externos, fitosanitarios y abonos.",
		"",
		`Tipos de documento posibles: ${kinds}.`,
		`Conceptos posibles: ${cats}. Deja la categoría vacía si no lo tienes claro.`,
		"",
		"Devuelve SOLO un objeto JSON, sin explicaciones fuera del JSON, con esta forma:",
		"{\"tipo\":\"FACTURA\",\"categoria\":\"AGUA\",\"confianza\":0.8,\"motivo\":\"una frase corta\"}",
		"",
		"Texto del documento:",
		text
	].join("\n");
}
function parseJsonLoose(raw) {
	const s = String(raw || "").trim();
	if (!s) return null;
	try {
		return JSON.parse(s);
	} catch (_) {}
	const m = s.match(/\{[\s\S]*\}/);
	if (!m) return null;
	try {
		return JSON.parse(m[0]);
	} catch (_) {
		return null;
	}
}
function explainHttpError(status, body) {
	const detail = String(body || "").slice(0, 200).replace(/\s+/g, " ").trim();
	if (status === 401 || status === 403) return "La clave de la IA no es válida o no tiene permiso.";
	if (status === 429) return "La IA ha dicho que ahora no: demasiadas peticiones o sin saldo.";
	if (status === 404) return "Esa dirección de IA no existe. Revisa la dirección y el modelo.";
	if (status >= 500) return "La IA no está disponible en este momento.";
	return `La IA ha respondido con un error ${status}${detail ? `: ${detail}` : ""}.`;
}
/**
* Una llamada al servicio de IA. Devuelve el texto que contesta.
* Aquí está todo lo que puede salir mal, con mensajes en castellano.
*/
async function requestContent(settings, { system, user, timeoutMs = 2e4, temperature = 0 }) {
	const url = completionsUrl(settings.aiEndpoint);
	if (!url) throw new Error("Falta la dirección de la IA en los ajustes.");
	const body = {
		model: String(settings.aiModel || AI_DEFAULTS.aiModel),
		temperature,
		messages: [{
			role: "system",
			content: system
		}, {
			role: "user",
			content: user
		}]
	};
	const ctrl = typeof AbortController === "function" ? new AbortController() : null;
	const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
	let res;
	try {
		res = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${String(settings.aiKey || "").trim()}`
			},
			body: JSON.stringify(body),
			signal: ctrl ? ctrl.signal : undefined
		});
	} catch (err) {
		if (err && err.name === "AbortError") throw new Error("La IA ha tardado demasiado y lo he dejado estar.");
		throw new Error("No he podido llegar a la IA. ¿Hay conexión a internet?");
	} finally {
		if (timer) clearTimeout(timer);
	}
	const raw = await res.text().catch(() => "");
	if (!res.ok) throw new Error(explainHttpError(res.status, raw));
	try {
		const data = JSON.parse(raw);
		return data?.choices?.[0]?.message?.content || "";
	} catch (_) {
		throw new Error("La IA ha contestado algo que no entiendo.");
	}
}
/* ------------------------------------------------------------------ */
/* Interpretación de los datos de un documento                        */
/* ------------------------------------------------------------------ */
const EXTRACT_SYSTEM = "Eres un auxiliar contable que rellena fichas a partir del texto de un documento. " + "Contestas solo con un objeto JSON válido, sin nada alrededor. Nunca inventas un dato: si no está en el texto, pones null.";
function extractPrompt(text) {
	const kinds = DOC_KINDS.map((k) => `${k.id} (${k.label})`).join("; ");
	return [
		"Documento de una empresa agrícola de las Islas Canarias (IGIC, no IVA).",
		`Tipos posibles: ${kinds}.`,
		"",
		"Devuelve SOLO este JSON, con null en lo que no aparezca:",
		"{",
		"  \"tipo\": \"FACTURA\",",
		"  \"categoria\": \"AGUA\",",
		"  \"proveedor\": \"nombre o razón social\",",
		"  \"nif\": \"A12345678\",",
		"  \"numero\": \"número del documento\",",
		"  \"fecha\": \"AAAA-MM-DD\",",
		"  \"vencimiento\": \"AAAA-MM-DD\",",
		"  \"base\": 0, \"igic\": 0, \"total\": 0,",
		"  \"liquidacion\": {\"producto\": \"\", \"categoria\": \"\", \"kilos\": 0, \"precio\": 0,",
		"    \"descuentos\": [{\"concepto\": \"\", \"importe\": 0}], \"liquido\": 0},",
		"  \"motivo\": \"una frase corta de por qué\"",
		"}",
		"",
		"Reglas de los números (importante):",
		"- Importes en euros, con punto decimal: 1.234,56 € se escribe 1234.56.",
		"- Kilos en kilogramos: 4.520 kg se escribe 4520.",
		"- Precio por kilo en euros por kilo, con punto decimal: «0,853 €/kg» es 0.853, no 853.",
		"- Si el documento no es una liquidación de fruta, deja liquidacion en null.",
		"",
		"Texto del documento:",
		String(text || "").slice(0, 8e3)
	].join("\n");
}
function toNum(value) {
	if (typeof value === "number") return Number.isFinite(value) ? value : null;
	const raw = String(value == null ? "" : value).trim();
	if (!raw) return null;
	const m = raw.match(/-?\d+(?:[.,]\d+)*/);
	if (!m) return null;
	const n = parseAmount(m[0]);
	return Number.isFinite(n) ? n : null;
}
function asIsoDate(value) {
	const raw = String(value == null ? "" : value).trim();
	if (!raw) return "";
	if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
	const m = raw.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
	if (!m) return "";
	const year = m[3].length === 2 ? `20${m[3]}` : m[3];
	return `${year}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}
/**
* Pide a la IA que interprete el texto de un documento y devuelve los campos
* ya ordenados y comprobados. Lanza Error si no contesta o no se entiende.
*/
export async function aiExtract(text, settings, { timeoutMs = 3e4 } = {}) {
	const content = await requestContent(settings, {
		system: EXTRACT_SYSTEM,
		user: extractPrompt(text),
		timeoutMs,
		temperature: 0
	});
	const json = parseJsonLoose(content);
	if (!json || typeof json !== "object") throw new Error("La IA no ha devuelto los datos del documento.");
	const kind = DOC_KINDS.some((k) => k.id === String(json.tipo || "").toUpperCase()) ? String(json.tipo).toUpperCase() : "";
	const catRaw = String(json.categoria || "").toUpperCase().trim();
	const category = CATEGORIES.some((c) => c.id === catRaw) ? catRaw : "";
	let liquidacion = null;
	const liq = json.liquidacion;
	if (liq && typeof liq === "object") {
		const discounts = Array.isArray(liq.descuentos) ? liq.descuentos.map((d) => ({
			label: String(d && (d.concepto || d.label) || "Descuento").trim().slice(0, 60),
			amount: toNum(d && (d.importe != null ? d.importe : d.amount))
		})).filter((d) => d.amount != null && d.amount !== 0).slice(0, 12) : [];
		const kg = toNum(liq.kilos != null ? liq.kilos : liq.kg);
		const price = toNum(liq.precio != null ? liq.precio : liq.price);
		const net = toNum(liq.liquido != null ? liq.liquido : liq.net);
		if (kg != null || price != null || net != null) {
			liquidacion = {
				product: String(liq.producto || liq.product || "").trim().slice(0, 60),
				category: String(liq.categoria || liq.category || "").trim().slice(0, 40),
				kg: kg != null && kg >= 0 ? kg : null,
				price: price != null && price >= 0 && price < 100 ? price : null,
				discounts,
				net: net != null ? net : null
			};
		}
	}
	const conf = Number(json.confianza);
	return {
		kind,
		category,
		confidence: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : .6,
		why: String(json.motivo || "").slice(0, 220),
		supplierName: String(json.proveedor || "").trim().slice(0, 80),
		supplierNif: nifKey(json.nif || ""),
		number: String(json.numero || "").trim().slice(0, 40),
		issueDate: asIsoDate(json.fecha),
		dueDate: asIsoDate(json.vencimiento),
		base: toNum(json.base),
		igic: toNum(json.igic),
		total: toNum(json.total),
		liquidacion
	};
}
/** Comprobación rápida de la clave y la dirección desde Ajustes. */
export async function aiPing(settings) {
	const content = await requestContent(settings, {
		system: "Contestas en una sola línea.",
		user: "Responde solo con la palabra: GRACIAS",
		timeoutMs: 2e4,
		temperature: 0
	});
	const clean = String(content || "").trim().slice(0, 80);
	if (!clean) throw new Error("La IA ha contestado vacío.");
	return clean;
}
/**
* Pregunta a la IA de la persona. Lanza Error con un mensaje en castellano.
*/
export async function aiClassify(text, settings, { timeoutMs = 2e4 } = {}) {
	const content = await requestContent(settings, {
		system: "Contestas siempre con un objeto JSON válido y nada más.",
		user: promptFor(String(text || "").slice(0, 6e3)),
		timeoutMs,
		temperature: 0
	});
	const json = parseJsonLoose(content);
	if (!json) throw new Error("La IA no ha devuelto la ficha del documento.");
	const kind = DOC_KINDS.some((k) => k.id === String(json.tipo || "").toUpperCase()) ? String(json.tipo).toUpperCase() : "";
	const catRaw = String(json.categoria || "").toUpperCase().trim();
	const category = CATEGORIES.some((c) => c.id === catRaw) ? catRaw : "";
	if (!kind && !category) throw new Error("La IA no ha reconocido el documento.");
	const conf = Number(json.confianza);
	return {
		kind: kind || "",
		category,
		confidence: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : .6,
		why: String(json.motivo || "").slice(0, 220)
	};
}
/**
* La que se llama de verdad: reglas primero y, si está encendida, la IA.
* @returns {Promise<{kind:string, category:string, direction:string, source:string, why:string, note:string}>}
*/
export async function classifyDocument(text, settings, hints = {}) {
	const local = classifyLocal(text, hints);
	if (!aiConfigured(settings)) {
		return {
			...local,
			note: ""
		};
	}
	try {
		const ai = await aiClassify(text, settings);
		const kind = ai.kind || local.kind;
		const direction = DOC_KINDS.find((k) => k.id === kind)?.direction || local.direction;
		const category = ai.category || local.category;
		return {
			kind,
			category,
			direction,
			source: "ia",
			score: local.score,
			why: ai.why ? `La IA dice: ${ai.why}` : `La IA lo ha clasificado como ${kindInfo(kind).label.toLowerCase()}${category ? ` · ${categoryInfo(category).label}` : ""}.`,
			note: ""
		};
	} catch (err) {
		return {
			...local,
			note: `He clasificado con las reglas porque ${err && err.message || "la IA no ha contestado"}`
		};
	}
}
