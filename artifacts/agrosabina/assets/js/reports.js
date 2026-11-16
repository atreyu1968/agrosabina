/*
 * Las cuentas anuales en PDF: el balance de situación y la cuenta de pérdidas
 * y ganancias, con las líneas del modelo oficial y, debajo de cada epígrafe,
 * las cuentas que suman ese importe (así se ve de dónde sale cada cifra).
 */

import { balanceSituacion, cuenta, cuentaResultados } from "./accounting.js";
import { informePdf } from "./pdf.js";
import { fmtEUR } from "./util.js";

function fechaTexto(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(value || "");
}

/** «Del 1 de enero al 31 de diciembre de 2025», en palabras. */
function periodoTexto(from, to) {
  if (!from && !to) return "Todos los documentos registrados";
  if (from && to) return `Del ${fechaTexto(from)} al ${fechaTexto(to)}`;
  if (from) return `Desde el ${fechaTexto(from)}`;
  return `Hasta el ${fechaTexto(to)}`;
}

function hoyTexto() {
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: "Atlantic/Canary",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date());
}

function nombreFichero(base, from, to) {
  return `${base}-${from || "inicio"}_${to || "hoy"}.pdf`;
}

/** El saldo de cada cuenta a partir del libro mayor. */
function saldosDelMayor(mayor) {
  const out = [];
  for (const cuenta of mayor || []) {
    let debe = 0;
    let haber = 0;
    for (const m of cuenta.moves || []) {
      debe += Number(m.debit) || 0;
      haber += Number(m.credit) || 0;
    }
    const saldo = debe - haber;
    if (!saldo) continue;
    out.push({ code: String(cuenta.code || ""), name: String(cuenta.name || ""), saldo });
  }
  return out;
}

/** Ajusta el balance a fecha de cierre, aunque la pantalla filtre desde otra fecha. */
export function balanceAsOfWindow(window, exerciseYear) {
  const year = Number(exerciseYear);
  const start = Number.isInteger(year) && year >= 1900 && year <= 2200
    ? `${year}-01-01`
    : String(window?.from || "");
  return { ...(window || {}), from: start };
}

/** Las cuentas se asocian al epígrafe por el plan contable, nunca por el texto. */
function detalleDe(key, saldos) {
  if (key === "PN_VII") return [];
  const activo = key.startsWith("AN_") || key.startsWith("AC_");
  return saldos.flatMap((saldo) => {
    if (cuenta(saldo.code).balance !== key) return [];
    const importe = activo ? saldo.saldo : -saldo.saldo;
    if (Math.abs(importe) < 0.005) return [];
    return [{
      cells: [`· ${saldo.code} — ${saldo.name}`, fmtEUR(importe)],
      size: 7.5,
    }];
  });
}

const COLUMNAS = [
  { label: "Epígrafe", weight: 6.4, align: "left" },
  { label: "Importe", weight: 2, align: "right" },
];

/** El balance de situación, con la comprobación al final. */
export function informeBalancePdf(mayor, opts) {
  const o = opts || {};
  const saldos = saldosDelMayor(mayor);
  const pyg = cuentaResultados(mayor || []);
  const bal = balanceSituacion(mayor || [], pyg.resultado);

  const rows = [];
  for (const r of bal.rows) {
    const total = /total/i.test(String(r.label || ""));
    rows.push({
      cells: [r.label, r.value ? fmtEUR(r.value) : ""],
      bold: total,
      shade: total,
    });
    if (r.kind === "line" && r.value) rows.push(...detalleDe(r.key, saldos));
  }
  rows.push({
    cells: ["Comprobación: activo − (patrimonio neto + pasivo)", fmtEUR(bal.descuadre)],
    bold: true,
    shade: true,
  });

  return informePdf({
    filename: nombreFichero("balance-de-situacion", o.from, o.to),
    title: "Agrosabina SL · Balance de situación",
    subtitle: `A ${fechaTexto(o.to) || hoyTexto()} · saldo acumulado desde el inicio del ejercicio · estructura orientativa del PGC · emitido el ${hoyTexto()}`,
    footer: `Agrosabina SL · Balance de situación · al ${fechaTexto(o.to) || hoyTexto()}`,
    horizontal: !!o.horizontal,
    blocks: [
      {
        type: "text",
        text: `Resultado del periodo: ${fmtEUR(pyg.resultado)}. El balance cuadra cuando la comprobación de la última línea da 0,00 €.`,
      },
      { type: "space", size: 6 },
      { type: "table", columns: COLUMNAS, rows, size: 8, rowHeight: 16, wrap: true },
      {
        type: "text",
        size: 8,
        text: "El detalle bajo cada epígrafe muestra las cuentas que forman su importe.",
      },
      {
        type: "text",
        size: 7.5,
        text: "Informe interno basado en los datos registrados; no sustituye el depósito oficial de cuentas ni una revisión profesional.",
      },
    ],
  });
}

/** La cuenta de pérdidas y ganancias del periodo. */
export function informeResultadosPdf(mayor, opts) {
  const o = opts || {};
  const pyg = cuentaResultados(mayor || []);
  const rows = (pyg.lines || []).map((l) => ({
    cells: [l.label || "", l.value ? fmtEUR(l.value) : ""],
    bold: !!l.total,
    shade: !!l.total,
  }));

  const blocks = [
    {
      type: "text",
      text: "Los gastos van en negativo y los ingresos en positivo. El resultado positivo al final es beneficio; el negativo, pérdida.",
    },
    { type: "space", size: 6 },
    { type: "table", columns: COLUMNAS, rows, size: 10, rowHeight: 19, wrap: true },
    {
      type: "text",
      size: 7.5,
      text: "Informe interno basado en los datos registrados; no sustituye declaraciones ni una revisión profesional.",
    },
  ];
  if (pyg.sinClasificar) {
    blocks.push({
      type: "text",
      size: 8.5,
      bold: true,
      text: `Aviso: hay ${fmtEUR(Math.abs(pyg.sinClasificar))} en cuentas de gasto o ingreso que no he sabido colocar en el modelo. Revisa el concepto de esos documentos.`,
    });
  }

  return informePdf({
    filename: nombreFichero("perdidas-y-ganancias", o.from, o.to),
    title: "Agrosabina SL · Cuenta de pérdidas y ganancias",
    subtitle: `${periodoTexto(o.from, o.to)} · estructura orientativa basada en el PGC · emitido el ${hoyTexto()}`,
    footer: `Agrosabina SL · Pérdidas y ganancias · ${periodoTexto(o.from, o.to)}`,
    blocks,
  });
}
