/*
 * Control de fruta: kilos, categorías y precios medios ponderados de las
 * liquidaciones guardadas, por periodo de fecha de emisión del documento.
 */

import { esc, fmtNum, fmtEUR, fmtDate, downloadText } from "./util.js";
import { fruitEntries, fruitStats } from "./fruit-control.js";

const state = { from: "", to: "", category: "", product: "" };

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function isNum(v) {
  return typeof v === "number" && Number.isFinite(v);
}
function kgText(v) {
  return isNum(v) ? `${fmtNum(v, 2)} kg` : `<span class="muted">Desconocido</span>`;
}
function priceText(v) {
  if (!isNum(v)) return `<span class="muted">Sin precio</span>`;
  return `${fmtNum(v, 4)} €/kg`;
}
function priceWide(v) {
  if (!isNum(v)) return `<span class="muted">Sin precio</span>`;
  return `${fmtNum(v, 6)} €/kg`;
}
function eurText(v) {
  return isNum(v) ? fmtEUR(v) : `<span class="muted">Desconocido</span>`;
}
function monthName(key) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(key || ""));
  if (!m) return "Sin fecha de emisión";
  const n = MONTHS[Number(m[2]) - 1];
  return n ? `${n.charAt(0).toUpperCase()}${n.slice(1)} ${m[1]}` : String(key);
}
function csvCell(v) {
  const s = v == null ? "" : String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function csvNum(v, d) {
  return isNum(v) ? v.toFixed(d).replace(".", ",") : "";
}

function uniq(list) {
  return Array.from(new Set(list.filter((x) => x != null && String(x).trim() !== "").map(String))).sort((a, b) =>
    a.localeCompare(b, "es")
  );
}

function scopedCss() {
  return `<style>
    .fc-filters label.date-filter{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:var(--ink-3);font-weight:600}
    .fc-warn{margin:0}
    .fc-warn ul{margin:4px 0 0;padding-left:18px}
    .fc-split{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:18px;align-items:start}
    .fc-flag{display:inline-block;margin-top:3px;font-size:11.5px;color:var(--warn);background:var(--warn-soft);padding:1px 7px;border-radius:6px}
    @media (max-width:1080px){.fc-split{grid-template-columns:minmax(0,1fr)}}
  </style>`;
}

function emptyAll() {
  return `${scopedCss()}<section class="card"><div class="empty">
    <h3>Aún no hay fruta registrada</h3>
    <p>Los kilos, categorías y precios aparecen aquí después de guardar liquidaciones de fruta.</p>
    <div class="e-actions"><a class="btn primary" href="#/ventas">Importar liquidaciones</a></div>
  </div></section>`;
}

function filtersHtml(all) {
  const cats = uniq(all.map((e) => e.category));
  const prods = uniq(all.map((e) => e.product));
  const active = state.from || state.to || state.category || state.product;
  return `<section class="card">
    <form class="filters fc-filters" data-fc-form>
      <label class="date-filter"><span>Emitido desde</span><input type="date" name="from" value="${esc(state.from)}"></label>
      <label class="date-filter"><span>hasta</span><input type="date" name="to" value="${esc(state.to)}"></label>
      <select name="category" aria-label="Categoría">
        <option value="">Todas las categorías</option>
        ${cats.map((c) => `<option value="${esc(c)}" ${c === state.category ? "selected" : ""}>${esc(c)}</option>`).join("")}
      </select>
      <select name="product" aria-label="Producto">
        <option value="">Todos los productos</option>
        ${prods.map((p) => `<option value="${esc(p)}" ${p === state.product ? "selected" : ""}>${esc(p)}</option>`).join("")}
      </select>
      ${active ? `<button type="button" class="btn sm ghost" data-fc-reset>Quitar filtros</button>` : ""}
      <div class="spacer"></div>
      <span class="tag">Periodo por fecha de emisión del documento</span>
    </form>
  </section>`;
}

function kpisHtml(s) {
  return `<section class="kpis">
    <article class="kpi is-brand">
      <div class="kpi-label"><span class="dot"></span>Kilos liquidados</div>
      <div class="kpi-value">${isNum(s.kg) ? fmtNum(s.kg, 2) : "—"}</div>
      <div class="kpi-foot">kg en las líneas con peso conocido</div>
    </article>
    <article class="kpi">
      <div class="kpi-label"><span class="dot"></span>Importe de fruta</div>
      <div class="kpi-value">${isNum(s.amount) ? fmtEUR(s.amount) : "—"}</div>
      <div class="kpi-foot">${s.unknownAmountCount ? `<strong>${s.unknownAmountCount}</strong> ${s.unknownAmountCount === 1 ? "línea" : "líneas"} sin importe conocido` : "todas las líneas con importe conocido"}</div>
    </article>
    <article class="kpi is-paid">
      <div class="kpi-label"><span class="dot"></span>Precio medio ponderado</div>
      <div class="kpi-value">${isNum(s.averagePrice) ? fmtNum(s.averagePrice, 4) : "—"}</div>
      <div class="kpi-foot">${isNum(s.averagePrice) ? `€/kg · importe entre ${fmtNum(s.pricedKg, 2)} kg con importe` : "sin importe y kilos conocidos"}</div>
    </article>
    <article class="kpi">
      <div class="kpi-label"><span class="dot"></span>Liquidaciones</div>
      <div class="kpi-value">${s.count}</div>
      <div class="kpi-foot">documentos distintos en el filtro</div>
    </article>
  </section>`;
}

function warningsHtml(s, entries) {
  const flagged = entries.filter((e) => e.warning).length;
  const list = Array.isArray(s.warnings) ? s.warnings : [];
  if (!list.length && !flagged) return "";
  return `<div class="summary-box warn fc-warn" role="note"><div>
    <strong>Revisa el origen antes de fiarte de estas cifras.</strong>
    ${flagged ? ` ${flagged} ${flagged === 1 ? "línea tiene" : "líneas tienen"} detalle dudoso o incompleto en el documento guardado.` : ""}
    ${list.length ? `<ul>${list.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}
  </div></div>`;
}

function groupTable(rows, labelHead, labelOf) {
  const body = rows
    .map(
      (r) => `<tr>
      <td class="strong">${labelOf(r)}</td>
      <td class="num">${kgText(r.kg)}</td>
      <td class="num">${eurText(r.amount)}</td>
      <td class="num">${priceText(r.averagePrice)}</td>
      <td class="num">${r.count}</td>
    </tr>`
    )
    .join("");
  return `<div class="table-wrap"><table class="data">
    <thead><tr><th>${labelHead}</th><th class="num">Kilos</th><th class="num">Importe</th><th class="num">Precio pond.</th><th class="num">Docs.</th></tr></thead>
    <tbody>${body || `<tr><td colspan="5" class="muted">Sin datos.</td></tr>`}</tbody>
  </table></div>`;
}

function detailHtml(entries) {
  const rows = entries
    .slice()
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
    .map(
      (e) => `<tr>
      <td class="num">${e.date ? fmtDate(e.date) : `<span class="muted">Sin fecha</span>`}</td>
      <td><div class="cell-main"><span class="name mono">${esc(e.number || "Sin número")}</span><span class="sub">${esc(e.buyer || "Sin comprador")}</span></div></td>
      <td>${esc(e.product || "—")}</td>
      <td><span class="tag">${esc(e.category || "Sin categoría")}</span></td>
      <td class="num">${kgText(e.kg)}</td>
      <td class="num">${priceWide(e.price)}</td>
      <td class="num strong">${eurText(e.amount)}${e.warning ? `<div><span class="fc-flag">${esc(e.warning)}</span></div>` : ""}</td>
    </tr>`
    )
    .join("");
  return `<div class="table-wrap"><table class="data">
    <thead><tr><th>Emisión</th><th>Documento · comprador</th><th>Producto</th><th>Categoría</th><th class="num">Kilos</th><th class="num">Precio línea</th><th class="num">Importe</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

function csvOf(entries) {
  const head = ["Fecha emision", "Documento", "Comprador", "Producto", "Categoria", "Kg", "Precio EUR/kg", "Importe EUR", "Aviso"];
  const lines = entries.map((e) =>
    [e.date || "", e.number || "", e.buyer || "", e.product || "", e.category || "", csvNum(e.kg, 3), csvNum(e.price, 6), csvNum(e.amount, 2), e.warning || ""]
      .map(csvCell)
      .join(";")
  );
  return "\ufeff" + [head.join(";"), ...lines].join("\r\n");
}

export function renderFruitControl(container, invoices) {
  if (!container) return;
  const list = Array.isArray(invoices) ? invoices : [];
  let all = [];
  try {
    all = fruitEntries(list, { from: "", to: "", category: "", product: "" }) || [];
  } catch (err) {
    container.innerHTML = `<section class="card"><div class="empty"><h3>No se pudo leer la fruta guardada</h3><p>${esc(err && err.message ? err.message : "Error desconocido")}</p></div></section>`;
    return;
  }
  if (!all.length) {
    container.innerHTML = emptyAll();
    return;
  }

  const entries = fruitEntries(list, { ...state }) || [];
  const stats = fruitStats(entries);
  const cats = (stats.categories || []).slice().sort((a, b) => (b.kg || 0) - (a.kg || 0));
  const months = (stats.months || []).slice().sort((a, b) => String(a.month || "").localeCompare(String(b.month || "")));

  const results = entries.length
    ? `${kpisHtml(stats)}
      ${warningsHtml(stats, entries)}
      <div class="fc-split">
        <section class="card">
          <div class="card-head"><div><h2>Por categoría</h2><p>Precio = importe / kilos con importe conocido</p></div></div>
          ${groupTable(cats, "Categoría", (r) => esc(r.category || "Sin categoría"))}
        </section>
        <section class="card">
          <div class="card-head"><div><h2>Por mes de emisión</h2><p>Según la fecha del documento, no de la cosecha</p></div></div>
          ${groupTable(months, "Mes", (r) => esc(monthName(r.month)))}
        </section>
      </div>
      <section class="card">
        <div class="card-head">
          <div><h2>Detalle trazable</h2><p>${entries.length} ${entries.length === 1 ? "línea" : "líneas"} de ${stats.count} ${stats.count === 1 ? "liquidación" : "liquidaciones"}</p></div>
          <div class="spacer"></div>
          <button type="button" class="btn sm ghost" data-fc-export>Exportar CSV</button>
        </div>
        ${detailHtml(entries)}
      </section>`
    : `<section class="card"><div class="empty">
        <h3>Nada con esos filtros</h3>
        <p>Prueba otro periodo de emisión, otra categoría u otro producto.</p>
        <div class="e-actions"><button type="button" class="btn" data-fc-reset>Quitar filtros</button></div>
      </div></section>`;

  container.innerHTML = `${scopedCss()}<div class="stack">${filtersHtml(all)}${results}</div>`;

  const rerender = () => renderFruitControl(container, invoices);
  const form = container.querySelector("[data-fc-form]");
  if (form) {
    form.addEventListener("submit", (e) => e.preventDefault());
    form.addEventListener("change", (e) => {
      const t = e.target;
      if (!t || !t.name || !(t.name in state)) return;
      state[t.name] = String(t.value || "");
      rerender();
    });
  }
  container.querySelectorAll("[data-fc-reset]").forEach((b) =>
    b.addEventListener("click", () => {
      state.from = state.to = state.category = state.product = "";
      rerender();
    })
  );
  const exp = container.querySelector("[data-fc-export]");
  if (exp) {
    exp.addEventListener("click", () => {
      const tag = [state.from, state.to].filter(Boolean).join("_a_") || "todo";
      downloadText(`control-fruta-${tag}.csv`, csvOf(entries));
    });
  }
}
