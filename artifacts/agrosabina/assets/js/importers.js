/*
 * Un importador por cada tipo de documento.
 *
 * Antes todo lo que se subía pasaba por el lector de facturas y, encima de lo
 * que sacaba, se iban parcheando a mano la nómina y la liquidación. Así salían
 * documentos mezclados: a una nómina se le quedaban importes de factura, a una
 * liquidación se le colaba el IGIC del lector genérico y quedaba un disparate.
 *
 * Ahora cada tipo de documento tiene aquí su propio lector, y solo se aplica
 * uno: el que reconoce el papel. El que lo lee es el único que escribe sus
 * campos, y los demás no tocan nada.
 *
 * Cada importador sabe dos cosas:
 *   - puntua(texto): cuánto se parece ese texto a su tipo de documento (0-100).
 *   - leer(texto, opciones): el documento ya relleno, con sus avisos.
 */

import { parseInvoiceText, parseLiquidacion } from "./parse.js";
import { leerNomina } from "./nomina.js";
import { DIRECTIONS, directionOf } from "./model.js";
import { STATUS, fmtEUR, fmtNum, round2, todayISO } from "./util.js";

/** Lo que tiene cualquier documento en blanco, se lea como se lea. */
function documentoVacio(kind) {
  return {
    kind,
    direction: directionOf(kind),
    category: "",
    number: "",
    issueDate: todayISO(),
    dueDate: "",
    supplierName: "",
    supplierNif: "",
    base: null,
    rate: 0,
    igic: 0,
    total: null,
    status: STATUS.PENDING,
    confidence: 0,
    notes: [],
    rawText: "",
    liquidacion: null,
    liquidacionRead: null,
    nomina: null,
    nominaRead: null,
    classifyWhy: "",
    classifyNote: "",
  };
}

/**
 * Número, fecha y quién lo emite: lo que identifica al papel sea del tipo que
 * sea. Solo se copian estos datos; los importes los pone el importador de cada
 * tipo, que es el que sabe leerlos.
 */
function identidad(texto, opciones) {
  const base = parseInvoiceText(texto, opciones);
  return {
    number: base.number || "",
    issueDate: base.issueDate || todayISO(),
    dueDate: base.dueDate || "",
    supplierName: base.supplierName || "",
    supplierNif: base.supplierNif || "",
    status: base.status || STATUS.PENDING,
  };
}

/** Suma los pesos de las señales que aparecen en el texto. */
function puntuaMarcas(texto, marcas, tope = 80) {
  const low = String(texto || "").toLowerCase();
  let total = 0;
  for (const [re, peso] of marcas) if (re.test(low)) total += peso;
  return Math.min(tope, total);
}

/**
 * ¿El papel es un recibo de salarios? Una nómina dice «líquido a percibir»
 * igual que una liquidación de fruta, así que sin esta comprobación las dos se
 * confunden y a la nómina se le acaban pegando kilos que no existen.
 */
function esReciboDeSalarios(texto) {
  const low = String(texto || "").toLowerCase();
  return /n[oó]minas?\b|recibo (individual )?de salarios|liquidaci[oó]n de salarios|devengos|base de cotizaci[oó]n|grupo de cotizaci[oó]n|n[uú]mero de afiliaci[oó]n|seguridad social/.test(
    low
  );
}

/* ------------------------------------------------------------------ */
/* Nómina (recibo de salarios)                                        */
/* ------------------------------------------------------------------ */

const NOMINA = {
  id: "nomina",
  label: "Nómina (recibo de salarios)",
  kinds: ["NOMINA"],
  generico: false,
  puntua(texto) {
    const n = leerNomina(texto);
    if (n.ok && n.bruto != null) return 100;
    return puntuaMarcas(texto, [
      [/recibo (individual )?de salarios/, 40],
      [/finiquito/, 35],
      [/l[ií]quido a percibir/, 25],
      [/devengos/, 20],
      [/base de cotizaci[oó]n/, 20],
      [/n[oó]minas?\b/, 20],
      [/n[uú]mero de afiliaci[oó]n/, 15],
      [/grupo de cotizaci[oó]n/, 15],
      [/seguridad social/, 12],
      [/irpf/, 12],
    ]);
  },
  leer(texto, opciones = {}) {
    const n = leerNomina(texto);
    const doc = documentoVacio("NOMINA");
    const id = identidad(texto, opciones);
    doc.number = id.number;
    doc.issueDate = id.issueDate;
    doc.supplierName = n.trabajador || id.supplierName || "";
    doc.supplierNif = n.nif || id.supplierNif || "";
    doc.category = "LABORALES";
    doc.direction = DIRECTIONS.OUT;
    doc.nomina = {
      trabajador: n.trabajador || "",
      nif: n.nif || "",
      periodo: n.periodo || "",
      dias: n.dias,
      bruto: n.bruto,
      ssTrabajador: n.ssTrabajador,
      irpf: n.irpf,
      ssEmpresa: n.ssEmpresa,
      neto: n.neto,
    };
    doc.nominaRead = n;
    // El recibo de salarios no lleva IGIC: el total del documento es el líquido
    // que se le paga al trabajador y la base es su bruto.
    doc.base = n.bruto;
    doc.rate = 0;
    doc.igic = 0;
    doc.total = n.neto != null ? n.neto : n.bruto;
    doc.confidence = n.bruto != null && n.neto != null ? 0.9 : 0.45;
    doc.notes = Array.isArray(n.notas) ? n.notas.slice() : [];
    if (n.bruto == null) {
      doc.notes.push(
        "No he sabido leer el bruto de esta nómina. Escríbelo a mano: la Seguridad Social, el IRPF y el líquido salen solos."
      );
    }
    doc.classifyNote = `Es un recibo de salarios de ${n.trabajador || "un trabajador"}${
      n.periodo ? ` (${n.periodo})` : ""
    }: bruto ${fmtEUR(n.bruto)}, líquido a percibir ${fmtEUR(n.neto)}. Va como nómina, con las cuentas de personal.`;
    return doc;
  },
};

