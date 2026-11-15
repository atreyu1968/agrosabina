/*
 * Qué documentos lleva una empresa agrícola y cómo se ordenan solos.
 *
 * Agrosabina SL no emite facturas: recibe liquidaciones y pagos de fruta y
 * subvenciones. Por eso cada documento tiene un «sentido»: INGRESO o GASTO,
 * que se deduce del tipo de documento.
 *
 * `classifyLocal` es el clasificador de reglas: mira el texto ya leído de la
 * factura y busca palabras conocidas (agua, Endesa, nómina, glifosato…). Es
 * el que funciona siempre, sin internet y sin enviar nada a ningún sitio.
 */

export const DIRECTIONS = Object.freeze({ IN: "INGRESO", OUT: "GASTO" });

/** Tipos de documento que entran en el programa. */
export const DOC_KINDS = Object.freeze([
  { id: "FACTURA", label: "Factura recibida", short: "Factura", direction: DIRECTIONS.OUT },
  { id: "LIQUIDACION", label: "Liquidación de fruta", short: "Liquidación", direction: DIRECTIONS.IN },
  { id: "SUBVENCION", label: "Subvención o ayuda", short: "Subvención", direction: DIRECTIONS.IN },
  { id: "COBRO", label: "Cobro o abono recibido", short: "Cobro", direction: DIRECTIONS.IN },
  { id: "NOMINA", label: "Nómina o coste laboral", short: "Laboral", direction: DIRECTIONS.OUT },
  { id: "OTRO", label: "Otro documento", short: "Otro", direction: DIRECTIONS.OUT },
]);

/** Conceptos de gasto e ingreso habituales en una explotación agrícola. */
export const CATEGORIES = Object.freeze([
  { id: "", label: "Sin clasificar", direction: "" },
  { id: "AGUA", label: "Agua y riego", direction: DIRECTIONS.OUT },
  { id: "ELECTRICIDAD", label: "Electricidad", direction: DIRECTIONS.OUT },
  { id: "LABORALES", label: "Laborales y Seguridad Social", direction: DIRECTIONS.OUT },
  { id: "SERVICIOS", label: "Servicios externos", direction: DIRECTIONS.OUT },
  { id: "FITOSANITARIOS", label: "Fitosanitarios", direction: DIRECTIONS.OUT },
  { id: "ABONOS", label: "Abonos y fertilizantes", direction: DIRECTIONS.OUT },
  { id: "COMBUSTIBLE", label: "Combustible y carburantes", direction: DIRECTIONS.OUT },
  { id: "IMPUESTOS", label: "Impuestos y tasas", direction: DIRECTIONS.OUT },
  { id: "FRUTA", label: "Fruta (liquidaciones y pagos)", direction: DIRECTIONS.IN },
  { id: "SUBVENCIONES", label: "Subvenciones y ayudas", direction: DIRECTIONS.IN },
  { id: "OTROS", label: "Otros", direction: "" },
]);

export function kindInfo(id) {
  return DOC_KINDS.find((k) => k.id === id) || DOC_KINDS[0];
}

export function categoryInfo(id) {
  return CATEGORIES.find((c) => c.id === id) || CATEGORIES[0];
}

/** El sentido (ingreso o gasto) lo manda el tipo de documento. */
export function directionOf(kindId, fallback = DIRECTIONS.OUT) {
  const k = DOC_KINDS.find((x) => x.id === kindId);
  return k ? k.direction : fallback;
}

/** Tipos para un <select>, con el sentido bien claro. */
export function kindOptions(current) {
  return DOC_KINDS.map(
    (k) =>
      `<option value="${k.id}" ${k.id === current ? "selected" : ""}>${k.label} (${
        k.direction === DIRECTIONS.IN ? "ingreso" : "gasto"
      })</option>`
  ).join("");
}

/** Categorías para un <select>, filtradas por sentido. */
export function categoryOptions(current, direction) {
  const list = CATEGORIES.filter((c) => !c.direction || !direction || c.direction === direction);
  return list
    .map((c) => `<option value="${c.id}" ${c.id === (current || "") ? "selected" : ""}>${c.label}</option>`)
    .join("");
}

/* ------------------------------------------------------------------ */
/* Clasificador de reglas                                             */
/* ------------------------------------------------------------------ */

