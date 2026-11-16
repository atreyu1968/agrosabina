/*
 * Nóminas (recibos de salarios).
 *
 * Dos mitades bien separadas:
 *  - `leerNomina(texto)` saca del texto ya leído los números del recibo
 *    (bruto, Seguridad Social del trabajador, IRPF, líquido a percibir y
 *    Seguridad Social a cargo de la empresa) y avisa cuando las cuentas del
 *    papel no cuadran.
 *  - `calcularNomina` y `lineasNomina` son las cuentas que usan la ficha y la
 *    contabilidad, para que las dos enseñen exactamente lo mismo.
 *
 * El asiento que sale de aquí es el del PGC para una nómina:
 *   640000 Sueldos y salarios ...................... al debe (bruto)
 *   642000 Seguridad Social a cargo de la empresa .. al debe
 *   476000 Organismos de la Seguridad Social ...... al haber (trabajador + empresa)
 *   475100 Hacienda Pública, acreedora por IRPF .. al haber
 *   465000 Remuneraciones pendientes de pago ...... al haber (el líquido)
 * Cuando la nómina se marca pagada, la contabilidad saca el dinero de la
 * cuenta 465000 contra caja (570000) o banco (572000), como cualquier otro pago.
 */

import { parseAmount, round2 } from "./util.js";
import { lineaEsEncabezado } from "./parse.js";
import { leerTablaNomina } from "./nomina-tabla.js";

/** Las cuentas del PGC que toca una nómina. */
export const CUENTAS_NOMINA = Object.freeze({
  sueldos: "640000",
  ssEmpresa: "642000",
  ssPagar: "476000",
  irpf: "475100",
  liquido: "465000",
});

/** Porcentajes de referencia del régimen general, solo como pista. */
export const SS_TRABAJADOR_PCT = 6.35;
export const SS_EMPRESA_PCT = 30;

/** ¿Este documento es una nómina? */
export function esNomina(doc) {
  return String((doc && doc.kind) || "").toUpperCase() === "NOMINA";
}

/* ------------------------------------------------------------------ */
/* Números y textos                                                   */
/* ------------------------------------------------------------------ */

function texto(v) {
  return String(v == null ? "" : v)
    .replace(/\s+/g, " ")
    .trim();
}

/** Un importe venga como número o como texto («1.234,56»). */
function importe(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? round2(v) : null;
  const n = parseAmount(String(v));
  return Number.isFinite(n) ? round2(n) : null;
}

/** Céntimos con coma, para las notas. */
function euros(v) {
  return v == null || !Number.isFinite(Number(v))
    ? "—"
    : `${Number(v).toFixed(2).replace(".", ",")} €`;
}

