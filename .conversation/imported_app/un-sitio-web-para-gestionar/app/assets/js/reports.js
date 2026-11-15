/*
 * Las cuentas anuales en PDF: el balance de situación y la cuenta de pérdidas
 * y ganancias, con las líneas del modelo oficial y, debajo de cada epígrafe,
 * las cuentas que suman ese importe (así se ve de dónde sale cada cifra).
 */

import { balanceSituacion, cuentaResultados } from "./accounting.js";
import { informePdf } from "./pdf.js";
import { fmtEUR } from "./util.js";

/** «Del 1 de enero al 31 de diciembre de 2025», en palabras. */
function periodoTexto(from, to) {
  if (!from && !to) return "Todos los documentos registrados";
  if (from && to) return `Del ${from} al ${to}`;
  if (from) return `Desde el ${from}`;
  return `Hasta el ${to}`;
}

function hoyTexto() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
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

/** Los epígrafes se reconocen por su nombre; esto dice qué grupos los suman. */
const PREFIJOS = [
  ["tesorer", ["57"]],
  ["efectiv", ["57"]],
  ["clientes", ["43"]],
  ["deudores", ["44"]],
  ["proveedores", ["40"]],
  ["acreedores", ["41"]],
  ["hacienda", ["47"]],
  ["igic", ["47"]],
  ["capital", ["10"]],
  ["reservas", ["11"]],
  ["resultado", ["12"]],
  ["subvencion", ["13"]],
  ["inmovilizado", ["20", "21", "22", "23", "25", "28", "29"]],
  ["existencias", ["3"]],
  ["deudaso", ["52"]],
  ["deudas", ["51", "52", "16", "17", "18"]],
];

/** La lista corta de cuentas que forman un epígrafe, para poder repasarlo. */
function detalleDe(label, saldos) {
  const l = String(label || "").toLowerCase();
  const prefijos = PREFIJOS.find(([ clave ]) => l.indexOf(clave) >= 0);
  if (!prefijos) return "";
  const trozos = [];
  for (const s of saldos) {
    if (!prefijos[1].some((p) => s.code.indexOf(p) === 0)) continue;
    trozos.push(`${s.code} ${s.name}: ${fmtEUR(Math.abs(s.saldo))}`);
  }
  return trozos.length ? `\n${trozos.slice(0, 6).join(" · ")}` : "";
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
    const detalle = r.value ? detalleDe(r.label, saldos) : "";
    rows.push({
      cells: [`${r.label}${detalle}`, r.value ? fmtEUR(r.value) : ""],
      bold: total,
      shade: total,
    });
  }
  rows.push({
    cells: ["Comprobación: activo − (patrimonio neto + pasivo)", fmtEUR(bal.descuadre)],
    bold: true,
    shade: true,
  });

  return informePdf({
    filename: nombreFichero("balance-de-situacion", o.from, o.to),
    title: "Agrosabina SL · Balance de situación",
    subtitle: `${periodoTexto(o.from, o.to)} · modelo oficial del Plan General de Contabilidad · emitido el ${hoyTexto()}`,
    footer: "Agrosabina SL · Balance de situación",
    horizontal: !!o.horizontal,
    blocks: [
      {
        type: "text",
        text: `Resultado del periodo: ${fmtEUR(pyg.resultado)}. El balance cuadra cuando la comprobación de la última línea da 0,00 €.`,
      },
      { type: "space", size: 6 },
      { type: "table", columns: COLUMNAS, rows, size: 8, rowHeight: 16 },
      {
        type: "text",
        size: 8,
        text: "En letra pequeña, debajo de cada epígrafe, van las cuentas del plan que suman ese importe.",
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
    { type: "table", columns: COLUMNAS, rows, size: 8.5, rowHeight: 16 },
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
    subtitle: `${periodoTexto(o.from, o.to)} · modelo oficial del Plan General de Contabilidad · emitido el ${hoyTexto()}`,
    footer: "Agrosabina SL · Pérdidas y ganancias",
    blocks,
  });
}