function fold(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

/** Palabras que delatan un tipo de documento. [palabra, peso] */
const KIND_WORDS = {
  SUBVENCION: [
    ["subvencion", 3], ["subvenciones", 3], ["ayuda", 2], ["ayudas", 2],
    ["feader", 3], ["feaga", 3], ["foga", 3], ["fega", 2],
    ["pago unico", 3], ["pac ", 1], ["consejeria de agricultura", 3],
    ["resolucion de concesion", 3], ["beneficiario", 2], ["expediente", 1],
    ["ganaderia", 1], ["incorporacion de jovenes", 2],
  ],
  LIQUIDACION: [
    ["liquidacion", 3], ["liquidacion de fruta", 4], ["alhondiga", 3],
    ["cooperativa", 3], ["entrega de fruta", 4], ["entrega de producto", 3],
    ["kilos", 2], ["calibre", 2], ["categoria comercial", 2],
    ["precio kg", 3], ["precio/kilo", 3], ["platano", 2], ["tomate", 2],
    ["aguacate", 2], ["mango", 2], ["papaya", 2], ["cosecha", 2],
    ["productor", 2], ["agricultor", 1], ["campana", 1], ["merma", 2],
    ["caja", 1], ["palet", 1],
  ],
  NOMINA: [
    ["nomina", 3], ["nominas", 3], ["seguridad social", 3], ["tgss", 3],
    ["tesoreria general de la seguridad social", 3], ["finiquito", 3],
    ["contrato de trabajo", 3], ["salario", 3], ["salarios", 3],
    ["nomina y seguro", 2], ["rete", 1], ["irpf", 2], ["trabajador", 1],
  ],
  COBRO: [
    ["justificante de transferencia", 3], ["abono recibido", 3],
    ["cobro recibido", 3], ["pago recibido", 2], ["adeudo", 2],
    ["recibo bancario", 2], ["transferencia realizada a su favor", 3],
  ],
  FACTURA: [
    ["factura", 3], ["fra.", 2], ["numero de factura", 4], ["nº factura", 4],
    ["base imponible", 3], ["cuota", 2], ["igic", 2], ["iva", 1],
    ["vencimiento", 2], ["cif", 1], ["forma de pago", 2],
  ],
};

/** Palabras que delatan el concepto. [palabra, peso] */
const CATEGORY_WORDS = {
  AGUA: [
    ["agua", 2], ["canaragua", 4], ["emmasa", 4], ["canal de aguas", 3],
    ["aguas de", 3], ["consejo insular de aguas", 4], ["comunidad de aguas", 4],
    ["riego", 3], ["regadio", 3], ["pozo", 2], ["desaladora", 3],
    ["metro cubico", 3], ["m3", 1], ["suministro de agua", 4],
  ],
  ELECTRICIDAD: [
    ["electricidad", 4], ["electrico", 2], ["endesa", 4], ["iberdrola", 4],
    ["naturgy", 4], ["e-distribucion", 4], ["viesgo", 4], ["hidroelectrica", 3],
    ["kwh", 3], ["potencia contratada", 4], ["energia", 3], ["luz", 2],
    ["autoconsumo", 2], ["placas solares", 3],
  ],
  LABORALES: [
    ["nomina", 4], ["nominas", 4], ["seguridad social", 4], ["tgss", 4],
    ["finiquito", 4], ["salario", 3], ["salarios", 3], ["laboral", 3],
    ["sueldo", 3], ["indemnizacion", 3], ["horas extra", 3],
  ],
  SERVICIOS: [
    ["asesoria", 3], ["gestoria", 3], ["gestor", 2], ["contabilidad", 3],
    ["reparacion", 3], ["taller", 3], ["transporte", 3], ["notaria", 3],
    ["abogado", 3], ["seguro", 3], ["poliza", 3], ["telefono", 2],
    ["movistar", 3], ["telefonica", 3], ["internet", 2], ["alquiler", 2],
    ["recambios", 2], ["mantenimiento", 2], ["analisis de suelo", 3],
  ],
  FITOSANITARIOS: [
    ["fitosanitario", 4], ["fitosanitarios", 4], ["herbicida", 4],
    ["insecticida", 4], ["fungicida", 4], ["plaguicida", 4],
    ["glifosato", 4], ["abamectina", 4], ["organofosforado", 4],
    ["tratamiento fitosanitario", 4], ["azufre", 2], ["cobre", 2],
    ["bacillus", 3], ["aceite parafinico", 3], ["fitosanit", 4],
  ],
  ABONOS: [
    ["abono", 3], ["abonos", 3], ["fertilizante", 4], ["fertilizantes", 4],
    ["nitrato", 3], ["nitrogeno", 3], ["fosfato", 3], ["potasio", 3],
    ["urea", 3], ["sulfato amonico", 4], ["estiércol", 3], ["estiércol", 3],
    ["compost", 3], ["bioestimulante", 3], ["enmienda organica", 3],
    ["correctores de carencias", 3],
  ],
  COMBUSTIBLE: [
    ["gasoil", 4], ["gasoleo", 4], ["diesel", 4], ["carburante", 4],
    ["combustible", 4], ["repsol", 4], ["cepsa", 4], ["disa", 3],
    ["gasolinera", 4], ["estacion de servicio", 4], ["adblue", 3],
    ["gasolina", 4],
  ],
  IMPUESTOS: [
    ["hacienda", 3], ["tributaria", 3], ["impuesto", 3], ["tasa", 3],
    ["cabildo", 3], ["ayuntamiento", 3], ["ibi", 3], ["exaccion", 3],
    ["modelo 303", 3], ["modelo 390", 3], ["igic", 1], ["recargo", 1],
  ],
  FRUTA: [
    ["liquidacion", 3], ["entrega de fruta", 4], ["alhondiga", 3],
    ["cooperativa", 3], ["kilos", 2], ["precio kg", 3], ["calibre", 2],
    ["platano", 3], ["tomate", 3], ["aguacate", 3], ["mango", 3],
    ["papaya", 3], ["cosecha", 3], ["productor", 2],
  ],
  SUBVENCIONES: [
    ["subvencion", 4], ["ayuda", 3], ["feader", 4], ["feaga", 4],
    ["foga", 4], ["pago unico", 4], ["consejeria de agricultura", 4],
    ["beneficiario", 3], ["expediente de ayuda", 3],
  ],
};

function scoreWords(text, table) {
  let best = { score: 0, word: "", id: "" };
  for (const [id, words] of Object.entries(table)) {
    let score = 0;
    let hit = "";
    for (const [w, weight] of words) {
      if (text.includes(w)) {
        score += weight;
        if (!hit || weight > 1) hit = w;
      }
    }
    if (score > best.score) best = { score, word: hit, id };
  }
  return best;
}

/**
 * Clasifica un documento mirando solo su texto. Nunca lanza.
 * @returns {{kind: string, category: string, direction: string, source: string, score: number, why: string}}
 */
export function classifyLocal(text, hints = {}) {
  const blob = fold(`${hints.fileName || ""} ${text || ""}`);

  const kindHit = scoreWords(blob, KIND_WORDS);
  const kind = kindHit.score >= 3 ? kindHit.id : "FACTURA";
  const direction = directionOf(kind);

  let categoryHit = scoreWords(blob, CATEGORY_WORDS);
  // La pista del nombre del fichero («factura agua mayo.pdf») ayuda mucho.
  if (categoryHit.score < 3 && hints.fileName) {
    categoryHit = scoreWords(fold(hints.fileName), CATEGORY_WORDS);
  }
  let category = categoryHit.score >= 3 ? categoryHit.id : "";

  // Coherencia: un ingreso no puede ser un gasto de agua.
  const cat = CATEGORIES.find((c) => c.id === category);
  if (cat && cat.direction && cat.direction !== direction) category = "";
  if (!category) {
    if (kind === "LIQUIDACION" || kind === "COBRO") category = "FRUTA";
    else if (kind === "SUBVENCION") category = "SUBVENCIONES";
  }

  const why =
    kindHit.score >= 3
      ? `Parece ${kindInfo(kind).label.toLowerCase()} por «${kindHit.word}»${
          category ? ` y va a ${categoryInfo(category).label.toLowerCase()} por «${categoryHit.word}»` : ""
        }.`
      : "No he visto palabras claras: lo dejo como factura recibida y sin clasificar.";

  return {
    kind,
    category,
    direction,
    source: "reglas",
    score: kindHit.score + categoryHit.score,
    why,
  };
}