function lineasDe(textoCrudo) {
  return String(textoCrudo || "")
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** El último importe con céntimos de la línea (la columna «importe»). */
function importeDeLinea(linea) {
  const m = String(linea).match(/-?\d[\d.]*,\d{2}|\d+\.\d{2}/g);
  if (!m || !m.length) return null;
  return importe(m[m.length - 1]);
}

/** El tanto por ciento que traiga la línea, si lo trae. */
function porcentajeDeLinea(linea) {
  const m = String(linea).match(/(\d{1,2}(?:[.,]\d{1,2})?)\s*%/);
  return m ? importe(m[1]) : null;
}

/* ------------------------------------------------------------------ */
/* Las cuentas                                                        */
/* ------------------------------------------------------------------ */

/**
 * Las cuentas de una nómina, siempre iguales para la ficha y para el asiento.
 * Si falta un dato se calcula con los demás; si nada se puede calcular, el
 * valor se queda en `null` en vez de inventarse un cero.
 */
export function calcularNomina(n) {
  const src = n && typeof n === "object" ? n : {};
  const bruto = importe(src.bruto);
  const ssPct = importe(src.ssPct);
  const irpfPct = importe(src.irpfPct);

  let ssTrabajador = importe(src.ssTrabajador);
  let irpf = importe(src.irpf);
  const ssEmpresa = importe(src.ssEmpresa);

  if (ssTrabajador == null && bruto != null && ssPct != null) {
    ssTrabajador = round2((bruto * ssPct) / 100);
  }
  if (irpf == null && bruto != null && irpfPct != null) {
    irpf = round2((bruto * irpfPct) / 100);
  }

  let neto = importe(src.neto);
  if (neto == null && bruto != null && (ssTrabajador != null || irpf != null)) {
    neto = round2(bruto - (ssTrabajador || 0) - (irpf || 0));
  }

  const descuadre =
    bruto != null && neto != null && ssTrabajador != null && irpf != null
      ? round2(bruto - ssTrabajador - irpf - neto)
      : null;

  return {
    trabajador: texto(src.trabajador),
    nif: texto(src.nif),
    puesto: texto(src.puesto),
    periodo: texto(src.periodo),
    dias: importe(src.dias),
    bruto,
    ssTrabajador,
    irpf,
    ssEmpresa,
    neto,
    ssPct,
    irpfPct,
    totalSS: round2((ssTrabajador || 0) + (ssEmpresa || 0)),
    coste: bruto == null ? null : round2(bruto + (ssEmpresa || 0)),
    descuadre,
    devengos: Array.isArray(src.devengos) ? src.devengos : [],
  };
}

/**
 * El asiento de la nómina en forma de líneas con signo: positivo al debe,
 * negativo al haber (el mismo formato que usa accounting.js). El líquido va a
 * la subcuenta del trabajador (465001, 465002…) para que cada uno tenga la
 * suya; si no se le ha abierto todavía, a la 465000.
 */
export function lineasNomina(n, cuentaLiquido) {
  const c = calcularNomina(n);
  const liquido = String(cuentaLiquido || CUENTAS_NOMINA.liquido);
  const raw = [];
  if (c.bruto == null || c.bruto <= 0) return raw;
  raw.push([CUENTAS_NOMINA.sueldos, c.bruto]);
  if (c.ssEmpresa) raw.push([CUENTAS_NOMINA.ssEmpresa, c.ssEmpresa]);
  if (c.totalSS) raw.push([CUENTAS_NOMINA.ssPagar, -c.totalSS]);
  if (c.irpf) raw.push([CUENTAS_NOMINA.irpf, -c.irpf]);
  if (c.neto) raw.push([liquido, -c.neto]);
  return raw;
}

/* ------------------------------------------------------------------ */
/* El lector                                                          */
/* ------------------------------------------------------------------ */

/**
 * Lee un recibo de salarios del texto que ya ha sacado el lector de PDF,
 * fotos o correo. Devuelve los mismos campos que `calcularNomina` más
 * `notas` (lo que conviene revisar) y `ok` (si ha encontrado el bruto).
 */
export function leerNomina(textoCrudo) {
  const lls = lineasDe(textoCrudo);
  const plano = String(textoCrudo || "");
  const notas = [];
  const base = { devengos: [] };
  const tabla = leerTablaNomina(textoCrudo);

  /* Trabajador: va en una línea con su etiqueta. */
  for (const l of lls) {
    // Un rótulo de tabla («Trabajador  NIF  Días») no es el nombre de nadie.
    if (lineaEsEncabezado(l)) continue;
    if (/^trabajador\/a\s/i.test(l)) continue;
    const m = l.match(/^(?:trabajador|nombre y apellidos|apellidos y nombre|empleado)\s*[:\-]?\s*(.+)$/i);
    if (!m) continue;
    const valor = m[1]
      .replace(/\b(?:nif|dni|n\.?\s*[ºo]\s*afiliaci[oó]n|n\.?a\.?f)\b.*$/i, "")
      .replace(/[|;].*$/, "")
      .trim();
    if (valor.length >= 3 && !base.trabajador) base.trabajador = valor;
  }
  if (!base.trabajador) {
    const m = plano.match(/(?:trabajador|empleado)\s*[:\-]\s*([A-ZÁÉÍÓÚÑ][^\n,;]{3,60})/i);
    if (m) base.trabajador = texto(m[1]);
  }

  const nif = plano.match(/\b(\d{8}[A-Z])\b/);
  if (nif) base.nif = nif[1];

  const periodo =
    plano.match(/(?:per[ií]odo|periodo)[^\n]{0,40}?(\d{2}\/\d{2}\/\d{4})\s*(?:a|al|-|–|\/)\s*(\d{2}\/\d{2}\/\d{4})/i) ||
    plano.match(/(\d{2}\/\d{2}\/\d{4})\s*(?:a|al|-|–)\s*(\d{2}\/\d{2}\/\d{4})/);
  if (periodo) base.periodo = `${periodo[1]} a ${periodo[2]}`;

  const dias = plano.match(/(\d{1,2})\s*d[ií]as/i);
  if (dias) base.dias = Number(dias[1]);
  for (const key of ["trabajador", "periodo", "dias"]) {
    if (tabla[key] != null && tabla[key] !== "") base[key] = tabla[key];
  }
  if (tabla.issueDate) base.issueDate = tabla.issueDate;

  /* Importes: se recorren las líneas y gana la línea que más claro lo diga. */
  let bruto = null;
  let neto = null;
  let ssTrabajador = null;
  let irpf = null;
  let ssEmpresa = null;
  let salarioBase = null;
  let irpfPct = null;

  for (const l of lls) {
    const bajo = l.toLowerCase();
    const valor = importeDeLinea(l);
    if (valor == null) continue;

    if (/total\s+devengad|importe\s+total\s+devengado|total\s+bruto|salario\s+bruto\b/.test(bajo)) {
      bruto = valor;
      continue;
    }
    if (/l[ií]quido\s+a\s+percibir|neto\s+a\s+percibir|total\s+l[ií]quido|importe\s+l[ií]quido|l[ií]quido\s+total|total\s+a\s+percibir/.test(bajo)) {
      neto = valor;
      continue;
    }
    if (/total\s+a\s+cargo\s+de\s+la\s+empresa|coste\s+(?:de\s+)?(?:la\s+)?seguridad\s+social|total\s+empresa|aportaci[oó]n(?:es)?\s+empresarial|seguridad\s+social\s+a\s+cargo\s+de\s+la\s+empresa/.test(bajo)) {
      ssEmpresa = valor;
      continue;
    }
    if (/total.*(?:trabajador|a\s+cargo\s+del\s+trabajador)|aportaci[oó]n(?:es)?\s+del\s+trabajador|total\s+deducciones\s+(?:ss|seguridad)|seguridad\s+social\s+(?:del\s+)?trabajador\b/.test(bajo)) {
      ssTrabajador = valor;
      continue;
    }
    if (/irpf|retenci[oó]n/.test(bajo)) {
      const p = porcentajeDeLinea(l);
      if (p != null && p > 0 && p <= 60) irpfPct = p;
      irpf = valor;
      continue;
    }
    if (/salario\s+base/.test(bajo) && salarioBase == null) salarioBase = valor;
  }

  bruto = tabla.bruto ?? bruto;
  neto = tabla.neto ?? neto;
  ssTrabajador = tabla.ssTrabajador ?? ssTrabajador;
  irpf = tabla.irpf ?? irpf;
  ssEmpresa = tabla.ssEmpresa ?? ssEmpresa;
  notas.push(...tabla.notas);

  if (bruto == null && salarioBase != null) {
    bruto = salarioBase;
    notas.push("No veía el total devengado y he tomado el salario base como bruto.");
  }

  /* Lo que falte se saca de los demás: bruto = líquido + Seguridad Social + IRPF. */
  if (bruto != null && neto != null && ssTrabajador == null && irpf != null) {
    const calculado = round2(bruto - neto - irpf);
    if (calculado >= 0) {
      ssTrabajador = calculado;
      notas.push(
        `La Seguridad Social del trabajador no venía en una línea clara; la he sacado restando al bruto el líquido y el IRPF (${euros(calculado)}).`
      );
    }
  }
  if (bruto != null && neto != null && irpf == null && ssTrabajador != null) {
    const calculado = round2(bruto - neto - ssTrabajador);
    if (calculado >= 0) {
      irpf = calculado;
      notas.push(`El IRPF no venía en una línea clara; lo he sacado restando al bruto el líquido y la Seguridad Social (${euros(calculado)}).`);
    }
  }
  if (bruto != null && neto == null && (ssTrabajador != null || irpf != null)) {
    notas.push("El líquido a percibir no venía en el papel; lo he calculado con el bruto menos las deducciones.");
  }

  const n = calcularNomina({ ...base, bruto, neto, ssTrabajador, irpf, ssEmpresa, irpfPct });

  if (n.bruto == null) {
    notas.push("No he encontrado el total devengado: escribe el bruto a mano antes de guardar.");
  }
  if (n.neto == null && n.bruto != null) {
    notas.push("Sin Seguridad Social ni IRPF no puedo calcular el líquido: escríbelo a mano.");
  }
  if (n.descuadre != null && Math.abs(n.descuadre) > 0.05) {
    notas.push(
      `Las cuentas del papel no cuadran: bruto − Seguridad Social − IRPF − líquido da ${euros(n.descuadre)}.`
    );
  }
  if (n.ssEmpresa == null) {
    notas.push(
      "No he visto la Seguridad Social a cargo de la empresa: el asiento llevará el sueldo, la parte del trabajador y el IRPF, y la 642000 quedará a cero."
    );
  }

  return { ...n, issueDate: base.issueDate || "", notas, ok: n.bruto != null };
}