/* ------------------------------------------------------------------ */
/* Liquidación de fruta                                               */
/* ------------------------------------------------------------------ */

const LIQUIDACION = {
  id: "liquidacion",
  label: "Liquidación de fruta",
  kinds: ["LIQUIDACION"],
  generico: false,
  puntua(texto) {
    // Un recibo de salarios no es una liquidación de fruta: si el papel es una
    // nómina, este lector ni se presenta, por muchos «líquido a percibir» que
    // traiga.
    if (esReciboDeSalarios(texto)) return 0;
    const l = parseLiquidacion(texto);
    if (l.ok) return 96;
    if (l.kg != null && (l.price != null || l.net != null || l.gross != null)) return 70;
    return puntuaMarcas(texto, [
      [/l[ií]quidaci[oó]n/, 30],
      [/€\s*\/\s*kg|euros?\s*(\/|por)\s*kilo/, 25],
      [/kilos?\b|\bkg\b/, 15],
      [/\b(extra|primera|segunda|destr[ií]o)\b/, 15],
      [/alh[oó]ndiga|cooperativa/, 20],
      [/calibre|merma|categor[ií]a comercial/, 15],
    ]);
  },
  leer(texto, opciones = {}) {
    const l = parseLiquidacion(texto);
    const doc = documentoVacio("LIQUIDACION");
    const id = identidad(texto, opciones);
    doc.number = id.number;
    doc.issueDate = id.issueDate;
    doc.dueDate = id.dueDate;
    doc.supplierName = id.supplierName;
    doc.supplierNif = id.supplierNif;
    doc.status = id.status;
    doc.category = "FRUTA";
    doc.direction = DIRECTIONS.IN;
    doc.liquidacion = {
      product: l.product || "",
      category: l.category || "",
      kg: l.kg,
      price: l.price,
      discounts: Array.isArray(l.discounts) ? l.discounts : [],
    };
    doc.liquidacionRead = {
      kg: l.kg,
      price: l.price,
      gross: l.gross,
      discounts: Array.isArray(l.discounts) ? l.discounts : [],
      net: l.net,
      rate: l.rate,
      igic: l.igic,
      partidas: l.partidas || [],
      product: l.product || "",
      category: l.category || "",
      ok: !!l.ok,
    };
    // La base es el líquido a percibir; el IGIC, el que traiga el papel (si no
    // trae ninguno, entra al 0 % en vez de inventarse uno).
    const r = l.rate != null && Number.isFinite(Number(l.rate)) ? Number(l.rate) : 0;
    const cuota = l.igic != null ? round2(l.igic) : round2(((l.net || 0) * r) / 100);
    doc.rate = r;
    doc.base = l.net != null ? l.net : l.gross;
    doc.igic = l.net != null ? cuota : 0;
    doc.total = l.net != null ? round2(l.net + cuota) : l.gross;
    doc.confidence = l.ok ? 0.85 : 0.4;
    doc.notes = Array.isArray(l.notes) ? l.notes.slice() : [];
    doc.classifyNote = `Liquidación de fruta${
      l.kg != null && l.price != null ? `: ${fmtNum(l.kg, 2)} kg a ${fmtNum(l.price, 3)} €/kg` : ""
    }, líquido a percibir ${fmtEUR(l.net)}. Va como ingreso, con sus kilos y su precio por kilo.`;
    return doc;
  },
};

/* ------------------------------------------------------------------ */
/* Factura recibida                                                   */
/* ------------------------------------------------------------------ */

function leerFactura(texto, opciones = {}) {
  const base = parseInvoiceText(texto, opciones);
  const doc = documentoVacio("FACTURA");
  doc.number = base.number || "";
  doc.issueDate = base.issueDate || todayISO();
  doc.dueDate = base.dueDate || "";
  doc.supplierName = base.supplierName || "";
  doc.supplierNif = base.supplierNif || "";
  doc.base = base.base;
  doc.rate = base.rate;
  doc.igic = base.igic;
  doc.total = base.total;
  doc.status = base.status || STATUS.PENDING;
  doc.confidence = base.confidence || 0;
  doc.rawText = base.rawText || "";
  doc.notes = Array.isArray(base.notes) ? base.notes.slice() : [];
  return doc;
}

