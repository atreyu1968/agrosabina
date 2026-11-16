/*
 * Los informes de gestión: los tres números que se miran a diario en una
 * empresa. Van aparte de los libros oficiales (accounting.js) porque no son
 * asientos, son la foto del negocio:
 *
 *   · el IGIC de cada trimestre, para saber qué se ingresa y qué se compensa;
 *   · el dinero que hay en la caja y en cada banco, con sus movimientos;
 *   · lo que está pendiente de cobro y de pago, y cuánto lleva de retraso.
 *
 * Todo se calcula de los documentos que ya están guardados: no hay tabla
 * nueva, no se guarda nada y no sale nada del ordenador.
 */

import { round2 } from "./util.js";
import { isFinancial, financialDirection, financialHasCash } from "./financial-documents.js";

/** Tipos de documento que son dinero que entra. */
const TIPOS_ENTRADA = ["LIQUIDACION", "SUBVENCION", "COBRO", "VENTA"];

/** ¿Este documento es dinero que entra? Manda el sentido; si no lo tiene, el tipo. */
export function esEntrada(doc) {
  if (isFinancial(doc?.kind)) return financialDirection(doc.kind, doc.financial) === "INGRESO";
  const sentido = String((doc && doc.direction) || "").toUpperCase();
  if (sentido === "INGRESO") return true;
  if (sentido === "GASTO") return false;
  return TIPOS_ENTRADA.indexOf(String((doc && doc.kind) || "").toUpperCase()) >= 0;
}

/** Un documento que solo mueve dinero, sin ser una factura con su IGIC. */
function soloDinero(doc) {
  const tipo = String((doc && doc.kind) || "").toUpperCase();
  return tipo === "COBRO" || tipo === "PAGO" || isFinancial(tipo);
}

/** La fecha del documento: la de emisión; si no la tiene, la de alta. */
export function fechaDe(doc) {
  const d = String((doc && (doc.issueDate || doc.createdAt)) || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : "";
}

/** La fecha en que se cobró o se pagó (vacía si todavía está pendiente). */
export function fechaDePago(doc) {
  const d = String((doc && doc.paidDate) || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : "";
}

/** El importe del documento: el total; si no lo hay, base más cuota. */
function importeDe(doc) {
  const total = round2(Number((doc && doc.total) || 0));
  if (total) return total;
  return round2(Number((doc && doc.base) || 0) + Number((doc && doc.igic) || 0));
}

/** ¿Está cobrado o pagado? */
function estaPagado(doc) {
  return String((doc && doc.status) || "").toUpperCase() === "PAGADO";
}

/** Días de una fecha a otra: positivo cuando la segunda es más tarde. */
function diasEntre(desdeISO, hastaISO) {
  const a = new Date(`${desdeISO}T12:00:00`).getTime();
  const b = new Date(`${hastaISO}T12:00:00`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

/* ------------------------------------------------------------------ */
/* IGIC por trimestre (el modelo 420 de Canarias)                      */
/* ------------------------------------------------------------------ */

/**
 * El IGIC de un año, trimestre a trimestre: lo que has repercutido en tus
 * liquidaciones y subvenciones, lo que has soportado en tus gastos, y la
 * diferencia, que es lo que sale a ingresar (o a compensar).
 *
 * Se cuentan los documentos por su fecha, no por la de cobro: el IGIC se
 * devenga cuando se emite la factura, no cuando se paga.
 */
export function igicPorTrimestre(docs, opts) {
  const o = opts || {};
  const year = Number(o.year) || new Date().getFullYear();
  const rows = [1, 2, 3, 4].map((q) => ({
    q,
    label: `${q}T`,
    baseRep: 0,
    cuotaRep: 0,
    baseSop: 0,
    cuotaSop: 0,
    docs: 0,
    sinTipo: 0,
  }));

  for (const doc of docs || []) {
    // Un cobro suelto no lleva IGIC propio: ya está en la liquidación que lo
    // originó, y contarlo dos veces inflaría la declaración.
    if (soloDinero(doc)) continue;
    const fecha = fechaDe(doc);
    if (!fecha || fecha.slice(0, 4) !== String(year)) continue;
    const mes = Number(fecha.slice(5, 7));
    if (!(mes >= 1 && mes <= 12)) continue;
    const fila = rows[Math.floor((mes - 1) / 3)];
    const base = round2(Number(doc.base) || 0);
    const cuota = round2(Number(doc.igic) || 0);
    fila.docs += 1;
    if (!cuota) fila.sinTipo += 1;
    if (esEntrada(doc)) {
      fila.baseRep = round2(fila.baseRep + base);
      fila.cuotaRep = round2(fila.cuotaRep + cuota);
    } else {
      fila.baseSop = round2(fila.baseSop + base);
      fila.cuotaSop = round2(fila.cuotaSop + cuota);
    }
  }

  for (const r of rows) r.diferencia = round2(r.cuotaRep - r.cuotaSop);

  const totals = rows.reduce(
    (t, r) => ({
      baseRep: round2(t.baseRep + r.baseRep),
      cuotaRep: round2(t.cuotaRep + r.cuotaRep),
      baseSop: round2(t.baseSop + r.baseSop),
      cuotaSop: round2(t.cuotaSop + r.cuotaSop),
      docs: t.docs + r.docs,
      sinTipo: t.sinTipo + r.sinTipo,
    }),
    { baseRep: 0, cuotaRep: 0, baseSop: 0, cuotaSop: 0, docs: 0, sinTipo: 0 }
  );
  totals.diferencia = round2(totals.cuotaRep - totals.cuotaSop);

  return { year, rows, totals };
}

/* ------------------------------------------------------------------ */
/* Caja y bancos                                                      */
/* ------------------------------------------------------------------ */

/** El cajón de cada cuenta: caja, un banco, o «sin medio de pago». */
function cajonDe(doc, caja) {
  const medio = String((doc && doc.payMethod) || "").toUpperCase();
  const cuenta = String((doc && doc.payAccount) || "").trim();
  if (medio === "CAJA") return { key: "CAJA|" + caja, method: "CAJA", name: caja };
  if (medio === "BANCO" || medio === "TARJETA") {
    const nombre = cuenta || "Sin nombre todavía";
    return { key: medio + "|" + nombre.toLowerCase(), method: medio, name: nombre };
  }
  return { key: "SIN|", method: "", name: "Sin medio de pago" };
}

/**
 * El dinero que ha entrado y salido por la caja y por cada cuenta corriente,
 * con el saldo que queda en cada una. Se agrupa por lo que se dijo al marcar
 * el documento como cobrado o pagado: caja, o banco y su cuenta.
 *
 * Los documentos pagados sin medio (los de antes de que se preguntara) no se
 * pierden: van a un grupo aparte que se ve en pantalla.
 */
export function tesoreriaPorCuenta(docs, opts) {
  const o = opts || {};
  const caja = String(o.cashName || "").trim() || "Caja general";
  const desde = String(o.from || "").slice(0, 10);
  const hasta = String(o.to || "").slice(0, 10);
  const cuentas = new Map();
  const pendientes = { count: 0, amount: 0 };
  const sinFecha = { count: 0, amount: 0 };

  for (const doc of docs || []) {
    const amount = importeDe(doc);
    if (!financialHasCash(doc)) continue;
    if (!estaPagado(doc)) {
      pendientes.count += 1;
      pendientes.amount = round2(pendientes.amount + amount);
      continue;
    }
    const day = fechaDePago(doc);
    if (!day) {
      sinFecha.count += 1;
      sinFecha.amount = round2(sinFecha.amount + amount);
      continue;
    }
    if (desde && day < desde) continue;
    if (hasta && day > hasta) continue;

    const cajon = cajonDe(doc, caja);
    let fila = cuentas.get(cajon.key);
    if (!fila) {
      fila = { key: cajon.key, method: cajon.method, name: cajon.name, entradas: 0, salidas: 0, saldo: 0, movimientos: [] };
      cuentas.set(cajon.key, fila);
    }
    const signo = esEntrada(doc) ? 1 : -1;
    fila.movimientos.push({
      id: String((doc && doc.id) || ""),
      date: day,
      number: String((doc && doc.number) || ""),
      party: String((doc && doc.party) || ""),
      concept: String((doc && doc.concept) || ""),
      amount: round2(signo * amount),
    });
  }

  const lista = [...cuentas.values()];
  for (const fila of lista) {
    fila.movimientos.sort((a, b) => (a.date === b.date ? a.number.localeCompare(b.number) : a.date.localeCompare(b.date)));
    let saldo = 0;
    for (const m of fila.movimientos) {
      saldo = round2(saldo + m.amount);
      m.running = saldo;
      if (m.amount >= 0) fila.entradas = round2(fila.entradas + m.amount);
      else fila.salidas = round2(fila.salidas + Math.abs(m.amount));
    }
    fila.saldo = round2(saldo);
  }

  const orden = { CAJA: 0, BANCO: 1, "": 2 };
  lista.sort((a, b) => {
    const d = (orden[a.method] || 0) - (orden[b.method] || 0);
    return d === 0 ? a.name.localeCompare(b.name) : d;
  });

  const totales = lista.reduce(
    (t, f) => ({
      entradas: round2(t.entradas + f.entradas),
      salidas: round2(t.salidas + f.salidas),
      saldo: round2(t.saldo + f.saldo),
    }),
    { entradas: 0, salidas: 0, saldo: 0 }
  );

  return { cuentas: lista, totales, pendientes, sinFecha };
}

/* ------------------------------------------------------------------ */
/* Vencimientos                                                       */
/* ------------------------------------------------------------------ */

function cestaVacia() {
  return { items: [], total: 0, vencido: 0, hoy: 0, semana: 0, mes: 0, despues: 0, sinFecha: 0 };
}

/**
 * Lo que está pendiente de cobro y de pago, ordenado por fecha, con los días
 * de retraso. La fecha que manda es la de vencimiento si el documento la
 * tiene; si no, la del propio documento (y así se avisa en pantalla).
 *
 * Los tramos son los de siempre: lo que ya está vencido, lo que vence hoy, esta
 * semana, este mes, y lo que queda más adelante.
 */
export function vencimientos(docs, opts) {
  const o = opts || {};
  const hoy = String(o.today || "").slice(0, 10);
  const cobros = cestaVacia();
  const pagos = cestaVacia();

  for (const doc of docs || []) {
    if (!financialHasCash(doc)) continue;
    if (estaPagado(doc)) continue;
    const amount = importeDe(doc);
    const destino = esEntrada(doc) ? cobros : pagos;
    destino.total = round2(destino.total + amount);

    const propia = fechaDe(doc);
    const vence = String((doc && doc.dueDate) || "").slice(0, 10);
    const tieneVencimiento = /^\d{4}-\d{2}-\d{2}$/.test(vence);
    const fecha = tieneVencimiento ? vence : propia;

    if (!fecha) {
      destino.sinFecha += 1;
      destino.items.push({
        id: String((doc && doc.id) || ""),
        due: "",
        party: String((doc && doc.party) || ""),
        number: String((doc && doc.number) || ""),
        concept: String((doc && doc.concept) || ""),
        amount,
        dias: null,
        estimada: !tieneVencimiento,
      });
      continue;
    }

    const dias = diasEntre(fecha, hoy) || 0;
    if (dias > 0) destino.vencido = round2(destino.vencido + amount);
    else if (dias === 0) destino.hoy = round2(destino.hoy + amount);
    else if (-dias <= 7) destino.semana = round2(destino.semana + amount);
    else if (-dias <= 30) destino.mes = round2(destino.mes + amount);
    else destino.despues = round2(destino.despues + amount);

    destino.items.push({
      id: String((doc && doc.id) || ""),
      due: fecha,
      party: String((doc && doc.party) || ""),
      number: String((doc && doc.number) || ""),
      concept: String((doc && doc.concept) || ""),
      amount,
      dias,
      estimada: !tieneVencimiento,
    });
  }

  for (const cesta of [cobros, pagos]) {
    cesta.items.sort((a, b) => (a.due === b.due ? Math.abs(b.amount) - Math.abs(a.amount) : String(a.due).localeCompare(String(b.due))));
  }

  return { hoy, cobros, pagos, neto: round2(cobros.total - pagos.total) };
}