const FACTURA = {
  id: "factura",
  label: "Factura recibida",
  kinds: ["FACTURA"],
  generico: true,
  puntua(texto) {
    const marcas = puntuaMarcas(texto, [
      [/factura/, 25],
      [/base imponible/, 20],
      [/igic|\biva\b/, 18],
      [/\btotal\b/, 15],
      [/\bcif\b|\bnif\b/, 12],
      [/n[uú]mero de factura|n[ºo] factura/, 20],
      [/vencimiento|forma de pago/, 12],
    ]);
    return marcas;
  },
  leer(texto, opciones = {}) {
    return leerFactura(texto, opciones);
  },
};

/* ------------------------------------------------------------------ */
/* Subvención, cobro y cualquier otro papel                           */
/* ------------------------------------------------------------------ */

const SUBVENCION = {
  id: "subvencion",
  label: "Subvención o ayuda",
  kinds: ["SUBVENCION"],
  generico: true,
  puntua(texto) {
    return puntuaMarcas(texto, [
      [/subvenci[oó]n|subvenciones/, 30],
      [/consejer[ií]a de agricultura/, 25],
      [/feaga|feader|fega|foga/, 25],
      [/pago [uú]nico/, 25],
      [/resoluci[oó]n de concesi[oó]n/, 25],
      [/beneficiari[oa]/, 15],
      [/expediente/, 10],
    ]);
  },
  leer(texto, opciones = {}) {
    const doc = leerFactura(texto, opciones);
    doc.kind = "SUBVENCION";
    doc.direction = DIRECTIONS.IN;
    doc.category = "SUBVENCIONES";
    return doc;
  },
};

const COBRO = {
  id: "cobro",
  label: "Cobro o abono recibido",
  kinds: ["COBRO"],
  generico: true,
  puntua(texto) {
    return puntuaMarcas(texto, [
      [/justificante de transferencia/, 30],
      [/abono recibido|cobro recibido/, 30],
      [/transferencia realizada a su favor/, 25],
      [/adeudo/, 20],
      [/recibo bancario/, 20],
      [/pago recibido/, 15],
    ]);
  },
  leer(texto, opciones = {}) {
    const doc = leerFactura(texto, opciones);
    doc.kind = "COBRO";
    doc.direction = DIRECTIONS.IN;
    return doc;
  },
};

const OTRO = {
  id: "otro",
  label: "Otro documento",
  kinds: ["OTRO"],
  generico: true,
  puntua() {
    return 1;
  },
  leer(texto, opciones = {}) {
    const doc = leerFactura(texto, opciones);
    doc.kind = "OTRO";
    doc.direction = DIRECTIONS.OUT;
    return doc;
  },
};

/** Todos los importadores, en orden de prioridad cuando empatan. */
export const IMPORTADORES = [NOMINA, LIQUIDACION, FACTURA, SUBVENCION, COBRO, OTRO];

/** Lo justo para enseñar en pantalla qué lectores hay. */
export function importadoresDisponibles() {
  return IMPORTADORES.map((i) => ({ id: i.id, label: i.label, tipos: i.kinds.slice() }));
}

/**
 * Elige el importador: el del tipo pedido si se ha pedido uno, y si no el que
 * más se parece al papel. `reconoce` dice si el papel tiene de verdad señales
 * de ese tipo (un 20 sobre 100), para no forzar un lector que no ve nada.
 */
export function importadorDe(texto, tipoElegido) {
  const pedido = tipoElegido
    ? IMPORTADORES.find((i) => i.kinds.indexOf(String(tipoElegido).toUpperCase()) >= 0)
    : null;
  if (pedido) {
    return { importador: pedido, forzado: true, reconoce: pedido.puntua(texto) >= 20 };
  }
  let mejor = OTRO;
  let mejorPunto = 0;
  for (const imp of IMPORTADORES) {
    const p = imp.puntua(texto);
    if (p > mejorPunto) {
      mejor = imp;
      mejorPunto = p;
    }
  }
  if (mejorPunto < 20) return { importador: OTRO, forzado: false, reconoce: false };
  return { importador: mejor, forzado: false, reconoce: true };
}

/**
 * Lee un documento con el importador que le toca y solo con ese.
 * @param {string} texto
 * @param {{ defaultRate?: number, fileName?: string, tipo?: string }} opciones
 */
export function leerDocumento(texto, opciones = {}) {
  const { importador, forzado, reconoce } = importadorDe(texto, opciones.tipo);
  const doc = importador.leer(texto, opciones);
  if (forzado && !reconoce) {
    doc.notes.push(
      `Me has dicho que es ${importador.label.toLowerCase()}, pero el papel no lo parece: mira los datos antes de guardar.`
    );
  }
  return {
    id: importador.id,
    etiqueta: importador.label,
    generico: !!importador.generico,
    forzado,
    reconoce,
    doc,
  };
}
