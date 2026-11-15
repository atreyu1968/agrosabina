/*
* Las pantallas del sitio y lo que hace cada botón.
*/
import { IGIC_RATES, STATUS, daysUntil, downloadBytes, downloadText, esc, fmtDate, fmtEUR, fmtNum, initials, lastMonths, monthKey, monthLabel, parseAmount, round2, todayISO } from "./util.js";
import { addInvoice, addMessage, clearAll, deleteInvoice, deleteMessage, deleteSupplier, ensureSupplier, exportJSON, findDuplicate, findSupplierByNameOrNif, getState, setInvoiceStatus, importJSON, invoicesOf, markMessageUsed, messages, seedDemo, setInvoiceStatus, sortedInvoices, statsBySupplier, supplierById, toggleInvoiceStatus, totals, updateInvoice, updateSettings, updateSupplier, exportSqliteBytes, sqliteIgicSummary, storageInfo } from "./store.js";
import { parseInvoiceText, parseKg, parseLiquidacion, parsePrice, looksLikeInvoice } from "./parse.js";
import { describeFile, readFile, sourceLabel } from "./read.js";
import { cameraSupported, openCamera } from "./camera.js";
import { categoryInfo, categoryOptions, directionOf, kindInfo, kindOptions } from "./model.js";
import { AI_DEFAULTS, AI_PROVIDERS, aiConfigured, aiExtract, aiPing, aiProviderOf, classifyDocument } from "./ai.js";
import { isEmailFile, looksLikeInvoiceMail, parseEml } from "./mail.js";
import { asientosDe, balanceSituacion, balanceSumasYSaldos, cuentaResultados, libroMayor } from "./accounting.js";
import { closeModal, confirmDialog, icon, modalIsOpen, openModal, toast } from "./dom.js";
/* ------------------------------------------------------------------ */
/* Estado de la interfaz                                              */
/* ------------------------------------------------------------------ */
export const ui = {
	route: "resumen",
	filters: {
		status: "all",
		supplier: "",
		q: "",
		direction: "all"
	},
	supplierQuery: "",
	jobs: [],
	// Pantalla de ventas: periodo elegido y fechas a mano.
	sales: {
		range: "year",
		from: "",
		to: ""
	},
	// Pantalla de contabilidad: qué libro se mira y de qué fechas.
	conta: {
		tab: "diario",
		range: "year",
		from: "",
		to: ""
	}
};
const ROUTES = [
	"resumen",
	"ventas",
	"contabilidad",
	"compras",
	"proveedores",
	"correo",
	"importar"
];
/* ------------------------------------------------------------------ */
/* Utilidades de pintado                                              */
/* ------------------------------------------------------------------ */
/**
* Pregunta la fecha del cobro (o del pago) antes de marcar un documento.
* Viene puesta la de hoy, que es lo normal; se puede cambiar.
*/
function askPaidDate(inv, isIncome, onSave) {
	const today = todayISO();
	openModal(`<div class="modal-head">
      <div>
        <h2>${isIncome ? "¿Cuándo lo has cobrado?" : "¿Cuándo lo has pagado?"}</h2>
        <p>${esc(inv.number || "Sin número")} · ${esc(supplierName(inv.supplierId))} · ${fmtEUR(inv.total)}</p>
      </div>
      <button class="icon-btn" data-modal-cancel aria-label="Cerrar">${icon("x")}</button>
    </div>
    <div class="modal-body">
      <div class="field">
        <label for="paid-date">Fecha ${isIncome ? "del cobro" : "del pago"}</label>
        <input id="paid-date" type="date" value="${esc(today)}">
        <span class="hint">Se guarda con el documento y sale en su ficha y en los listados. Puedes cambiarla después.</span>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn primary" data-ok>Guardar la fecha</button>
      <button class="btn ghost" data-modal-cancel>Cancelar</button>
    </div>`, { onMount(wrap) {
		wrap.querySelectorAll("[data-modal-cancel]").forEach((b) => b.addEventListener("click", () => closeModal()));
		const input = wrap.querySelector("#paid-date");
		const go = () => {
			const day = String(input && input.value || "").slice(0, 10) || today;
			closeModal();
			onSave(day);
		};
		wrap.querySelector("[data-ok]").addEventListener("click", go);
		if (input) {
			input.addEventListener("keydown", (e) => {
				if (e.key === "Enter") go();
			});
			setTimeout(() => input.focus(), 40);
		}
	} });
}
function statusPill(inv, interactive = true) {
	const paid = inv.status === STATUS.PAID;
	const cls = paid ? "paid" : "pending";
	const isIncome = directionOf(inv.kind) === "INGRESO";
	const label = paid ? isIncome ? "Cobrado" : "Pagado" : "Pendiente";
	const day = paid && inv.paidDate ? fmtDate(inv.paidDate) : "";
	if (!interactive) {
		return `<span class="status static ${cls}" ${day ? `title="${isIncome ? "Cobrado" : "Pagado"} el ${day}"` : ""}>${label}${day ? `<span class="status-day">${esc(day)}</span>` : ""}</span>`;
	}
	const nextLabel = paid ? "pendiente" : isIncome ? "cobrado" : "pagado";
	return `<button class="status ${cls}" data-action="toggle-status" data-id="${inv.id}"
    title="${day ? `${isIncome ? "Cobrado" : "Pagado"} el ${day}. ` : ""}Cambiar a ${nextLabel}">${label}${day ? `<span class="status-day">${esc(day)}</span>` : ""}</button>`;
}
function supplierName(id) {
	const s = supplierById(id);
	return s ? s.name : "Sin proveedor";
}
function rateText(rate) {
	return Number.isFinite(rate) ? `${fmtNum(rate, rate % 1 === 0 ? 0 : 1)} %` : "—";
}
/** Etiqueta corta del tipo y del concepto, para las listas. */
function tagOf(inv) {
	const kind = kindInfo(inv.kind);
	const cat = categoryInfo(inv.category);
	const isIn = inv.direction === "INGRESO";
	const cls = isIn ? "tag is-in" : "tag";
	const label = inv.category && cat.id ? `${kind.short} · ${cat.label}` : kind.short;
	return `<span class="${cls}">${isIn ? "+" : "−"} ${esc(label)}</span>`;
}
/** Cómo se reparte el gasto por concepto (agua, luz, laborales…). */
function categoryCard(t) {
	const rows = Object.entries(t.byCategory).map(([id, row]) => ({
		id,
		...row
	})).filter((r) => r.total > 0).sort((a, b) => b.total - a.total).slice(0, 8);
	if (!rows.length) return "";
	const max = Math.max(...rows.map((r) => r.total), 1);
	return `
    <section class="card">
      <div class="card-head">
        <div>
          <h2>En qué se va el dinero</h2>
          <p>Gastos e ingresos agrupados por concepto</p>
        </div>
        <div class="spacer"></div>
        <a class="btn sm ghost" href="#/compras">Ver documentos ${icon("arrow")}</a>
      </div>
      <div class="card-body">
        <div class="cat-list">
          ${rows.map((r) => {
		const info = categoryInfo(r.id === "SIN" ? "" : r.id);
		const isIn = r.direction === "INGRESO";
		return `<div class="cat-row">
                <div class="cat-name">${esc(info.label)}${isIn ? " <span class=\"tag is-in\">ingreso</span>" : ""}</div>
                <div class="cat-track"><i class="${isIn ? "is-in" : ""}" style="width:${Math.max(3, Math.round(r.total / max * 100))}%"></i></div>
                <div class="cat-num">${fmtEUR(r.total)}</div>
              </div>`;
	}).join("")}
        </div>
      </div>
    </section>`;
}
/* ------------------------------------------------------------------ */
/* Pintado general                                                    */
/* ------------------------------------------------------------------ */
/** Lo que se ve mientras se abre la base de datos. */
export function renderLoading() {
	const view = document.getElementById("view");
	if (!view) return;
	const meta = pageMeta(ROUTES.includes(ui.route) ? ui.route : "resumen");
	const title = document.getElementById("viewTitle");
	const sub = document.getElementById("viewSub");
	if (title) title.textContent = meta.title;
	if (sub) sub.textContent = meta.sub;
	view.innerHTML = `<section class="card"><div class="empty">
    <div class="spinner big" style="margin:0 auto 14px"></div>
    <h3>Abriendo tu base de datos</h3>
    <p>Un momento: preparo las tablas de proveedores y facturas.</p>
  </div></section>`;
}
export function render() {
	const route = ROUTES.includes(ui.route) ? ui.route : "resumen";
	ui.route = route;
	document.querySelectorAll(".nav a").forEach((a) => {
		a.classList.toggle("active", a.dataset.route === route);
	});
	const meta = pageMeta(route);
	document.getElementById("viewTitle").textContent = meta.title;
	document.getElementById("viewSub").textContent = meta.sub;
	document.getElementById("topActions").innerHTML = topActions(route);
	const view = document.getElementById("view");
	if (route === "resumen") view.innerHTML = viewResumen();
	else if (route === "ventas") view.innerHTML = viewVentas();
	else if (route === "contabilidad") view.innerHTML = viewContabilidad();
	else if (route === "compras") view.innerHTML = viewFacturas();
	else if (route === "proveedores") view.innerHTML = viewProveedores();
	else if (route === "correo") view.innerHTML = viewCorreo();
	else view.innerHTML = viewImportar();
	updateNavBadge();
}
function updateNavBadge() {
	const t = totals(getState().invoices);
	const badge = document.getElementById("navPending");
	if (!badge) return;
	if (t.pendingCount > 0) {
		badge.hidden = false;
		badge.textContent = String(t.pendingCount);
	} else {
		badge.hidden = true;
	}
}
function pageMeta(route) {
	const t = totals(getState().invoices);
	const supCount = getState().suppliers.length;
	switch (route) {
		case "ventas": {
			const list = salesDocs();
			const s = salesStats(list);
			return {
				title: "Ventas e ingresos",
				sub: `${salesWindow().label} · ${fmtNum(Math.round(s.kg))} kg vendidos · ${fmtEUR(s.money)} de ingresos`
			};
		}
		case "contabilidad": {
			const e = asientosContables();
			const pyg = cuentaResultados(libroMayor(e));
			return {
				title: "Contabilidad",
				sub: `${contaWindow().label} · ${e.length} ${e.length === 1 ? "asiento" : "asientos"} · resultado ${fmtEUR(pyg.resultado)}`
			};
		}
		case "compras": return {
			title: "Compras",
			sub: `${t.expenseCount} ${t.expenseCount === 1 ? "compra" : "compras"} y ${t.incomeCount} ${t.incomeCount === 1 ? "ingreso" : "ingresos"} · ${t.pendingCount} sin pagar`
		};
		case "proveedores": return {
			title: "Proveedores",
			sub: `${supCount} ${supCount === 1 ? "proveedor" : "proveedores"} en tu lista`
		};
		case "correo": {
			const count = messages().length;
			return {
				title: "Correo",
				sub: count === 0 ? "Trae aquí los correos con facturas o liquidaciones" : `${count} ${count === 1 ? "correo guardado" : "correos guardados"} en el buzón`
			};
		}
		case "importar": return {
			title: "Importar documentos",
			sub: "Sube una foto o un PDF y yo relleno los datos"
		};
		default: {
			const who = (getState().settings.businessName || "Agrosabina SL").trim();
			const pending = t.pendingCount > 0 ? `Tienes ${fmtEUR(t.pending)} pendientes de pago` : "Todo al día. Nada pendiente de pago.";
			return {
				title: "Resumen",
				sub: `${who} · ${pending}`
			};
		}
	}
}
function topActions(route) {
	if (route === "ventas") {
		return `
      <button class="btn" data-action="export-sales-csv">${icon("download")}<span>Exportar</span></button>
      <button class="btn" data-action="new-sale">${icon("edit")}<span>Añadir a mano</span></button>
      <button class="btn primary" data-action="import-files">${icon("upload")}<span>Subir liquidación</span></button>`;
	}
	if (route === "contabilidad") {
		return `
      <button class="btn" data-action="acc-apertura">${icon("gear")}<span>Datos de partida</span></button>
      <button class="btn" data-action="export-acc-csv">${icon("download")}<span>Exportar</span></button>`;
	}
	if (route === "compras") {
		return `
      <button class="btn" data-action="export-csv">${icon("download")}<span>Exportar</span></button>
      <button class="btn primary" data-action="new-invoice">${icon("plus")}<span>Nueva compra</span></button>`;
	}
	if (route === "proveedores") {
		return `<button class="btn primary" data-action="new-supplier">${icon("plus")}<span>Nuevo proveedor</span></button>`;
	}
	if (route === "importar") {
		return `<button class="btn" data-action="new-invoice">${icon("edit")}<span>Añadir a mano</span></button>`;
	}
	if (route === "correo") {
		return `
      <button class="btn" data-action="settings" aria-label="Ajustes">${icon("gear")}<span>Ajustes</span></button>
      <button class="btn primary" data-action="import-email">${icon("mail")}<span>Añadir correo</span></button>`;
	}
	return `
    <button class="btn" data-action="settings" aria-label="Ajustes">${icon("gear")}<span>Ajustes</span></button>
    <button class="btn primary" data-action="import-files">${icon("upload")}<span>Importar factura</span></button>`;
}
/* ------------------------------------------------------------------ */
/* Resumen                                                            */
/* ------------------------------------------------------------------ */
function viewResumen() {
	const state = getState();
	const invs = state.invoices;
	if (!invs.length) return emptyResumen();
	const t = totals(invs);
	const months = lastMonths(6);
	const byMonth = new Map(months.map((m) => [m, {
		paid: 0,
		pending: 0
	}]));
	for (const inv of invs) {
		const k = monthKey(inv.issueDate);
		const row = byMonth.get(k);
		if (!row) continue;
		const amount = Number(inv.total) || 0;
		if (inv.status === STATUS.PAID) row.paid += amount;
		else row.pending += amount;
	}
	const monthMax = Math.max(1, ...months.map((m) => byMonth.get(m).paid + byMonth.get(m).pending));
	const latest = sortedInvoices(invs).slice(0, 5);
	const upcoming = invs.filter((i) => i.status === STATUS.PENDING).sort((a, b) => (a.dueDate || a.issueDate || "9999").localeCompare(b.dueDate || b.issueDate || "9999")).slice(0, 5);
	const bySupplier = statsBySupplier();
	const topSuppliers = [...bySupplier.entries()].filter(([, s]) => s.pending > 0).sort((a, b) => b[1].pending - a[1].pending).slice(0, 4);
	return `
  <div class="stack">
    <section class="kpis">
      <article class="kpi">
        <div class="kpi-label"><span class="dot"></span>Total facturado</div>
        <div class="kpi-value">${fmtEUR(t.total)}</div>
        <div class="kpi-foot">${t.count} ${t.count === 1 ? "factura" : "facturas"} de ${state.suppliers.length} proveedores</div>
      </article>
      <article class="kpi is-brand">
        <div class="kpi-label"><span class="dot"></span>Pendiente de pago</div>
        <div class="kpi-value">${fmtEUR(t.pending)}</div>
        <div class="kpi-foot">${t.pendingCount === 0 ? "Nada pendiente" : `${t.pendingCount} ${t.pendingCount === 1 ? "documento" : "documentos"}${t.overdueCount ? ` · ${t.overdueCount} vencida${t.overdueCount === 1 ? "" : "s"}` : ""}`}</div>
      </article>
      <article class="kpi is-paid">
        <div class="kpi-label"><span class="dot"></span>Pagado</div>
        <div class="kpi-value">${fmtEUR(t.paid)}</div>
        <div class="kpi-foot">${t.paidCount} ${t.paidCount === 1 ? "documento" : "documentos"}</div>
      </article>
      <article class="kpi">
        <div class="kpi-label"><span class="dot"></span>IGIC soportado</div>
        <div class="kpi-value">${fmtEUR(t.igic)}</div>
        <div class="kpi-foot">${fmtEUR(t.igicPending)} en documentos pendientes</div>
      </article>
      <article class="kpi is-income">
        <div class="kpi-label"><span class="dot"></span>Ingresos · fruta y subvenciones</div>
        <div class="kpi-value">${fmtEUR(t.income)}</div>
        <div class="kpi-foot">${t.incomeCount} ${t.incomeCount === 1 ? "documento" : "documentos"} · ${fmtEUR(t.incomePending)} por cobrar</div>
      </article>
      <article class="kpi is-expense">
        <div class="kpi-label"><span class="dot"></span>Gastos</div>
        <div class="kpi-value">${fmtEUR(t.expense)}</div>
        <div class="kpi-foot">${t.expenseCount} ${t.expenseCount === 1 ? "documento" : "documentos"} · ${fmtEUR(t.expensePending)} por pagar</div>
      </article>
      <article class="kpi">
        <div class="kpi-label"><span class="dot"></span>Resultado</div>
        <div class="kpi-value">${fmtEUR(round2(t.income - t.expense))}</div>
        <div class="kpi-foot">Ingresos menos gastos de lo registrado</div>
      </article>
    </section>

    ${categoryCard(t)}

    <div class="two-col">
      <section class="card">
        <div class="card-head">
          <div>
            <h2>Últimos documentos</h2>
            <p>Lo último que ha entrado</p>
          </div>
          <div class="spacer"></div>
          <a class="btn sm ghost" href="#/compras">Ver todas ${icon("arrow")}</a>
        </div>
        <div class="table-wrap">
          <table class="data">
            <thead>
              <tr>
                <th>Proveedor</th><th>Factura</th><th>Fecha</th>
                <th class="num">Total</th><th>Estado</th>
              </tr>
            </thead>
            <tbody>
              ${latest.map((inv) => `
                <tr data-id="${inv.id}">
                  <td><div class="cell-main"><span class="name">${esc(supplierName(inv.supplierId))}</span></div></td>
                  <td class="mono">${esc(inv.number || "—")}</td>
                  <td class="num">${fmtDate(inv.issueDate)}</td>
                  <td class="num strong">${fmtEUR(inv.total)}</td>
                  <td>${statusPill(inv)}</td>
                </tr>`).join("")}
            </tbody>
          </table>
        </div>
      </section>

      <div class="stack">
        <section class="card">
          <div class="card-head">
            <div>
              <h2>Próximos vencimientos</h2>
              <p>Lo que toca pagar antes</p>
            </div>
          </div>
          ${upcoming.length ? `<div class="mini-list">
            ${upcoming.map((inv) => {
		const d = daysUntil(inv.dueDate);
		const when = inv.dueDate ? d < 0 ? `Vencida hace ${Math.abs(d)} días` : d === 0 ? "Vence hoy" : `Vence en ${d} días` : `Emitida el ${fmtDate(inv.issueDate)}`;
		return `<div class="mini-row">
                <div class="m-main">
                  <div class="t">${esc(supplierName(inv.supplierId))}</div>
                  <div class="s">${esc(when)}</div>
                </div>
                <div class="num">${fmtEUR(inv.total)}</div>
              </div>`;
	}).join("")}
          </div>` : `<div class="empty" style="padding:30px 18px">
            <h3>Nada pendiente</h3>
            <p>Todas las facturas están pagadas.</p>
          </div>`}
        </section>

        <section class="card">
          <div class="card-head">
            <div>
              <h2>Últimos 6 meses</h2>
              <p>Pagado y pendiente por mes</p>
            </div>
            <div class="spacer"></div>
            <div class="legend">
              <span><i class="l-paid"></i>Pagado</span>
              <span><i class="l-pending"></i>Pendiente</span>
            </div>
          </div>
          <div class="card-body">
            <div class="bars">
              ${months.map((m) => {
		const row = byMonth.get(m);
		const paidH = Math.round(row.paid / monthMax * 100);
		const pendingH = Math.round(row.pending / monthMax * 100);
		const title = `${monthLabel(m)}: ${fmtEUR(row.paid)} pagado, ${fmtEUR(row.pending)} pendiente`;
		return `<div class="bar-col" title="${esc(title)}">
                  <div class="bar-stack">
                    <div class="bar pending" style="height:${pendingH}%"></div>
                    <div class="bar paid" style="height:${paidH}%"></div>
                  </div>
                  <div class="bar-label">${monthLabel(m)}</div>
                </div>`;
	}).join("")}
            </div>
          </div>
        </section>
      </div>
    </div>

    ${topSuppliers.length ? `
    <section class="card">
      <div class="card-head">
        <div>
          <h2>Proveedores con más pendiente</h2>
          <p>A quién tienes que pagar antes</p>
        </div>
        <div class="spacer"></div>
        <a class="btn sm ghost" href="#/proveedores">Ver proveedores ${icon("arrow")}</a>
      </div>
      <div class="mini-list">
        ${topSuppliers.map(([id, s]) => `
          <div class="mini-row">
            <div class="avatar" style="width:30px;height:30px;border-radius:9px;font-size:12px">${esc(initials(supplierName(id)))}</div>
            <div class="m-main">
              <div class="t">${esc(supplierName(id))}</div>
              <div class="s">${s.countPending} sin pagar de ${s.count} facturas</div>
            </div>
            <div class="num">${fmtEUR(s.pending)}</div>
          </div>`).join("")}
      </div>
    </section>` : ""}
  </div>`;
}
function emptyResumen() {
	return `
  <div class="stack">
    <section class="card">
      <div class="empty" style="padding:54px 24px">
        <div class="e-icon">${icon("sparkle")}</div>
        <h3>Empieza con tu primera factura</h3>
        <p>Sube una foto o un PDF de una factura y la leo yo: proveedor, número, fecha, base, IGIC y total. Después solo tienes que comprobar que está bien.</p>
        <div class="e-actions">
          <button class="btn primary" data-action="import-files">${icon("upload")} Subir una factura</button>
          <button class="btn" data-action="new-invoice">${icon("edit")} Escribirla a mano</button>
          <button class="btn ghost" data-action="seed-demo">Ver con datos de ejemplo</button>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-head">
        <div>
          <h2>Cómo funciona</h2>
          <p>Tres pasos y la factura queda guardada</p>
        </div>
      </div>
      <div class="card-body">
        <div class="howto">
          <div class="step">
            <div class="n">1</div>
            <h4>Sube la factura</h4>
            <p>Una foto del móvil, un escaneo o el PDF que te ha mandado el proveedor.</p>
          </div>
          <div class="step">
            <div class="n">2</div>
            <h4>Revisa lo que he leído</h4>
            <p>Relleno proveedor, número, fechas, base, IGIC y total. Puedes corregir cualquier cosa.</p>
          </div>
          <div class="step">
            <div class="n">3</div>
            <h4>Marca pagado o pendiente</h4>
            <p>Con un clic cambias el estado. El resumen te dice cuánto debes y cuánto IGIC llevas.</p>
          </div>
        </div>
      </div>
    </section>
  </div>`;
}
/* ------------------------------------------------------------------ */
/* Ventas e ingresos                                                  */
/* ------------------------------------------------------------------ */
const SALES_RANGES = [
	{
		id: "year",
		label: "Este año"
	},
	{
		id: "quarter",
		label: "Este trimestre"
	},
	{
		id: "month",
		label: "Este mes"
	},
	{
		id: "campaign",
		label: "Últimos 12 meses"
	},
	{
		id: "all",
		label: "Todo lo registrado"
	},
	{
		id: "custom",
		label: "Elegir fechas"
	}
];
/** El periodo que se está mirando: fechas desde/hasta y su nombre. */
function salesWindow() {
	return windowFor(ui.sales);
}
/** Lo mismo, para cualquier pantalla que elija un periodo. */
function windowFor(state) {
	const now = new Date();
	const y = now.getFullYear();
	const two = (n) => String(n).padStart(2, "0");
	const today = todayISO();
	const monthFrom = `${y}-${two(now.getMonth() + 1)}-01`;
	const quarterFrom = `${y}-${two(Math.floor(now.getMonth() / 3) * 3 + 1)}-01`;
	const yearAgo = `${y - 1}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
	const range = state.range;
	if (range === "month") return {
		id: range,
		from: monthFrom,
		to: today,
		label: "Este mes"
	};
	if (range === "quarter") return {
		id: range,
		from: quarterFrom,
		to: today,
		label: "Este trimestre"
	};
	if (range === "campaign") return {
		id: range,
		from: yearAgo,
		to: today,
		label: "Últimos 12 meses"
	};
	if (range === "all") return {
		id: range,
		from: "",
		to: "",
		label: "Todo lo registrado"
	};
	if (range === "custom") {
		const from = state.from || "";
		const to = state.to || "";
		const label = from && to ? `Del ${fmtDate(from)} al ${fmtDate(to)}` : from ? `Desde el ${fmtDate(from)}` : to ? `Hasta el ${fmtDate(to)}` : "Elige las fechas";
		return {
			id: range,
			from,
			to,
			label
		};
	}
	return {
		id: "year",
		from: `${y}-01-01`,
		to: today,
		label: "Este año"
	};
}
function inSalesWindow(date, w) {
	const d = date || "";
	if (w.from && (!d || d < w.from)) return false;
	if (w.to && (!d || d > w.to)) return false;
	return true;
}
/** Todo lo que entra: liquidaciones de fruta, subvenciones, cobros… */
function isIncomeDoc(inv) {
	return (inv.direction || directionOf(inv.kind || "FACTURA")) === "INGRESO";
}
function salesDocs() {
	const w = salesWindow();
	return getState().invoices.filter(isIncomeDoc).filter((inv) => inSalesWindow(inv.issueDate, w)).sort((a, b) => String(b.issueDate || "").localeCompare(String(a.issueDate || "")));
}
/** Kilos, precio por kilo, descuentos, bruto y líquido de un documento. */
function liquidacionNumbers(inv) {
	const liq = inv.liquidacion;
	const kg = liq && Number.isFinite(Number(liq.kg)) ? Number(liq.kg) : 0;
	const price = liq && Number.isFinite(Number(liq.price)) ? Number(liq.price) : 0;
	const discounts = liq && Array.isArray(liq.discounts) ? round2(liq.discounts.reduce((a, d) => a + (Number(d.amount) || 0), 0)) : 0;
	const gross = kg > 0 && price > 0 ? round2(kg * price) : 0;
	const net = gross > 0 ? round2(gross - discounts) : Number(inv.base) || 0;
	return {
		kg,
		price,
		discounts,
		gross,
		net: round2(net)
	};
}
function salesStats(list) {
	const s = {
		count: 0,
		kg: 0,
		gross: 0,
		discounts: 0,
		net: 0,
		money: 0,
		paid: 0,
		pending: 0,
		withKg: 0,
		byProduct: new Map(),
		byCategory: new Map(),
		byBuyer: new Map(),
		byMonth: new Map(),
		buyers: new Set()
	};
	const bump = (map, key) => {
		let row = map.get(key);
		if (!row) {
			row = {
				key,
				count: 0,
				kg: 0,
				gross: 0,
				net: 0
			};
			map.set(key, row);
		}
		return row;
	};
	for (const inv of list) {
		const num = liquidacionNumbers(inv);
		const amount = Number(inv.total) || 0;
		s.count += 1;
		s.money += amount;
		if (inv.status === STATUS.PAID) s.paid += amount;
		else s.pending += amount;
		if (inv.supplierId) s.buyers.add(inv.supplierId);
		s.kg += num.kg;
		s.gross += num.gross;
		s.discounts += num.discounts;
		s.net += num.net;
		if (num.kg > 0) s.withKg += 1;
		const liq = inv.liquidacion || {};
		const product = String(liq.product || "").trim() || "Sin producto";
		const category = String(liq.category || "").trim() || "Sin categoría";
		const buyer = supplierName(inv.supplierId);
		const groups = [
			[s.byProduct, product],
			[s.byCategory, category],
			[s.byBuyer, buyer]
		];
		for (const [map, key] of groups) {
			const row = bump(map, key);
			row.count += 1;
			row.kg += num.kg;
			row.gross += num.gross;
			row.net += num.net;
		}
		const mk = monthKey(inv.issueDate);
		if (mk) {
			const row = bump(s.byMonth, mk);
			row.count += 1;
			row.kg += num.kg;
			row.gross += num.gross;
			row.net += num.net;
		}
	}
	s.kg = round2(s.kg);
	s.gross = round2(s.gross);
	s.discounts = round2(s.discounts);
	s.net = round2(s.net);
	s.money = round2(s.money);
	s.paid = round2(s.paid);
	s.pending = round2(s.pending);
	s.avgPrice = s.kg > 0 ? s.gross / s.kg : 0;
	s.avgKg = s.withKg > 0 ? s.kg / s.withKg : 0;
	s.buyerCount = s.buyers.size;
	return s;
}
/** Tabla de acumulados: kilos, precio medio y líquido por grupo. */
function salesGroupTable(rows, headLabel) {
	if (!rows.length) return "";
	const maxKg = Math.max(...rows.map((r) => r.kg), 1);
	return `<div class="table-wrap">
    <table class="data">
      <thead>
        <tr>
          <th>${headLabel}</th>
          <th class="num">Liquidaciones</th>
          <th class="num">Kilos</th>
          <th class="num">€/kg medio</th>
          <th class="num">Líquido</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((r) => `<tr>
          <td>
            <span class="name">${esc(r.key)}</span>
            <div class="cat-track" style="width:100%;margin-top:6px"><i style="width:${Math.max(3, Math.round(r.kg / maxKg * 100))}%"></i></div>
          </td>
          <td class="num">${r.count}</td>
          <td class="num">${fmtNum(Math.round(r.kg))} kg</td>
          <td class="num">${r.kg > 0 ? `${fmtNum(r.gross / r.kg, 3)} €` : "<span class=\"muted\">—</span>"}</td>
          <td class="num strong">${fmtEUR(r.net)}</td>
        </tr>`).join("")}
      </tbody>
    </table>
  </div>`;
}
function salesRangeBar(w) {
	return `
    <div class="filters">
      <select id="salesRange" aria-label="Elegir el periodo">
        ${SALES_RANGES.map((r) => `<option value="${r.id}" ${ui.sales.range === r.id ? "selected" : ""}>${r.label}</option>`).join("")}
      </select>
      ${ui.sales.range === "custom" ? `
        <label class="date-filter"><span>Desde</span><input id="salesFrom" type="date" value="${esc(ui.sales.from)}" aria-label="Desde"></label>
        <label class="date-filter"><span>Hasta</span><input id="salesTo" type="date" value="${esc(ui.sales.to)}" aria-label="Hasta"></label>` : ""}
      <div class="spacer"></div>
      <span class="tag kind">${esc(w.label)}</span>
    </div>`;
}
function viewVentas() {
	const w = salesWindow();
	const list = salesDocs();
	const s = salesStats(list);
	const drop = `
    <section class="card">
      <div class="card-body">
        <div id="dropzone" class="dropzone">
          <div class="dz-icon">${icon("upload")}</div>
          <h3>Sube aquí las liquidaciones</h3>
          <p>Fotos o PDF de la liquidación de fruta, varios a la vez. Leo los kilos, el precio por kilo y los descuentos, y quedan sumados en los totales de abajo.</p>
          <div class="dz-actions">
            <button class="btn primary" data-action="import-files">${icon("file")} Elegir archivos</button>
            <button class="btn" data-action="import-camera">${icon("camera")} Hacer una foto</button>
            <button class="btn ghost" data-action="new-sale">${icon("edit")} Escribirla a mano</button>
          </div>
        </div>
        <div id="ingestList" class="filelist"></div>
      </div>
    </section>`;
	if (!list.length) {
		return `
    <div class="stack">
      ${drop}
      <section class="card">
        ${salesRangeBar(w)}
        <div class="empty">
          <div class="e-icon">${icon("sparkle")}</div>
          <h3>Sin ventas en este periodo</h3>
          <p>Cuando subas una liquidación de fruta verás aquí los kilos, el precio medio y el líquido a percibir. También puedes cambiar el periodo.</p>
        </div>
      </section>
    </div>`;
	}
	const rowsOf = (map) => [...map.values()].sort((a, b) => b.kg - a.kg || b.net - a.net);
	const productRows = rowsOf(s.byProduct);
	const buyerRows = rowsOf(s.byBuyer);
	const categoryRows = rowsOf(s.byCategory);
	const monthRows = [...s.byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([mk, row]) => ({
		...row,
		key: monthLabel(mk)
	}));
	const hasCategory = categoryRows.some((r) => r.key !== "Sin categoría");
	return `
  <div class="stack">
    ${drop}

    <section class="card">
      ${salesRangeBar(w)}
      <div class="card-body">
        <div class="kpis">
          <article class="kpi is-brand">
            <div class="kpi-label"><span class="dot"></span>Kilos vendidos</div>
            <div class="kpi-value">${fmtNum(Math.round(s.kg))} kg</div>
            <div class="kpi-foot">${s.withKg} ${s.withKg === 1 ? "liquidación con kilos" : "liquidaciones con kilos"} de ${s.count} documentos</div>
          </article>
          <article class="kpi">
            <div class="kpi-label"><span class="dot"></span>Precio medio</div>
            <div class="kpi-value">${s.kg > 0 ? `${fmtNum(s.avgPrice, 3)} €` : "—"}</div>
            <div class="kpi-foot">por kilo · bruto ${fmtEUR(s.gross)}</div>
          </article>
          <article class="kpi">
            <div class="kpi-label"><span class="dot"></span>Peso medio por entrega</div>
            <div class="kpi-value">${s.withKg > 0 ? `${fmtNum(Math.round(s.avgKg))} kg` : "—"}</div>
            <div class="kpi-foot">kilos entre liquidaciones con kilos</div>
          </article>
          <article class="kpi is-paid">
            <div class="kpi-label"><span class="dot"></span>Líquido a percibir</div>
            <div class="kpi-value">${fmtEUR(s.net)}</div>
            <div class="kpi-foot">bruto ${fmtEUR(s.gross)} − ${fmtEUR(s.discounts)} de descuentos</div>
          </article>
          <article class="kpi is-income">
            <div class="kpi-label"><span class="dot"></span>Ingresos del periodo</div>
            <div class="kpi-value">${fmtEUR(s.money)}</div>
            <div class="kpi-foot">${fmtEUR(s.paid)} cobrado · ${fmtEUR(s.pending)} por cobrar</div>
          </article>
          <article class="kpi is-expense">
            <div class="kpi-label"><span class="dot"></span>Descuentos</div>
            <div class="kpi-value">${fmtEUR(s.discounts)}</div>
            <div class="kpi-foot">${s.gross > 0 ? `${fmtNum(s.discounts / s.gross * 100, 1)} % del bruto` : "sin datos de kilos"}</div>
          </article>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-head">
        <div>
          <h2>Por producto</h2>
          <p>Kilos, precio medio y líquido de cada variedad</p>
        </div>
      </div>
      ${salesGroupTable(productRows, "Producto")}
    </section>

    ${hasCategory ? `
    <section class="card">
      <div class="card-head">
        <div>
          <h2>Por categoría</h2>
          <p>Cómo se reparten los kilos entre calidades</p>
        </div>
      </div>
      ${salesGroupTable(categoryRows.filter((r) => r.key !== "Sin categoría"), "Categoría")}
    </section>` : ""}

    <div class="two-col">
      <section class="card">
        <div class="card-head">
          <div>
            <h2>Por comprador</h2>
            <p>A quién le has vendido en este periodo</p>
          </div>
        </div>
        ${salesGroupTable(buyerRows, "Comprador")}
      </section>

      <section class="card">
        <div class="card-head">
          <div>
            <h2>Mes a mes</h2>
            <p>Kilos y líquido de cada mes</p>
          </div>
        </div>
        ${salesGroupTable(monthRows, "Mes")}
      </section>
    </div>

    <section class="card">
      <div class="card-head">
        <div>
          <h2>Liquidaciones del periodo</h2>
          <p>${s.count} ${s.count === 1 ? "documento" : "documentos"} · ${esc(w.label)}</p>
        </div>
        <div class="spacer"></div>
        <button class="btn sm ghost" data-action="export-sales-csv">${icon("download")}<span>Exportar CSV</span></button>
      </div>
      <div class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Comprador</th>
              <th>Producto</th>
              <th class="num">Kilos</th>
              <th class="num">€/kg</th>
              <th class="num">Descuentos</th>
              <th class="num">Líquido</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${list.map((inv) => {
		const num = liquidacionNumbers(inv);
		const liq = inv.liquidacion || {};
		const product = String(liq.product || "").trim();
		const category = String(liq.category || "").trim();
		return `<tr data-id="${inv.id}">
                <td class="num">${fmtDate(inv.issueDate)}</td>
                <td>
                  <div class="cell-main">
                    <span class="name">${esc(supplierName(inv.supplierId))}</span>
                    ${tagOf(inv)}
                  </div>
                </td>
                <td>
                  <span class="name">${esc(product || kindInfo(inv.kind).short)}</span>
                  ${category ? `<div class="sub">${esc(category)}</div>` : ""}
                  ${inv.number ? `<div class="sub mono">${esc(inv.number)}</div>` : ""}
                </td>
                <td class="num">${num.kg > 0 ? fmtNum(num.kg) : "<span class=\"muted\">—</span>"}</td>
                <td class="num">${num.price > 0 ? fmtNum(num.price, 3) : "<span class=\"muted\">—</span>"}</td>
                <td class="num">${num.discounts > 0 ? fmtEUR(num.discounts) : "<span class=\"muted\">—</span>"}</td>
                <td class="num strong">${fmtEUR(num.net)}</td>
                <td>${statusPill(inv)}</td>
                <td>
                  <div class="row-actions">
                    <button class="icon-btn" data-action="edit-invoice" data-id="${inv.id}" title="Editar" aria-label="Editar liquidación">${icon("edit")}</button>
                    <button class="icon-btn" data-action="delete-invoice" data-id="${inv.id}" title="Borrar" aria-label="Borrar liquidación">${icon("trash")}</button>
                  </div>
                </td>
              </tr>`;
	}).join("")}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="3">${s.count} ${s.count === 1 ? "documento" : "documentos"}</td>
              <td class="num">${fmtNum(Math.round(s.kg))} kg</td>
              <td class="num">${s.kg > 0 ? fmtNum(s.avgPrice, 3) : "—"}</td>
              <td class="num">${fmtEUR(s.discounts)}</td>
              <td class="num">${fmtEUR(s.net)}</td>
              <td colspan="2">${fmtEUR(s.pending)} por cobrar</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  </div>`;
}
/** Vuelve a pintar solo la pantalla de ventas (al cambiar el periodo). */
function refreshSales() {
	if (ui.route !== "ventas") return;
	const view = document.getElementById("view");
	if (!view) return;
	view.innerHTML = viewVentas();
	const meta = pageMeta("ventas");
	const title = document.getElementById("viewTitle");
	const sub = document.getElementById("viewSub");
	if (title) title.textContent = meta.title;
	if (sub) sub.textContent = meta.sub;
	paintIngest();
}
function exportSalesCsv() {
	const w = salesWindow();
	const list = salesDocs();
	if (!list.length) {
		toast("No hay ventas en ese periodo.", "warn");
		return;
	}
	const headers = [
		"Fecha",
		"Comprador",
		"NIF",
		"Documento",
		"Tipo",
		"Producto",
		"Categoría",
		"Kilos",
		"Precio €/kg",
		"Bruto",
		"Descuentos",
		"Líquido",
		"Total documento",
		"Estado",
		"Fecha de cobro"
	];
	const rows = list.map((inv) => {
		const num = liquidacionNumbers(inv);
		const liq = inv.liquidacion || {};
		const sup = supplierById(inv.supplierId) || {};
		return [
			inv.issueDate || "",
			supplierName(inv.supplierId),
			sup.nif || "",
			inv.number || "",
			kindInfo(inv.kind).label,
			liq.product || "",
			liq.category || "",
			num.kg ? fmtNum(num.kg) : "",
			num.price ? fmtNum(num.price, 3) : "",
			num.gross ? fmtNum(num.gross) : "",
			num.discounts ? fmtNum(num.discounts) : "",
			fmtNum(num.net),
			fmtNum(inv.total),
			inv.status === STATUS.PAID ? "Cobrado" : "Por cobrar",
			inv.status === STATUS.PAID && inv.paidDate ? fmtDate(inv.paidDate) : ""
		].map(csvCell).join(";");
	});
	const csv = "﻿" + [headers.map(csvCell).join(";"), ...rows].join("\r\n");
	downloadText(`ventas-${w.from || "todo"}-${todayISO()}.csv`, csv);
	toast(`Exportadas ${list.length} ${list.length === 1 ? "venta" : "ventas"} del periodo.`);
}
/* ------------------------------------------------------------------ */
/* Facturas                                                           */
/* ------------------------------------------------------------------ */
function filteredInvoices() {
	const { status, supplier, q, direction } = ui.filters;
	const needle = q.trim().toLowerCase();
	let list = getState().invoices;
	if (status === "pending") list = list.filter((i) => i.status !== STATUS.PAID);
	else if (status === "paid") list = list.filter((i) => i.status === STATUS.PAID);
	if (supplier) list = list.filter((i) => i.supplierId === supplier);
	if (direction && direction !== "all") list = list.filter((i) => (i.direction || "GASTO") === direction);
	if (needle) {
		list = list.filter((inv) => {
			const sup = supplierById(inv.supplierId);
			const hay = [
				inv.number,
				sup && sup.name,
				sup && sup.nif,
				inv.issueDate,
				String(inv.total)
			].filter(Boolean).join(" ").toLowerCase();
			return hay.includes(needle);
		});
	}
	return sortedInvoices(list);
}
function viewFacturas() {
	const state = getState();
	if (!state.invoices.length) {
		return `<section class="card"><div class="empty">
      <div class="e-icon">${icon("file")}</div>
      <h3>Todavía no hay compras</h3>
      <p>Sube una foto o un PDF y la relleno yo. También puedes escribirla a mano si la tienes delante.</p>
      <div class="e-actions">
        <button class="btn primary" data-action="import-files">${icon("upload")} Subir documento</button>
        <button class="btn" data-action="new-invoice">${icon("plus")} Añadir a mano</button>
      </div>
    </div></section>`;
	}
	return `
  <section class="card">
    <div class="filters">
      <div class="segmented" data-filter-group="status">
        <button data-filter-status="all" class="${ui.filters.status === "all" ? "active" : ""}">Todas</button>
        <button data-filter-status="pending" class="${ui.filters.status === "pending" ? "active" : ""}">Pendientes</button>
        <button data-filter-status="paid" class="${ui.filters.status === "paid" ? "active" : ""}">Pagadas</button>
      </div>
      <div class="segmented" data-filter-group="direction">
        <button data-filter-direction="all" class="${ui.filters.direction === "all" ? "active" : ""}">Todo</button>
        <button data-filter-direction="GASTO" class="${ui.filters.direction === "GASTO" ? "active" : ""}">Compras</button>
        <button data-filter-direction="INGRESO" class="${ui.filters.direction === "INGRESO" ? "active" : ""}">Ingresos</button>
      </div>
      <select data-filter-supplier aria-label="Filtrar por proveedor">
        <option value="">Todos los proveedores</option>
        ${state.suppliers.map((s) => `<option value="${s.id}" ${ui.filters.supplier === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("")}
      </select>
      <label class="search">
        ${icon("search")}
        <input type="search" id="invoiceSearch" placeholder="Buscar por número o proveedor" value="${esc(ui.filters.q)}" aria-label="Buscar documentos">
      </label>
    </div>
    <div id="invoiceTableWrap">${invoiceTable()}</div>
  </section>`;
}
function invoiceTable() {
	const list = filteredInvoices();
	const t = totals(list);
	const today = todayISO();
	if (!list.length) {
		return `<div class="empty">
      <div class="e-icon">${icon("search")}</div>
      <h3>Ningún documento con esos filtros</h3>
      <p>Prueba a quitar la búsqueda o a mirar en todas.</p>
    </div>`;
	}
	return `
  <div class="table-wrap">
    <table class="data">
      <thead>
        <tr>
          <th>Proveedor</th>
          <th>Nº documento</th>
          <th>Fecha</th>
          <th>Vence</th>
          <th class="num">Base</th>
          <th class="num">IGIC</th>
          <th class="num">Total</th>
          <th>Estado</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${list.map((inv) => {
		const overdue = inv.status !== STATUS.PAID && inv.dueDate && inv.dueDate < today;
		return `<tr data-id="${inv.id}">
            <td>
              <div class="cell-main">
                <span class="name">${esc(supplierName(inv.supplierId))}</span>
                <span class="sub">${esc((supplierById(inv.supplierId) || {}).nif || "")}</span>
                ${tagOf(inv)}
              </div>
            </td>
            <td class="mono">${esc(inv.number || "—")}</td>
            <td class="num">${fmtDate(inv.issueDate)}</td>
            <td class="num">${inv.dueDate ? `${fmtDate(inv.dueDate)}${overdue ? " <span class=\"tag\" style=\"background:var(--danger-soft);color:var(--danger)\">vencida</span>" : ""}` : "<span class=\"muted\">—</span>"}</td>
            <td class="num">${fmtEUR(inv.base)}</td>
            <td class="num">${fmtEUR(inv.igic)}<div class="sub" style="font-size:11px;color:var(--ink-3)">${inv.lines && inv.lines.length > 1 ? `${inv.lines.length} tipos` : rateText(inv.rate)}</div></td>
            <td class="num strong">${fmtEUR(inv.total)}</td>
            <td>${statusPill(inv)}</td>
            <td>
              <div class="row-actions">
                <button class="icon-btn" data-action="edit-invoice" data-id="${inv.id}" title="Editar" aria-label="Editar documento">${icon("edit")}</button>
                <button class="icon-btn" data-action="delete-invoice" data-id="${inv.id}" title="Borrar" aria-label="Borrar documento">${icon("trash")}</button>
              </div>
            </td>
          </tr>`;
	}).join("")}
      </tbody>
      <tfoot>
        <tr>
          <td colspan="4">${t.count} ${t.count === 1 ? "documento" : "documentos"}</td>
          <td class="num">${fmtEUR(t.base)}</td>
          <td class="num">${fmtEUR(t.igic)}</td>
          <td class="num">${fmtEUR(t.total)}</td>
          <td colspan="2">${fmtEUR(t.pending)} pendiente</td>
        </tr>
      </tfoot>
    </table>
  </div>`;
}
function refreshInvoiceTable() {
	const wrap = document.getElementById("invoiceTableWrap");
	if (wrap) wrap.innerHTML = invoiceTable();
	document.querySelectorAll("[data-filter-status]").forEach((b) => {
		b.classList.toggle("active", b.dataset.filterStatus === ui.filters.status);
	});
	updateNavBadge();
}
/* ------------------------------------------------------------------ */
/* Proveedores                                                        */
/* ------------------------------------------------------------------ */
function viewProveedores() {
	const state = getState();
	if (!state.suppliers.length) {
		return `<section class="card"><div class="empty">
      <div class="e-icon">${icon("store")}</div>
      <h3>Los proveedores se crean solos</h3>
      <p>En cuanto subas una factura, guardo el proveedor con su nombre y su NIF. Si quieres, también puedes darlo de alta tú.</p>
      <div class="e-actions">
        <button class="btn primary" data-action="import-files">${icon("upload")} Subir factura</button>
        <button class="btn" data-action="new-supplier">${icon("plus")} Añadir proveedor</button>
      </div>
    </div></section>`;
	}
	return `
  <section class="card" style="margin-bottom:16px">
    <div class="filters">
      <label class="search">
        ${icon("search")}
        <input type="search" id="supplierSearch" placeholder="Buscar proveedor o NIF" value="${esc(ui.supplierQuery)}" aria-label="Buscar proveedores">
      </label>
      <div class="spacer"></div>
      <span class="tag">${state.suppliers.length} en total</span>
    </div>
  </section>
  <div id="supplierGridWrap">${supplierGrid()}</div>`;
}
function supplierGrid() {
	const bySupplier = statsBySupplier();
	const q = ui.supplierQuery.trim().toLowerCase();
	let list = getState().suppliers.slice();
	if (q) {
		list = list.filter((s) => `${s.name} ${s.nif}`.toLowerCase().includes(q));
	}
	list.sort((a, b) => {
		const pa = (bySupplier.get(a.id) || {}).pending || 0;
		const pb = (bySupplier.get(b.id) || {}).pending || 0;
		if (pb !== pa) return pb - pa;
		return a.name.localeCompare(b.name, "es");
	});
	if (!list.length) {
		return `<section class="card"><div class="empty">
      <div class="e-icon">${icon("search")}</div>
      <h3>Ningún proveedor con ese nombre</h3>
      <p>Prueba con otra parte del nombre o con el NIF.</p>
    </div></section>`;
	}
	return `<div class="supplier-grid">
    ${list.map((s) => {
		const st = bySupplier.get(s.id) || {
			count: 0,
			total: 0,
			pending: 0,
			countPending: 0,
			lastDate: ""
		};
		return `<article class="supplier-card">
        <div class="supplier-top">
          <div class="avatar">${esc(initials(s.name))}</div>
          <div class="who">
            <div class="n">${esc(s.name)}</div>
            <div class="i">${esc(s.nif || "sin NIF")}</div>
          </div>
        </div>
        <div class="supplier-figures">
          <div>
            <div class="f-label">Facturado</div>
            <div class="f-value">${fmtEUR(st.total)}</div>
          </div>
          <div>
            <div class="f-label">Pendiente</div>
            <div class="f-value ${st.pending > 0 ? "pending" : ""}">${fmtEUR(st.pending)}</div>
          </div>
        </div>
        <div class="supplier-foot">
          <span class="meta">${st.count} ${st.count === 1 ? "factura" : "facturas"}${st.lastDate ? ` · ${fmtDate(st.lastDate)}` : ""}</span>
          <div class="spacer"></div>
          <button class="icon-btn" data-action="edit-supplier" data-id="${s.id}" title="Editar" aria-label="Editar proveedor">${icon("edit")}</button>
          <button class="icon-btn" data-action="delete-supplier" data-id="${s.id}" title="Borrar" aria-label="Borrar proveedor">${icon("trash")}</button>
          <button class="btn sm" data-action="filter-supplier" data-id="${s.id}">Ver facturas</button>
        </div>
      </article>`;
	}).join("")}
  </div>`;
}
function refreshSupplierGrid() {
	const wrap = document.getElementById("supplierGridWrap");
	if (wrap) wrap.innerHTML = supplierGrid();
}
/* ------------------------------------------------------------------ */
/* Correo electrónico                                                 */
/* ------------------------------------------------------------------ */
function mailDateText(raw) {
	if (!raw) return "";
	const d = new Date(raw);
	if (Number.isNaN(d.getTime())) return String(raw).slice(0, 40);
	return d.toLocaleDateString("es-ES", {
		day: "2-digit",
		month: "2-digit",
		year: "numeric"
	});
}
function mailRow(m) {
	const all = m.attachments || [];
	const readable = all.filter((a) => a.readable);
	const bits = [];
	if (all.length) bits.push(`${all.length} adjunto${all.length === 1 ? "" : "s"}`);
	else bits.push("sin adjuntos");
	if (readable.length && readable.length < all.length) bits.push(`${readable.length} legible${readable.length === 1 ? "" : "s"}`);
	return `<div class="mail-item">
    <div class="mail-main">
      <div class="mail-subject">${esc(m.subject || "(sin asunto)")}</div>
      <div class="mail-meta">${esc(m.from || "remitente desconocido")}${m.date ? ` · ${esc(mailDateText(m.date))}` : ""}</div>
      <div class="mail-tags">
        ${bits.map((b) => `<span class="tag">${esc(b)}</span>`).join("")}
        ${m.usedAt ? `<span class="tag is-in">ya revisado</span>` : ""}
      </div>
    </div>
    <div class="row-actions">
      <button class="btn sm" data-action="use-mail" data-id="${m.id}">Leer y revisar</button>
      <button class="icon-btn" data-action="delete-mail" data-id="${m.id}" title="Borrar" aria-label="Borrar correo">${icon("trash")}</button>
    </div>
  </div>`;
}
function viewCorreo() {
	const list = messages();
	const aiOn = aiConfigured(getState().settings);
	return `
  <div class="stack">
    <section class="card">
      <div class="card-body">
        <div id="mailDrop" class="dropzone">
          <div class="dz-icon">${icon("mail")}</div>
          <h3>Trae aquí el correo con la factura o la liquidación</h3>
          <p>
            En tu programa de correo abre el mensaje y elige <strong>«Guardar como…»</strong> o
            <strong>«Descargar el original»</strong>: se guarda un archivo <strong>.eml</strong>.
            Arrástralo aquí y leo su texto y sus adjuntos. Todo pasa en tu ordenador.
          </p>
          <div class="dz-actions">
            <button class="btn primary" data-action="import-email">${icon("mail")} Elegir correos (.eml)</button>
            <button class="btn ghost" data-action="paste-mail">${icon("text")} Pegar el texto</button>
          </div>
          <p style="font-size:12.5px;color:var(--ink-3);margin-top:10px">
            Un navegador no puede entrar solo en tu buzón: por eso el correo se guarda antes como archivo.
          </p>
        </div>
      </div>
    </section>

    <div class="hint-bar">
      ${icon(aiOn ? "sparkle" : "info")}
      <span>${aiOn ? "Cada correo y cada adjunto se clasifica con tu IA y, si falla, con las reglas del programa." : "El programa decide el tipo y el concepto con sus propias reglas. Si quieres ayuda de una IA, se enciende en Ajustes con tu clave."}</span>
    </div>

    <section class="card">
      <div class="card-head">
        <div>
          <h2>Correos guardados</h2>
          <p>${list.length ? "Pulsa «Leer y revisar» para sacar la factura del correo" : "Aquí aparecerán los correos que traigas"}</p>
        </div>
      </div>
      <div class="card-body">
        ${list.length ? `<div class="mail-list">${list.map(mailRow).join("")}</div>` : `<div class="empty">
                 <div class="e-icon">${icon("mail")}</div>
                 <h3>Todavía no hay correos</h3>
                 <p>Lo más cómodo: desde el móvil reenvía la factura a ti mismo y guárdala como .eml la próxima vez que abras el ordenador.</p>
               </div>`}
      </div>
    </section>
  </div>`;
}
/** Abre el selector de archivos .eml. */
function pickEmails() {
	const input = document.createElement("input");
	input.type = "file";
	input.accept = ".eml,message/rfc822";
	input.multiple = true;
	input.addEventListener("change", () => {
		if (input.files && input.files.length) importEmails(input.files);
	});
	input.click();
}
async function importEmails(files) {
	const list = [...files].filter(isEmailFile);
	if (!list.length) {
		toast("Solo sé leer correos guardados como .eml.", "bad", 5200);
		return null;
	}
	let saved = 0;
	let attached = 0;
	let lastId = "";
	for (const file of list) {
		try {
			const raw = await file.text();
			const msg = parseEml(raw, file.name);
			const hasText = !!(msg.text && msg.text.trim());
			const attach = (msg.attachments || []).length;
			if (!hasText && !attach) {
				toast(`El correo «${file.name}» no tiene texto que leer.`, "bad", 5200);
				continue;
			}
			const stored = addMessage(msg);
			saved++;
			lastId = stored ? stored.id : "";
			if (hasText && !looksLikeInvoiceMail(msg)) {
				toast(`He guardado «${file.name}», pero por el texto no parece una factura: revísalo antes de darlo por bueno.`, "warn", 5600);
			}
			for (const att of msg.attachments || []) {
				if (!att.readable || !att.bytes) continue;
				const blob = new Blob([att.bytes], { type: att.type || "application/pdf" });
				const adj = new File([blob], att.name || `adjunto-${attached + 1}.pdf`, { type: blob.type });
				if (describeFile(adj) === "unknown") continue;
				ui.jobs.push({
					id: `job_${Math.random().toString(36).slice(2, 9)}`,
					file: adj,
					state: "queued",
					pct: 0,
					stage: "En cola"
				});
				attached++;
			}
		} catch (err) {
			toast(`No he podido leer «${file.name}»: ${err && err.message || "formato no reconocido"}`, "bad", 6e3);
		}
	}
	if (!saved && !attached) return null;
	if (saved) {
		toast(`Guardado${saved === 1 ? "" : "s"} ${saved} correo${saved === 1 ? "" : "s"}${attached ? ` y ${attached} adjunto${attached === 1 ? "" : "s"} en cola` : ""}.`);
	}
	if (attached) {
		ui.route = "importar";
		if (location.hash !== "#/importar") location.hash = "#/importar";
		else render();
		paintIngest();
		runQueue();
	} else {
		render();
	}
	return {
		saved,
		attached,
		lastId
	};
}
/** Saca la factura de un correo guardado. */
async function useMail(id) {
	const msg = messages().find((m) => m.id === id);
	if (!msg) return;
	const text = [
		msg.subject,
		msg.from,
		msg.date,
		msg.text
	].filter(Boolean).join("\n");
	if (text.trim().length < 12) {
		toast("Ese correo no tiene texto suficiente. Prueba con sus adjuntos.", "bad", 5200);
		return;
	}
	const parsed = parseInvoiceText(text, {
		defaultRate: getState().settings.defaultRate,
		fileName: msg.subject || "correo.eml"
	});
	parsed.rawText = text.slice(0, 6e3);
	const cls = await classifyDocument(text, getState().settings, { fileName: msg.subject || "" });
	parsed.kind = cls.kind || "FACTURA";
	parsed.category = cls.category || "";
	parsed.direction = cls.direction || directionOf(parsed.kind);
	parsed.classifyWhy = cls.why || "";
	parsed.classifyNote = cls.note || "";
	parsed.notes = Array.isArray(parsed.notes) ? parsed.notes : [];
	markMessageUsed(id);
	const job = {
		id: `mail_${id}`,
		file: { name: msg.subject || "correo.eml" },
		source: "email",
		parsed
	};
	await reviewJob(job);
	render();
}
export function openMailPasteModal() {
	openModal(`<div class="modal-head">
      <div>
        <h2>Pegar el texto de un correo</h2>
        <p>Si tu correo no se deja guardar como .eml, copia su texto y pégalo aquí.</p>
      </div>
      <button class="icon-btn" data-modal-cancel aria-label="Cerrar">${icon("x")}</button>
    </div>
    <div class="modal-body">
      <div class="field">
        <label for="mailSubject">Asunto <span class="hint">(opcional)</span></label>
        <input id="mailSubject" type="text" placeholder="Liquidación de fruta campaña 2024">
      </div>
      <div class="field" style="margin-top:12px">
        <label for="mailArea">Texto del correo</label>
        <textarea id="mailArea" rows="10" placeholder="De: …&#10;Asunto: …&#10;&#10;Buenas tardes, adjuntamos la liquidación…"></textarea>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn primary" data-save-mail>Guardar y clasificar</button>
      <button class="btn ghost" data-modal-cancel>Cancelar</button>
    </div>`, { onMount(wrap) {
		wrap.querySelectorAll("[data-modal-cancel]").forEach((b) => b.addEventListener("click", () => closeModal()));
		wrap.querySelector("[data-save-mail]").addEventListener("click", async () => {
			const text = wrap.querySelector("#mailArea").value.trim();
			const subject = wrap.querySelector("#mailSubject").value.trim();
			if (text.length < 12) {
				toast("Pega un poco más de texto.", "bad");
				return;
			}
			const stored = addMessage({
				subject: subject || "Correo pegado a mano",
				from: "",
				date: new Date().toISOString(),
				text,
				attachments: []
			});
			closeModal();
			if (stored) await useMail(stored.id);
		});
	} });
}
/** Prueba rápida desde Ajustes: no manda ningún documento, solo una frase inventada. */
async function testAi() {
	const status = document.getElementById("aiStatus");
	const endpoint = document.getElementById("set-ai-endpoint");
	const model = document.getElementById("set-ai-model");
	const key = document.getElementById("set-ai-key");
	const on = document.getElementById("set-ai-on");
	if (!endpoint || !key) return;
	const settings = {
		aiEnabled: on ? on.checked : true,
		aiEndpoint: endpoint.value.trim(),
		aiModel: model ? model.value.trim() : AI_DEFAULTS.aiModel,
		aiKey: key.value.trim()
	};
	if (!settings.aiEnabled || !settings.aiKey) {
		if (status) status.textContent = "Primero marca la casilla y escribe la clave.";
		return;
	}
	if (status) status.textContent = "Preguntando a la IA…";
	let hello = "";
	let cls;
	try {
		hello = await aiPing(settings);
		const sample = "FACTURA Aguas de Canarias SA. NIF A38000123. Concepto: consumo de agua riego campaña 2024. Base 120,00 IGIC 0% Total 120,00";
		cls = await classifyDocument(sample, settings, { fileName: "prueba" });
	} catch (err) {
		const why = err && err.message ? err.message : "La IA no ha contestado.";
		if (status) status.textContent = why;
		toast(why, "bad", 7e3);
		return;
	}
	if (status) {
		status.textContent = cls.note ? cls.note : `Contesta (${hello.slice(0, 20)}) y entiende la prueba: ${kindInfo(cls.kind).label}${cls.category ? ` · ${categoryInfo(cls.category).label}` : ""}.`;
	}
	toast(cls.note ? cls.note : "La IA contesta. Todo listo.", cls.note ? "warn" : undefined, 6e3);
}
/* ------------------------------------------------------------------ */
/* Importar                                                           */
/* ------------------------------------------------------------------ */
function viewImportar() {
	const defaultRate = getState().settings.defaultRate;
	return `
  <div class="stack">
    <section class="card">
      <div class="card-body">
        <div id="dropzone" class="dropzone">
          <div class="dz-icon">${icon("upload")}</div>
          <h3>Arrastra aquí las facturas</h3>
          <p>Fotos (JPG, PNG) o PDF, varias a la vez. Las leo en tu ordenador y las guardo en tu base de datos.</p>
          <div class="dz-actions">
            <button class="btn primary" data-action="import-files">${icon("file")} Elegir archivos</button>
            <button class="btn" data-action="import-camera">${icon("camera")} Hacer una foto</button>
            <button class="btn ghost" data-action="paste-text">${icon("text")} Pegar el texto</button>
            <button class="btn ghost" data-action="import-email">${icon("mail")} Correo</button>
          </div>
          <p style="font-size:12.5px;color:var(--ink-3);margin-top:10px">
            Con «Hacer una foto» puedes disparar varias seguidas y luego revisarlas todas juntas.
          </p>
        </div>
        <div id="ingestList" class="filelist"></div>
      </div>
    </section>

    <div class="hint-bar">
      ${icon("info")}
      <span>El IGIC por defecto es <strong>${rateText(defaultRate)}</strong>. Puedes cambiarlo en Ajustes, y en cada factura si es otro tipo.</span>
    </div>

    <section class="card">
      <div class="card-head">
        <div>
          <h2>Qué leo de cada factura</h2>
          <p>Y qué puedes corregir antes de guardar</p>
        </div>
      </div>
      <div class="card-body">
        <div class="howto">
          <div class="step">
            <div class="n">1</div>
            <h4>Proveedor</h4>
            <p>Nombre y NIF. Si ya lo tengo, la factura se une a su ficha; si no, lo creo.</p>
          </div>
          <div class="step">
            <div class="n">2</div>
            <h4>Importes</h4>
            <p>Base imponible, tipo de IGIC, cuota y total. Si falta uno, lo calculo con los otros.</p>
          </div>
          <div class="step">
            <div class="n">3</div>
            <h4>Qué documento es</h4>
            <p>Factura, liquidación de fruta, subvención, nómina… y en qué concepto entra (agua, luz, laborales, fitosanitarios, abonos…).</p>
          </div>
          <div class="step">
            <div class="n">4</div>
            <h4>Fechas y estado</h4>
            <p>Fecha, vencimiento y si el documento está cobrado, pagado o pendiente.</p>
          </div>
        </div>
      </div>
    </section>
  </div>`;
}
/* ---- lista de ficheros de esta sesión ---- */
let paintScheduled = false;
function paintIngestSoon() {
	if (paintScheduled) return;
	paintScheduled = true;
	requestAnimationFrame(() => {
		paintScheduled = false;
		paintIngest();
	});
}
function paintIngest() {
	const host = document.getElementById("ingestList");
	if (!host) return;
	if (!ui.jobs.length) {
		host.innerHTML = "";
		return;
	}
	host.innerHTML = ui.jobs.map((job) => {
		const kind = describeFile(job.file);
		const icoName = kind === "pdf" ? "file" : "image";
		let stateText = "";
		let pct = job.pct || 0;
		if (job.state === "queued") stateText = "En cola";
		else if (job.state === "reading") stateText = job.stage || "Leyendo…";
		else if (job.state === "parsed") stateText = job.savedLabel || "Leída, esperando revisión";
		else if (job.state === "saved") {
			stateText = job.savedLabel || "Guardada";
			pct = 100;
		} else if (job.state === "skipped") {
			stateText = "Descartada";
			pct = 100;
		} else if (job.state === "error") {
			stateText = job.error || "Error al leer";
			pct = 100;
		}
		const cls = job.state === "saved" ? "done" : job.state === "error" ? "error" : "";
		const right = job.state === "reading" || job.state === "queued" ? `<div class="spinner"></div>` : job.state === "saved" ? `<span class="status paid static">Guardada</span>` : job.state === "error" ? `<button class="btn sm" data-action="retry-job" data-id="${job.id}">Reintentar</button>` : "";
		return `<div class="fileitem ${cls}">
      <div class="fi-icon">${icon(icoName)}</div>
      <div class="fi-body">
        <div class="fi-name">${esc(job.file.name)}</div>
        <div class="fi-state">${esc(stateText)}</div>
        ${job.state === "reading" ? `<div class="progress"><i style="width:${Math.max(4, Math.min(100, pct))}%"></i></div>` : ""}
      </div>
      ${right}
    </div>`;
	}).join("");
}
/* ---- cola de lectura ---- */
let runningQueue = false;
export function queueFiles(files) {
	const list = [...files].filter(Boolean);
	if (!list.length) return;
	// Los correos guardados (.eml) van por su propio camino.
	const emails = list.filter(isEmailFile);
	if (emails.length) {
		const rest = list.filter((f) => !isEmailFile(f));
		importEmails(emails);
		if (rest.length) queueFiles(rest);
		return;
	}
	const ignored = [];
	for (const file of list) {
		if (describeFile(file) === "unknown") {
			ignored.push(file.name);
			continue;
		}
		ui.jobs.push({
			id: `job_${Math.random().toString(36).slice(2, 9)}`,
			file,
			state: "queued",
			pct: 0,
			stage: "En cola"
		});
	}
	if (ignored.length) {
		toast(`No sé leer ${ignored.length === 1 ? "este archivo" : "estos archivos"} (${ignored.slice(0, 2).join(", ")}). Solo fotos y PDF.`, "bad", 5200);
	}
	if (!ui.jobs.some((j) => j.state === "queued")) return;
	ui.route = "importar";
	if (location.hash !== "#/importar") location.hash = "#/importar";
	else render();
	paintIngest();
	runQueue();
}
async function runQueue() {
	if (runningQueue) return;
	runningQueue = true;
	try {
		for (;;) {
			const job = ui.jobs.find((j) => j.state === "queued");
			if (!job) break;
			await runOne(job);
		}
	} finally {
		runningQueue = false;
		paintIngest();
	}
}
async function runOne(job) {
	job.state = "reading";
	job.stage = "Abriendo el archivo";
	job.pct = 4;
	paintIngestSoon();
	try {
		const { text, source } = await readFile(job.file, (stage, pct) => {
			job.stage = stage;
			job.pct = pct;
			paintIngestSoon();
		});
		job.text = text;
		job.source = source;
		job.parsed = parseInvoiceText(text, {
			defaultRate: getState().settings.defaultRate,
			fileName: job.file.name
		});
		if (!text.trim()) {
			job.state = "error";
			job.error = "No he podido sacar texto. Prueba con una foto más nítida o escríbela a mano.";
			paintIngest();
			return;
		}
		if (!looksLikeInvoice(text)) {
			job.parsed.notes.unshift("Esto no parece una factura. Comprueba que has subido el documento correcto.");
		}
		job.stage = "Mirando qué documento es";
		job.pct = 94;
		paintIngestSoon();
		const cls = await classifyDocument(text, getState().settings, { fileName: job.file.name });
		job.parsed.kind = cls.kind || "FACTURA";
		job.parsed.category = cls.category || "";
		job.parsed.direction = cls.direction || directionOf(job.parsed.kind);
		job.parsed.classifyWhy = cls.why || "";
		job.parsed.classifyNote = cls.note || "";
		/* Liquidación de fruta: kilos, precio por kilo, descuentos y líquido.
		Se lee del texto entero (no del recorte que se guarda) y se revisa que
		los números del papel cuadren antes de enseñarlos. */
		const liq = parseLiquidacion(text);
		if (liq.kg != null || liq.price != null || liq.discounts.length || liq.net != null) {
			job.parsed.liquidacion = {
				product: liq.product,
				category: liq.category,
				kg: liq.kg,
				price: liq.price,
				discounts: liq.discounts
			};
			job.parsed.liquidacionRead = {
				kg: liq.kg,
				price: liq.price,
				gross: liq.gross,
				discounts: liq.discounts,
				net: liq.net,
				product: liq.product,
				category: liq.category,
				ok: liq.ok
			};
			for (const n of liq.notes) job.parsed.notes.push(n);
			// Si trae kilos y precio por kilo pero venía clasificada como factura,
			// es una liquidación: se cambia el tipo para que salga su bloque.
			if (liq.ok && job.parsed.kind === "FACTURA") {
				job.parsed.kind = "LIQUIDACION";
				job.parsed.direction = "INGRESO";
				job.parsed.classifyNote = `Trae kilos y precio por kilo (${fmtNum(liq.kg, 2)} kg a ${fmtNum(liq.price, 3)} €/kg), así que lo he tratado como liquidación de fruta.`;
			}
			// La base del documento es el líquido a percibir, no el importe que
			// hubiera elegido el lector de facturas.
			if (liq.net != null && liq.ok) {
				// Si el papel dice que el IGIC es 0 %, se respeta.
				if (/\bigic\b[^\n]{0,24}0\s*%/i.test(text) || /\biva\b[^\n]{0,24}0\s*%/i.test(text)) {
					job.parsed.rate = 0;
				}
				const r = Number(job.parsed.rate);
				const cuota = Number.isFinite(r) ? round2(liq.net * r / 100) : 0;
				job.parsed.base = liq.net;
				job.parsed.igic = cuota;
				job.parsed.total = round2(liq.net + cuota);
			}
		}
		// La IA, si está encendida en Ajustes, repasa el texto y rellena lo que
		// falte. Solo le llega este texto: nunca la foto ni el PDF.
		await applyAiReading(job, text);
		job.state = "parsed";
		paintIngest();
		if (cls.note) toast(cls.note, "warn", 6e3);
		await reviewJob(job);
	} catch (err) {
		job.state = "error";
		job.error = err && err.message ? err.message : "No he podido leer el archivo.";
		paintIngest();
	}
}
/* ------------------------------------------------------------------ */
/* La IA como segundo par de ojos                                     */
/* ------------------------------------------------------------------ */
/**
* Pide a la IA que interprete el texto del documento y rellena SOLO lo que
* las reglas no han sabido leer (o una liquidación que no cuadraba). Las
* reglas siempre mandan; si la IA falla, se sigue con lo leído y queda una
* nota explicándolo. Devuelve la lista de lo que ha rellenado.
*/
async function applyAiReading(job, text) {
	const settings = getState().settings;
	if (!aiConfigured(settings) || !String(text || "").trim()) return [];
	const model = String(settings.aiModel || AI_DEFAULTS.aiModel);
	let ai;
	try {
		job.stage = `Preguntando a la IA (${model})…`;
		paintIngest();
		ai = await aiExtract(text, settings);
	} catch (err) {
		const why = err && err.message ? err.message : "no ha contestado";
		job.parsed.notes.push(`La IA no ha podido ayudar (${why}). Se queda lo que he leído yo.`);
		return [];
	}
	const p = job.parsed;
	const filled = [];
	const setIfEmpty = (key, value, label) => {
		const current = p[key];
		const empty = current == null || current === "" || typeof current === "number" && !Number.isFinite(current);
		if (empty && value != null && value !== "") {
			p[key] = value;
			filled.push(label);
		}
	};
	if (ai.kind && (!p.kind || p.kind === "OTRO")) {
		p.kind = ai.kind;
		p.direction = directionOf(ai.kind);
		filled.push("el tipo de documento");
	}
	setIfEmpty("category", ai.category, "el concepto");
	setIfEmpty("supplierName", ai.supplierName, "el proveedor");
	setIfEmpty("supplierNif", ai.supplierNif, "el NIF");
	setIfEmpty("number", ai.number, "el número");
	setIfEmpty("issueDate", ai.issueDate, "la fecha");
	setIfEmpty("dueDate", ai.dueDate, "el vencimiento");
	// Los importes: solo si están a cero o sin leer, para no pisar la aritmética.
	const noMoney = (v) => v == null || !Number.isFinite(Number(v)) || Number(v) === 0;
	if (noMoney(p.base) && ai.base != null && ai.base !== 0) {
		p.base = ai.base;
		filled.push("la base");
	}
	if (noMoney(p.igic) && ai.igic != null && !p.base && ai.igic !== 0) {
		p.igic = ai.igic;
		filled.push("la cuota de IGIC");
	}
	if (noMoney(p.total) && ai.total != null && ai.total !== 0) {
		p.total = ai.total;
		filled.push("el total");
	}
	// La liquidación: manda la IA solo si las reglas no encontraron nada o si
	// lo que encontraron no cuadraba (kilos × precio ≠ bruto).
	const rulesFailed = !p.liquidacion || p.liquidacionRead && p.liquidacionRead.ok === false;
	if (ai.liquidacion && rulesFailed) {
		const liqAI = ai.liquidacion;
		const kg = liqAI.kg;
		const price = liqAI.price;
		const discounts = liqAI.discounts || [];
		const gross = kg != null && price != null ? round2(kg * price) : null;
		const dtoSum = round2(discounts.reduce((sum, d) => sum + d.amount, 0));
		const net = liqAI.net != null ? liqAI.net : gross != null ? round2(gross - dtoSum) : null;
		p.liquidacion = {
			product: liqAI.product || p.liquidacion && p.liquidacion.product || "",
			category: liqAI.category || p.liquidacion && p.liquidacion.category || "",
			kg,
			price,
			discounts
		};
		p.liquidacionRead = {
			kg,
			price,
			gross,
			discounts,
			net,
			product: p.liquidacion.product,
			category: p.liquidacion.category,
			ok: true
		};
		if (p.kind !== "LIQUIDACION") {
			p.kind = "LIQUIDACION";
			p.direction = "INGRESO";
			filled.push("que es una liquidación");
		}
		if (kg != null) filled.push("los kilos");
		if (price != null) filled.push("el precio por kilo");
		if (discounts.length) filled.push("los descuentos");
		if (net != null) {
			const rate = Number.isFinite(Number(p.rate)) ? Number(p.rate) : 0;
			const cuota = round2(net * rate / 100);
			p.base = net;
			p.igic = cuota;
			p.total = round2(net + cuota);
			filled.push("el líquido a percibir");
		}
	}
	if (filled.length) {
		p.aiUsed = model;
		const msg = `Estos datos los ha leído la IA (${model}) y no las reglas: ${filled.join(", ")}. Revísalos antes de guardar.`;
		p.notes.push(msg);
		// Así se ve también en la ventana de revisión, donde se lee classifyNote.
		p.classifyNote = p.classifyNote ? `${p.classifyNote} · ${msg}` : msg;
	}
	return filled;
}
/* ------------------------------------------------------------------ */
/* Ventana de revisión / alta / edición de factura                    */
/* ------------------------------------------------------------------ */
function rateOptions(current) {
	const values = IGIC_RATES.map((r) => r.value);
	const hasCurrent = current != null && Number.isFinite(Number(current));
	const extra = hasCurrent && !values.includes(Number(current)) ? Number(current) : null;
	const opts = IGIC_RATES.map((r) => `<option value="${r.value}" ${hasCurrent && Number(current) === r.value ? "selected" : ""}>${rateText(r.value)} — ${r.label.split("—")[1].trim()}</option>`);
	if (extra != null) {
		opts.push(`<option value="${extra}" selected>${rateText(extra)}</option>`);
	}
	return opts.join("");
}
function lineRowHtml(base, rate) {
	const value = base != null && Number.isFinite(Number(base)) ? fmtNum(Number(base)) : "";
	return `<div class="igic-line">
      <div class="with-suffix"><input type="text" inputmode="decimal" class="line-base" value="${value}" placeholder="Base" aria-label="Base imponible de este tipo"><span>€</span></div>
      <select class="line-rate" aria-label="Tipo de IGIC">${rateOptions(rate)}</select>
      <button type="button" class="icon-btn" data-drop-line aria-label="Quitar este tipo">${icon("x")}</button>
    </div>`;
}
/** Una línea de descuento de la liquidación: concepto e importe. */
function dtoRowHtml(label, amount) {
	const value = amount != null && Number.isFinite(Number(amount)) ? fmtNum(Number(amount)) : "";
	return `<div class="igic-line dto-line">
      <input type="text" class="dto-label" value="${esc(label || "")}" placeholder="Manipulación, envases, comisión, transporte…" aria-label="Concepto del descuento">
      <div class="with-suffix"><input type="text" inputmode="decimal" class="dto-amount" value="${value}" placeholder="0,00" aria-label="Importe del descuento"><span>€</span></div>
      <button type="button" class="icon-btn" data-drop-dto aria-label="Quitar este descuento">${icon("x")}</button>
    </div>`;
}
/**
* De una liquidación de fruta interesan los kilos, el precio por kilo y los
* descuentos. Se leen con las reglas de parse.js (que entienden los precios de
* tres decimales y comprueban que kilos × precio cuadre con el bruto).
*/
function guessLiquidacion(text) {
	if (!text) return null;
	const liq = parseLiquidacion(text);
	if (liq.kg == null && liq.price == null && !liq.discounts.length && liq.gross == null && liq.net == null) {
		return null;
	}
	return {
		product: liq.product,
		category: liq.category,
		kg: liq.kg,
		price: liq.price,
		discounts: liq.discounts,
		notes: liq.notes
	};
}
/**
* Lo que se va a importar de una liquidación, en corto y claro, para mirarlo
* antes de guardar. Sale de lo que ha leído el programa, no de los campos.
*/
function liquidacionReadHtml(v) {
	if ((v.kind || "") !== "LIQUIDACION") return "";
	const read = v.liquidacionRead || null;
	const liq = v.liquidacion || null;
	const kg = read && read.kg != null ? read.kg : liq ? liq.kg : null;
	const price = read && read.price != null ? read.price : liq ? liq.price : null;
	const dtos = read && read.discounts || liq && liq.discounts || [];
	const dto = round2(dtos.reduce((a, d) => a + (d.amount || 0), 0));
	const gross = kg != null && price != null ? round2(kg * price) : read && read.gross != null ? read.gross : null;
	const net = read && read.net != null ? read.net : gross != null ? round2(gross - dto) : null;
	if (kg == null && price == null && net == null) return "";
	const rows = [];
	const row = (k, val, strong) => rows.push([
		k,
		val,
		strong
	]);
	if (read && read.product) row("Producto", esc(read.product));
	if (read && read.category) row("Categoría", esc(read.category));
	if (kg != null) row("Kilos", `${fmtNum(kg, 2)} kg`, true);
	if (price != null) row("Precio por kilo", `${fmtNum(price, 3)} €/kg`, true);
	if (gross != null) row("Bruto (kilos × precio)", fmtEUR(gross));
	if (dto) row(`Descuentos (${dtos.length})`, fmtEUR(dto));
	if (net != null) row("Líquido a percibir", fmtEUR(net), true);
	return `<div class="summary-box span-2" style="margin-bottom:12px">
    ${icon("info")}
    <div>
      <div style="font-weight:600;margin-bottom:4px">Datos que voy a importar</div>
      <div style="display:grid;grid-template-columns:auto auto;gap:2px 14px;font-size:13px">
        ${rows.map(([k, val, strong]) => `<span>${k}</span><span${strong ? " style=\"font-weight:600\"" : ""}>${val}</span>`).join("")}
      </div>
      <div style="font-size:12px;color:var(--ink-3);margin-top:6px">
        La base y el total se han puesto con el líquido. Si algo no te cuadra, cámbialo antes de guardar.
      </div>
    </div>
  </div>`;
}
function invoiceFormHtml(v) {
	const state = getState();
	const kind = v.kind || "FACTURA";
	const direction = v.direction || directionOf(kind);
	return `
  <div class="form-grid">
    <div class="field">
      <label for="f-kind">Tipo de documento</label>
      <select id="f-kind">${kindOptions(kind)}</select>
    </div>
    <div class="field">
      <label for="f-cat">Concepto</label>
      <select id="f-cat">${categoryOptions(v.category, direction)}</select>
    </div>
    ${v.classifyWhy || v.classifyNote ? `<div class="classify-why span-2" id="f-why">${icon("sparkle")}<span>${esc([v.classifyWhy, v.classifyNote].filter(Boolean).join(" · "))}</span></div>` : `<div class="classify-why span-2" id="f-why" hidden></div>`}
    ${liquidacionReadHtml(v)}
    <div class="field span-2">
      <label for="f-name">Proveedor <span class="tag" id="supplierHint" hidden></span></label>
      <input id="f-name" type="text" list="supplierNames" autocomplete="off" value="${esc(v.supplierName || "")}" placeholder="Nombre del proveedor">
      <datalist id="supplierNames">
        ${state.suppliers.map((s) => `<option value="${esc(s.name)}">`).join("")}
      </datalist>
    </div>
    <div class="field">
      <label for="f-nif">NIF / CIF</label>
      <input id="f-nif" type="text" autocomplete="off" value="${esc(v.supplierNif || "")}" placeholder="B12345678">
    </div>
    <div class="field">
      <label for="f-number">Número de factura</label>
      <input id="f-number" type="text" autocomplete="off" value="${esc(v.number || "")}" placeholder="2024/0184">
    </div>
    <div class="field">
      <label for="f-issue">Fecha de la factura</label>
      <input id="f-issue" type="date" value="${esc(v.issueDate || "")}">
    </div>
    <div class="field">
      <label for="f-due">Vencimiento <span class="hint">(opcional)</span></label>
      <input id="f-due" type="date" value="${esc(v.dueDate || "")}">
    </div>
    <div class="field">
      <label for="f-base">Base imponible</label>
      <div class="with-suffix"><input id="f-base" type="text" inputmode="decimal" value="${v.base != null ? fmtNum(v.base) : ""}" placeholder="0,00"><span>€</span></div>
    </div>
    <div class="field">
      <label for="f-rate">Tipo de IGIC</label>
      <select id="f-rate">${rateOptions(v.rate)}</select>
    </div>
    <div class="field">
      <label for="f-igic">Cuota de IGIC</label>
      <div class="with-suffix"><input id="f-igic" type="text" inputmode="decimal" value="${v.igic != null ? fmtNum(v.igic) : ""}" placeholder="0,00"><span>€</span></div>
    </div>
    <div class="field">
      <label for="f-total">Total de la factura</label>
      <div class="with-suffix"><input id="f-total" type="text" inputmode="decimal" value="${v.total != null ? fmtNum(v.total) : ""}" placeholder="0,00"><span>€</span></div>
    </div>
    <div class="field span-2">
      <div class="lines-head">
        <div>
          <label for="iv-lines">Varios tipos de IGIC en el mismo documento</label>
          <p class="lines-hint">Cada producto o servicio lleva su tipo (0 · 3 · 7 · 9,5 · 15 · 20 %). Añade una línea por tipo y la base, la cuota y el total se suman solos.</p>
        </div>
        <button type="button" class="btn sm ghost" data-add-line>${icon("plus")}<span>Añadir tipo</span></button>
      </div>
      <div class="igic-lines" id="iv-lines">
        ${(v.lines || []).map((l) => lineRowHtml(l.base, l.rate)).join("")}
      </div>
      <p class="lines-sum" id="iv-lines-sum" hidden></p>
    </div>
    <div class="field span-2" id="f-liq" ${kind === "LIQUIDACION" ? "" : "hidden"}>
      <div class="lines-head">
        <div>
          <label for="l-kg">Liquidación de fruta</label>
          <p class="lines-hint">Kilos entregados × precio por kilo. Los descuentos (manipulación, envases, comisión, transporte…) se restan y queda el líquido a percibir, que pasa a la base.</p>
        </div>
        <button type="button" class="btn sm ghost" data-add-dto>${icon("plus")}<span>Añadir descuento</span></button>
      </div>
      <div class="liq-grid">
        <div class="field">
          <label for="l-product">Producto o variedad <span class="hint">(opcional)</span></label>
          <input id="l-product" type="text" value="${esc(v.liquidacion && v.liquidacion.product || "")}" placeholder="Plátano, aguacate, tomate…">
        </div>
        <div class="field">
          <label for="l-category">Categoría <span class="hint">(opcional)</span></label>
          <input id="l-category" type="text" list="liq-categories" value="${esc(v.liquidacion && v.liquidacion.category || "")}" placeholder="Extra, primera, segunda…">
          <datalist id="liq-categories">
            <option value="Extra"></option>
            <option value="Primera"></option>
            <option value="Segunda"></option>
            <option value="Tercera"></option>
            <option value="Destrío"></option>
          </datalist>
        </div>
        <div class="field">
          <label for="l-kg">Kilos</label>
          <div class="with-suffix"><input id="l-kg" type="text" inputmode="decimal" value="${v.liquidacion && v.liquidacion.kg != null ? fmtNum(v.liquidacion.kg) : ""}" placeholder="0"><span>kg</span></div>
        </div>
        <div class="field">
          <label for="l-price">Precio por kilo</label>
          <div class="with-suffix"><input id="l-price" type="text" inputmode="decimal" value="${v.liquidacion && v.liquidacion.price != null ? fmtNum(v.liquidacion.price, 3) : ""}" placeholder="0,000"><span>€/kg</span></div>
        </div>
      </div>
      <div class="igic-lines" id="iv-dtos">${(v.liquidacion && v.liquidacion.discounts || []).map((d) => dtoRowHtml(d.label, d.amount)).join("")}</div>
      <p class="lines-sum" id="iv-liq-sum" hidden></p>
    </div>
    <div class="field span-2">
      <label>Estado</label>
      <div class="segmented" id="f-status-seg" data-value="${v.status === STATUS.PAID ? STATUS.PAID : STATUS.PENDING}">
        <button type="button" data-status="${STATUS.PENDING}" class="${v.status !== STATUS.PAID ? "active" : ""}">Pendiente</button>
        <button type="button" data-status="${STATUS.PAID}" class="${v.status === STATUS.PAID ? "active" : ""}">${directionOf(kind) === "INGRESO" ? "Cobrado" : "Pagado"}</button>
      </div>
      <div class="field" id="f-paid" style="margin-top:12px" ${v.status === STATUS.PAID ? "" : "hidden"}>
        <label for="f-paid-date">Fecha ${directionOf(kind) === "INGRESO" ? "del cobro" : "del pago"}</label>
        <input id="f-paid-date" type="date" value="${esc(v.paidDate || "")}">
        <span class="hint">Si la dejas vacía, se guarda la de hoy. Sale en la ficha y en los listados.</span>
      </div>
    </div>
  </div>`;
}
function notesHtml(notes) {
	if (!notes || !notes.length) return "";
	return `<div class="summary-box warn" style="margin-bottom:14px">
    ${icon("alert")}
    <div>
      ${notes.map((n) => `<div>${esc(n)}</div>`).join("")}
    </div>
  </div>`;
}
export function openInvoiceModal({ mode = "new", invoice = null, job = null, preset = null } = {}) {
	const editing = mode === "edit" && invoice;
	const values = editing ? {
		supplierName: supplierName(invoice.supplierId),
		supplierNif: (supplierById(invoice.supplierId) || {}).nif || "",
		number: invoice.number,
		issueDate: invoice.issueDate,
		dueDate: invoice.dueDate,
		base: invoice.base,
		rate: invoice.rate,
		igic: invoice.igic,
		total: invoice.total,
		status: invoice.status,
		paidDate: invoice.paidDate || "",
		kind: invoice.kind || "FACTURA",
		category: invoice.category || "",
		direction: invoice.direction || directionOf(invoice.kind || "FACTURA"),
		lines: invoice.lines || [],
		liquidacion: invoice.liquidacion || null
	} : job ? { ...job.parsed } : {
		supplierName: "",
		supplierNif: "",
		number: "",
		issueDate: todayISO(),
		dueDate: "",
		base: null,
		rate: getState().settings.defaultRate,
		igic: null,
		total: null,
		status: STATUS.PENDING,
		kind: "FACTURA",
		category: "",
		direction: "GASTO"
	};
	// Una venta o liquidación que se escribe a mano: el tipo ya viene puesto.
	if (preset) Object.assign(values, preset);
	// Si es una liquidación de fruta y el texto trae kilos y precio, se rellenan.
	if (!values.liquidacion && values.kind === "LIQUIDACION" && values.rawText) {
		const liq = guessLiquidacion(values.rawText);
		if (liq) {
			if (liq.notes && liq.notes.length) {
				// Se añaden al mismo array que enseña la ventana (valores y job lo comparten).
				const notes = values.notes || (values.notes = []);
				notes.push(...liq.notes);
				values.liquidacionRead = {
					...liq,
					discounts: liq.discounts || []
				};
			}
			delete liq.notes;
			values.liquidacion = liq;
		}
	}
	const title = editing ? "Editar documento" : job ? "Revisa lo que he leído" : "Nuevo documento";
	const sub = editing ? "Cambia lo que haga falta y guarda." : job ? `${sourceLabel(job.source)} · ${esc(job.file.name)}` : "Escribe los datos de la factura.";
	const conf = job ? Math.round((job.parsed.confidence || 0) * 100) : null;
	const html = `
    <div class="modal-head">
      <div>
        <h2>${title}</h2>
        <p>${sub}</p>
      </div>
      <div class="spacer"></div>
      ${conf != null ? `<span class="tag ${conf >= 65 ? "kind" : ""}">${conf} % leído</span>` : ""}
      <button class="icon-btn" data-modal-cancel aria-label="Cerrar">${icon("x")}</button>
    </div>
    <div class="modal-body">
      ${job ? notesHtml(job.parsed.notes) : ""}
      <div id="dupWarning" class="summary-box warn" hidden style="margin-bottom:14px">${icon("alert")}<div></div></div>
      <div class="review-layout">
        <div>
          ${invoiceFormHtml(values)}
        </div>
        <div>
          <div class="summary-box" style="margin-bottom:12px">
            ${icon("info")}
            <div id="supplierInfo">Al guardar, el proveedor se añade solo a tu lista.</div>
          </div>
          ${job && job.parsed.rawText ? `
          <details>
            <summary style="cursor:pointer;font-size:13px;color:var(--ink-2);font-weight:600">Ver el texto que he leído</summary>
            <div class="raw-text" style="margin-top:8px">${esc(job.parsed.rawText)}</div>
          </details>` : ""}
        </div>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn primary" data-save>${editing ? "Guardar cambios" : "Guardar documento"}</button>
      <button class="btn ghost" data-modal-cancel>${job ? "Descartar" : "Cancelar"}</button>
      <div class="spacer"></div>
      ${job ? `<span class="muted" style="font-size:12px;color:var(--ink-3)">Comprueba los importes antes de guardar</span>` : ""}
    </div>`;
	return new Promise((resolve) => {
		let settled = false;
		const finish = (result) => {
			if (settled) return;
			settled = true;
			resolve(result);
		};
		openModal(html, {
			onMount(wrap) {
				bindForm(wrap, values);
				wrap.querySelector("[data-save]").addEventListener("click", async () => {
					const saved = await submitInvoice(wrap, {
						mode,
						invoice,
						job
					});
					if (saved) {
						finish(saved);
						closeModal();
					}
				});
				wrap.querySelectorAll("[data-modal-cancel]").forEach((b) => b.addEventListener("click", () => {
					closeModal();
					finish(null);
				}));
			},
			onClose() {
				finish(null);
			}
		});
	});
}
function bindForm(wrap, initial) {
	const q = (id) => wrap.querySelector(id);
	const base = q("#f-base");
	const rate = q("#f-rate");
	const igic = q("#f-igic");
	const total = q("#f-total");
	const name = q("#f-name");
	const nif = q("#f-nif");
	const number = q("#f-number");
	const seg = q("#f-status-seg");
	const hint = q("#supplierHint");
	const info = q("#supplierInfo");
	const dup = q("#dupWarning");
	const kindSel = q("#f-kind");
	const catSel = q("#f-cat");
	const why = q("#f-why");
	function showWhy(text) {
		if (!why) return;
		if (!text) {
			why.hidden = true;
			why.innerHTML = "";
			return;
		}
		why.hidden = false;
		why.innerHTML = `${icon("sparkle")}<span>${esc(text)}</span>`;
	}
	function repaintCategories() {
		if (!kindSel || !catSel) return;
		const d = directionOf(kindSel.value);
		const keep = catSel.value;
		catSel.innerHTML = categoryOptions(keep, d);
		const ki = kindInfo(kindSel.value);
		showWhy(d === "INGRESO" ? "Documento de entrada de dinero (fruta o subvención)." : "Documento de gasto: se resta del resultado.");
		if (catSel.value !== keep) showWhy(`He cambiado el concepto porque no encaja con «${ki.label}».`);
	}
	if (kindSel && catSel) {
		if (kindSel.value && directionOf(kindSel.value) !== (catSel.dataset.direction || directionOf(kindSel.value))) {
			catSel.innerHTML = categoryOptions(catSel.value, directionOf(kindSel.value));
		}
		kindSel.addEventListener("change", repaintCategories);
		catSel.dataset.direction = directionOf(kindSel.value);
		catSel.addEventListener("change", () => {
			catSel.dataset.direction = directionOf(kindSel.value);
		});
	}
	const num = (el) => parseAmount(el.value);
	function setIfNotFocused(el, value) {
		if (document.activeElement === el) return;
		el.value = value == null ? "" : fmtNum(value);
	}
	function recalcFromBase() {
		const b = num(base);
		const r = Number(rate.value);
		if (b == null || !Number.isFinite(r)) return;
		const i = round2(b * r / 100);
		setIfNotFocused(igic, i);
		setIfNotFocused(total, round2(b + i));
	}
	function recalcFromIgic() {
		const b = num(base);
		const i = num(igic);
		if (i == null) return;
		if (b != null) {
			setIfNotFocused(total, round2(b + i));
			if (b > 0) syncRate(round2(i / b * 100));
		} else {
			setIfNotFocused(total, i);
		}
	}
	function recalcFromTotal() {
		const b = num(base);
		const t = num(total);
		if (t == null) return;
		if (b != null) {
			const i = round2(t - b);
			setIfNotFocused(igic, i);
			if (b > 0) syncRate(round2(i / b * 100));
		}
	}
	function syncRate(value) {
		if (!Number.isFinite(value) || value < 0 || value > 60) return;
		const match = [...rate.options].find((o) => Math.abs(Number(o.value) - value) < .06);
		if (match) {
			rate.value = match.value;
		} else {
			const opt = document.createElement("option");
			opt.value = String(value);
			opt.textContent = rateText(value);
			opt.selected = true;
			rate.appendChild(opt);
		}
	}
	base.addEventListener("input", recalcFromBase);
	rate.addEventListener("change", recalcFromBase);
	igic.addEventListener("input", recalcFromIgic);
	total.addEventListener("input", recalcFromTotal);
	[
		base,
		igic,
		total
	].forEach((el) => el.addEventListener("blur", () => {
		const v = parseAmount(el.value);
		if (v != null) el.value = fmtNum(v);
	}));
	const paidWrap = q("#f-paid");
	const paidInput = q("#f-paid-date");
	seg.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
		seg.dataset.value = b.dataset.status;
		seg.querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
		// La fecha solo tiene sentido con el documento cobrado o pagado.
		if (paidWrap) {
			const paid = b.dataset.status === STATUS.PAID;
			paidWrap.hidden = !paid;
			if (paid && paidInput && !paidInput.value) paidInput.value = todayISO();
		}
	}));
	let hintTimer = null;
	function updateHints() {
		clearTimeout(hintTimer);
		hintTimer = setTimeout(() => {
			const existing = findSupplierByNameOrNif(name.value, nif.value);
			if (existing) {
				hint.hidden = false;
				hint.textContent = "ya existe";
				hint.className = "tag kind";
				info.textContent = `Este proveedor ya está en tu lista como «${existing.name}». La factura se añadirá a su ficha.`;
			} else if (name.value.trim().length >= 2) {
				hint.hidden = false;
				hint.textContent = "proveedor nuevo";
				hint.className = "tag";
				info.textContent = "Al guardar, este proveedor se añade solo a tu lista.";
			} else {
				hint.hidden = true;
				info.textContent = "Al guardar, el proveedor se añade solo a tu lista.";
			}
			const supplierId = existing ? existing.id : null;
			const found = supplierId && number.value.trim() ? findDuplicate(supplierId, number.value) : null;
			if (found) {
				dup.hidden = false;
				dup.querySelector("div").innerHTML = `<div>Ya tienes una factura con el número <strong>${esc(number.value.trim())}</strong> de este proveedor (${fmtDate(found.issueDate)}, ${fmtEUR(found.total)}).</div>
           <label class="checkline" style="margin-top:6px"><input type="checkbox" id="dupOk"> Es otra factura distinta: guárdala igualmente</label>`;
			} else {
				dup.hidden = true;
				dup.querySelector("div").innerHTML = "";
			}
		}, 180);
	}
	name.addEventListener("input", updateHints);
	nif.addEventListener("input", updateHints);
	number.addEventListener("input", updateHints);
	updateHints();
	/* Varios tipos de IGIC en el mismo documento: cada línea tiene su base y su tipo */
	const linesBox = q("#iv-lines");
	const linesSum = q("#iv-lines-sum");
	const addLineBtn = q("[data-add-line]");
	function lineTotals() {
		const rows = readIgicLines(wrap);
		const b = round2(rows.reduce((a, l) => a + l.base, 0));
		const i = round2(rows.reduce((a, l) => a + round2(l.base * l.rate / 100), 0));
		return {
			rows,
			base: b,
			igic: i,
			total: round2(b + i)
		};
	}
	function paintLines() {
		const totals2 = lineTotals();
		if (linesSum) {
			if (!totals2.rows.length) {
				linesSum.hidden = true;
				linesSum.textContent = "";
			} else {
				linesSum.hidden = false;
				linesSum.textContent = `${totals2.rows.length} ${totals2.rows.length === 1 ? "tipo" : "tipos"} · base ${fmtEUR(totals2.base)} · IGIC ${fmtEUR(totals2.igic)} · total ${fmtEUR(totals2.total)}`;
			}
		}
		return totals2;
	}
	function recalcFromLines() {
		const sums = paintLines();
		if (!sums.rows.length) return;
		if (document.activeElement !== base) base.value = fmtNum(sums.base);
		if (document.activeElement !== igic) igic.value = fmtNum(sums.igic);
		if (document.activeElement !== total) total.value = fmtNum(sums.total);
		const first = sums.rows[0].rate;
		if (sums.rows.every((l) => l.rate === first) && [...rate.options].some((o) => Number(o.value) === first)) {
			rate.value = String(first);
		}
	}
	if (linesBox) {
		linesBox.addEventListener("input", recalcFromLines);
		linesBox.addEventListener("change", recalcFromLines);
		linesBox.addEventListener("click", (ev) => {
			const drop = ev.target.closest("[data-drop-line]");
			if (!drop) return;
			ev.preventDefault();
			const row = drop.closest(".igic-line");
			if (row) row.remove();
			recalcFromLines();
		});
	}
	if (addLineBtn) {
		addLineBtn.addEventListener("click", (ev) => {
			ev.preventDefault();
			if (!linesBox) return;
			linesBox.insertAdjacentHTML("beforeend", lineRowHtml(null, rate.value));
			const rows = linesBox.querySelectorAll(".igic-line");
			const last = rows[rows.length - 1];
			if (last) last.querySelector(".line-base").focus();
			paintLines();
		});
	}
	/* Liquidación de fruta: kilos × precio, menos descuentos = líquido a percibir */
	const liqBox = q("#f-liq");
	const liqSum = q("#iv-liq-sum");
	const dtosBox = q("#iv-dtos");
	const addDtoBtn = q("[data-add-dto]");
	function paintLiq() {
		const liq = readLiquidacion(wrap);
		const dto = liq ? round2(liq.discounts.reduce((a, d) => a + (d.amount || 0), 0)) : 0;
		const gross = liq && liq.kg != null && liq.price != null ? round2(liq.kg * liq.price) : null;
		const net = gross != null ? round2(gross - dto) : null;
		if (liqSum) {
			if (net == null) {
				liqSum.hidden = true;
				liqSum.textContent = "";
			} else {
				liqSum.hidden = false;
				liqSum.textContent = `${fmtNum(liq.kg)} kg × ${fmtNum(liq.price, 3)} €/kg = ${fmtEUR(gross)}` + (dto ? ` − ${fmtEUR(dto)} de descuentos` : "") + ` · líquido a percibir ${fmtEUR(net)}`;
			}
		}
		return {
			liq,
			net
		};
	}
	function recalcFromLiq() {
		const { net } = paintLiq();
		if (net == null) return;
		const r = Number(rate.value);
		const cuota = Number.isFinite(r) ? round2(net * r / 100) : 0;
		if (document.activeElement !== base) base.value = fmtNum(net);
		if (document.activeElement !== igic) igic.value = fmtNum(cuota);
		if (document.activeElement !== total) total.value = fmtNum(round2(net + cuota));
	}
	if (liqBox) {
		liqBox.addEventListener("input", recalcFromLiq);
		liqBox.addEventListener("change", recalcFromLiq);
		liqBox.addEventListener("click", (ev) => {
			const drop = ev.target.closest("[data-drop-dto]");
			if (!drop) return;
			ev.preventDefault();
			const row = drop.closest(".dto-line");
			if (row) row.remove();
			recalcFromLiq();
		});
	}
	if (addDtoBtn && dtosBox) {
		addDtoBtn.addEventListener("click", (ev) => {
			ev.preventDefault();
			dtosBox.insertAdjacentHTML("beforeend", dtoRowHtml("", null));
			const rows = dtosBox.querySelectorAll(".dto-line");
			const last = rows[rows.length - 1];
			if (last) last.querySelector(".dto-label").focus();
			paintLiq();
		});
	}
	function syncLiqVisibility() {
		if (!liqBox) return;
		liqBox.hidden = kindSel.value !== "LIQUIDACION";
	}
	if (kindSel) {
		kindSel.addEventListener("change", syncLiqVisibility);
		syncLiqVisibility();
	}
	paintLines();
	paintLiq();
	if (initial && initial.rate != null) rate.value = String(initial.rate);
	// Al importar una liquidación, la base, el IGIC y el total salen del líquido
	// que dice el papel (no del importe que hubiera elegido el lector genérico).
	if (initial && initial.liquidacionRead && liqBox && !liqBox.hidden) recalcFromLiq();
}
function readIgicLines(wrap) {
	const box = wrap.querySelector("#iv-lines");
	if (!box) return [];
	return [...box.querySelectorAll(".igic-line")].map((row) => {
		const baseInput = row.querySelector(".line-base");
		const rateSelect = row.querySelector(".line-rate");
		const base = parseAmount(baseInput ? baseInput.value : "");
		const rate = Number(rateSelect ? rateSelect.value : NaN);
		if (base == null || !Number.isFinite(rate)) return null;
		return {
			base,
			rate
		};
	}).filter(Boolean);
}
/** Lo que hay escrito en el bloque de liquidación de fruta, o null si está vacío. */
function readLiquidacion(wrap) {
	const box = wrap.querySelector("#f-liq");
	if (!box) return null;
	const val = (sel) => {
		const el = wrap.querySelector(sel);
		return el && typeof el.value === "string" ? el.value : "";
	};
	const product = val("#l-product").trim();
	const category = val("#l-category").trim();
	// Los kilos llevan el punto en los miles («4.520»); el precio por kilo, en
	// los decimales («0,853» y también «0.853»).
	const kg = parseKg(val("#l-kg"));
	const price = parsePrice(val("#l-price"));
	const dtos = wrap.querySelector("#iv-dtos");
	const discounts = dtos ? [...dtos.querySelectorAll(".dto-line")].map((row) => {
		const labelEl = row.querySelector(".dto-label");
		const amountEl = row.querySelector(".dto-amount");
		const label = (labelEl ? labelEl.value : "").trim();
		const amount = parseAmount(amountEl ? amountEl.value : "");
		if (!label && amount == null) return null;
		return {
			label,
			amount: amount == null ? 0 : amount
		};
	}).filter(Boolean) : [];
	if (!product && !category && kg == null && price == null && !discounts.length) return null;
	return {
		product,
		category,
		kg,
		price,
		discounts
	};
}
function readForm(wrap) {
	const q = (id) => wrap.querySelector(id);
	const status = q("#f-status-seg").dataset.value;
	const base = parseAmount(q("#f-base").value);
	const rateRaw = q("#f-rate").value;
	const rate = rateRaw === "" ? null : Number(rateRaw);
	const igic = parseAmount(q("#f-igic").value);
	const total = parseAmount(q("#f-total").value);
	const lines = readIgicLines(wrap);
	return {
		supplierName: q("#f-name").value.trim(),
		supplierNif: q("#f-nif").value.trim(),
		number: q("#f-number").value.trim(),
		issueDate: q("#f-issue").value || "",
		dueDate: q("#f-due").value || "",
		kind: q("#f-kind") && q("#f-kind").value || "FACTURA",
		category: q("#f-cat") && q("#f-cat").value || "",
		direction: directionOf(q("#f-kind") && q("#f-kind").value || "FACTURA"),
		base,
		rate: lines.length > 1 && base > 0 && igic != null ? round2(igic / base * 100) : Number.isFinite(rate) ? rate : null,
		igic,
		total,
		lines,
		liquidacion: readLiquidacion(wrap),
		status: status === STATUS.PAID ? STATUS.PAID : STATUS.PENDING,
		paidDate: status === STATUS.PAID ? String(q("#f-paid-date") && q("#f-paid-date").value || "").slice(0, 10) : ""
	};
}
async function submitInvoice(wrap, { mode, invoice, job }) {
	const v = readForm(wrap);
	if (!v.supplierName) {
		toast("Escribe el nombre del proveedor.", "bad");
		wrap.querySelector("#f-name").focus();
		return null;
	}
	if (v.total == null && v.base == null) {
		toast("Necesito al menos el total o la base imponible.", "bad");
		wrap.querySelector("#f-total").focus();
		return null;
	}
	const existing = findSupplierByNameOrNif(v.supplierName, v.supplierNif);
	const dup = existing && v.number ? findDuplicate(existing.id, v.number) : null;
	if (dup && (!invoice || dup.id !== invoice.id)) {
		const ok = wrap.querySelector("#dupOk");
		if (!ok || !ok.checked) {
			toast("Ya tienes esa factura. Si de verdad es otra distinta, marca la casilla del aviso.", "bad", 5200);
			if (ok) ok.focus();
			return null;
		}
	}
	if (mode === "edit" && invoice) {
		const { supplier, created } = ensureSupplier(v.supplierName, v.supplierNif);
		updateInvoice(invoice.id, {
			supplierId: supplier.id,
			number: v.number,
			issueDate: v.issueDate,
			dueDate: v.dueDate,
			base: v.base,
			rate: v.rate,
			igic: v.igic,
			total: v.total,
			lines: v.lines,
			liquidacion: v.liquidacion,
			status: v.status,
			kind: v.kind,
			category: v.category,
			direction: v.direction
		});
		toast(created ? `Documento guardado y proveedor «${supplier.name}» creado.` : "Documento actualizado.");
		return { invoice };
	}
	const res = addInvoice({
		...v,
		source: job ? job.source : "manual",
		fileName: job ? job.file.name : "",
		rawText: job ? job.parsed.rawText : "",
		notes: job ? job.parsed.notes : [],
		confidence: job ? job.parsed.confidence : null
	});
	if (res.supplierCreated) {
		toast(`Guardada. He creado el proveedor «${res.supplier.name}».`);
	} else {
		toast(`Guardada en la ficha de «${res.supplier.name}».`);
	}
	return res;
}
/* ------------------------------------------------------------------ */
/* Cámara del dispositivo                                             */
/* ------------------------------------------------------------------ */
async function importFromCamera() {
	const picker = document.getElementById("cameraPicker");
	if (!cameraSupported()) {
		// Navegador sin acceso a la cámara desde la página: el selector nativo,
		// que en un móvil también abre la cámara.
		if (picker) {
			picker.click();
			return;
		}
		toast("Este navegador no puede abrir la cámara desde la página. Elige una foto o un PDF.", "bad", 6e3);
		return;
	}
	let photos = [];
	try {
		photos = await openCamera();
	} catch (err) {
		toast(err && err.message || "No he podido abrir la cámara.", "bad", 7e3);
		if (err && err.code === "unsupported" && picker) picker.click();
		return;
	}
	if (photos.length) queueFiles(photos);
}
/* ------------------------------------------------------------------ */
/* Base de datos SQLite                                               */
/* ------------------------------------------------------------------ */
function sqlitePanel() {
	const info = storageInfo();
	if (!info.sqlite) {
		return `<p style="font-size:13px;color:var(--ink-3);margin-bottom:12px">
      Este navegador no ha dejado abrir SQLite${info.reason ? ` (${esc(info.reason)})` : ""}.
      Los datos se guardan igualmente, pero sin base de datos.</p>`;
	}
	const d = info.detail || {};
	const kb = d.bytes ? Math.max(1, Math.round(d.bytes / 1024)) : 1;
	return `<p style="font-size:13px;color:var(--ink-3);margin-bottom:10px">
      Todo está en una base de datos <strong>SQLite</strong> guardada dentro de este navegador
      (${kb} KB, SQLite ${esc(d.version || "3")}). Se puede descargar y abrir con cualquier programa de SQLite.
    </p>
    <ul class="db-stats">
      <li><strong>${d.suppliers || 0}</strong> proveedores</li>
      <li><strong>${d.invoices || 0}</strong> facturas</li>
      <li><strong>${d.paid || 0}</strong> pagadas</li>
      <li><strong>${d.pending || 0}</strong> pendientes</li>
    </ul>
    <div class="row wrap" style="margin-top:12px">
      <button class="btn sm" data-action="export-sqlite">${icon("download")} Descargar base de datos (.sqlite)</button>
    </div>
    <p style="font-size:12px;color:var(--ink-3);margin-top:8px">
      Dentro están las tablas <code>proveedores</code>, <code>facturas</code> y <code>ajustes</code>,
      y la vista <code>igic_por_proveedor</code> con los totales ya sumados.
    </p>`;
}
function exportSqlite() {
	const info = storageInfo();
	if (!info.sqlite) {
		toast("Este navegador no ha podido abrir SQLite, así que no hay fichero que descargar.", "bad", 6500);
		return;
	}
	const bytes = exportSqliteBytes();
	if (!bytes) {
		toast("No he podido preparar el fichero de la base de datos.", "bad");
		return;
	}
	downloadBytes(`facturas-igic-${todayISO()}.sqlite`, bytes, "application/vnd.sqlite3");
	toast("Base de datos descargada. Se abre con DB Browser for SQLite o similar.");
}
async function reviewJob(job) {
	const res = await openInvoiceModal({
		mode: "review",
		job
	});
	if (res) {
		job.state = "saved";
		job.savedLabel = `Guardada como ${res.invoice.number || "sin número"} · ${fmtEUR(res.invoice.total)}`;
	} else {
		job.state = "skipped";
	}
	paintIngest();
}
/* ------------------------------------------------------------------ */
/* Pegar texto                                                        */
/* ------------------------------------------------------------------ */
export function openPasteModal() {
	openModal(`<div class="modal-head">
      <div>
        <h2>Pegar el texto de la factura</h2>
        <p>Si tienes el texto (por ejemplo copiado de un correo), lo leo igual que una foto.</p>
      </div>
      <button class="icon-btn" data-modal-cancel aria-label="Cerrar">${icon("x")}</button>
    </div>
    <div class="modal-body">
      <div class="field">
        <label for="pasteArea">Texto de la factura</label>
        <textarea id="pasteArea" rows="10" placeholder="Proveedor: ...&#10;NIF: ...&#10;Factura nº: ...&#10;Base imponible: ...&#10;IGIC 7%: ...&#10;Total: ..."></textarea>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn primary" data-read>Leer los datos</button>
      <button class="btn ghost" data-modal-cancel>Cancelar</button>
    </div>`, { onMount(wrap) {
		wrap.querySelectorAll("[data-modal-cancel]").forEach((b) => b.addEventListener("click", () => closeModal()));
		wrap.querySelector("[data-read]").addEventListener("click", async () => {
			const text = wrap.querySelector("#pasteArea").value.trim();
			if (text.length < 10) {
				toast("Pega un poco más de texto.", "bad");
				return;
			}
			const parsed = parseInvoiceText(text, { defaultRate: getState().settings.defaultRate });
			const cls = await classifyDocument(text, getState().settings, { fileName: "texto pegado" });
			parsed.kind = cls.kind || "FACTURA";
			parsed.category = cls.category || "";
			parsed.direction = cls.direction || directionOf(parsed.kind);
			parsed.classifyWhy = cls.why || "";
			parsed.classifyNote = cls.note || "";
			closeModal();
			openInvoiceModal({
				mode: "review",
				job: {
					file: { name: "Texto pegado" },
					source: "pasted",
					parsed: {
						...parsed,
						rawText: text.slice(0, 6e3)
					}
				}
			});
		});
	} });
}
/* ------------------------------------------------------------------ */
/* Proveedor: alta y edición                                          */
/* ------------------------------------------------------------------ */
export function openSupplierModal(supplier = null) {
	const editing = !!supplier;
	openModal(`<div class="modal-head">
      <div>
        <h2>${editing ? "Editar proveedor" : "Nuevo proveedor"}</h2>
        <p>Lo normal es que se creen solos al subir una factura.</p>
      </div>
      <button class="icon-btn" data-modal-cancel aria-label="Cerrar">${icon("x")}</button>
    </div>
    <div class="modal-body">
      <div class="form-grid">
        <div class="field span-2">
          <label for="s-name">Nombre</label>
          <input id="s-name" type="text" value="${esc(supplier ? supplier.name : "")}" placeholder="Distribuciones Timanfaya S.L.">
        </div>
        <div class="field">
          <label for="s-nif">NIF / CIF</label>
          <input id="s-nif" type="text" value="${esc(supplier ? supplier.nif : "")}" placeholder="B12345678">
        </div>
        <div class="field">
          <label for="s-phone">Teléfono <span class="hint">(opcional)</span></label>
          <input id="s-phone" type="text" value="${esc(supplier ? supplier.phone : "")}" placeholder="922 000 000">
        </div>
        <div class="field span-2">
          <label for="s-email">Correo <span class="hint">(opcional)</span></label>
          <input id="s-email" type="text" value="${esc(supplier ? supplier.email : "")}" placeholder="facturas@proveedor.com">
        </div>
        <div class="field span-2">
          <label for="s-note">Nota <span class="hint">(opcional)</span></label>
          <input id="s-note" type="text" value="${esc(supplier ? supplier.note : "")}" placeholder="Forma de pago, persona de contacto…">
        </div>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn primary" data-save>${editing ? "Guardar cambios" : "Crear proveedor"}</button>
      <button class="btn ghost" data-modal-cancel>Cancelar</button>
    </div>`, { onMount(wrap) {
		wrap.querySelectorAll("[data-modal-cancel]").forEach((b) => b.addEventListener("click", () => closeModal()));
		wrap.querySelector("[data-save]").addEventListener("click", () => {
			const name = wrap.querySelector("#s-name").value.trim();
			if (!name) {
				toast("El proveedor necesita un nombre.", "bad");
				return;
			}
			const data = {
				name,
				nif: wrap.querySelector("#s-nif").value.trim(),
				phone: wrap.querySelector("#s-phone").value.trim(),
				email: wrap.querySelector("#s-email").value.trim(),
				note: wrap.querySelector("#s-note").value.trim()
			};
			if (editing) {
				updateSupplier(supplier.id, data);
				toast("Proveedor actualizado.");
			} else {
				const res = ensureSupplier(data.name, data.nif);
				if (res.created) {
					updateSupplier(res.supplier.id, {
						phone: data.phone,
						email: data.email,
						note: data.note
					});
					toast(`Proveedor «${res.supplier.name}» creado.`);
				} else {
					toast("Ese proveedor ya estaba en tu lista.", "bad");
				}
			}
			closeModal();
			render();
		});
	} });
}
/* ------------------------------------------------------------------ */
/* Ajustes                                                            */
/* ------------------------------------------------------------------ */
export function openSettings() {
	const s = getState().settings;
	const provider = aiProviderOf(s);
	openModal(`<div class="modal-head">
      <div>
        <h2>Ajustes</h2>
        <p>Lo que se aplica a las facturas nuevas</p>
      </div>
      <button class="icon-btn" data-modal-cancel aria-label="Cerrar">${icon("x")}</button>
    </div>
    <div class="modal-body">
      <div class="form-grid">
        <div class="field">
          <label for="set-rate">IGIC por defecto</label>
          <select id="set-rate">
            ${IGIC_RATES.map((r) => `<option value="${r.value}" ${Number(s.defaultRate) === r.value ? "selected" : ""}>${rateText(r.value)} — ${r.label.split("—")[1].trim()}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label for="set-name">Nombre de la empresa</label>
          <input id="set-name" type="text" value="${esc(s.businessName || "")}" placeholder="Agrosabina SL">
        </div>
      </div>

      <hr style="border:none;border-top:1px solid var(--line);margin:20px 0">

      <h3 style="font-size:14px;font-weight:650;margin-bottom:4px">Copia de seguridad</h3>
      <p style="font-size:13px;color:var(--ink-3);margin-bottom:12px">
        Los datos viven en este navegador. Si limpias el historial o cambias de ordenador, se pierden:
        descarga una copia de vez en cuando.
      </p>
      <div class="row wrap">
        <button class="btn sm" data-action="export-json">${icon("download")} Descargar copia</button>
        <button class="btn sm" data-action="import-json">${icon("upload")} Restaurar copia</button>
        <div class="spacer"></div>
        <button class="btn sm danger" data-action="clear-all">${icon("trash")} Borrar todo</button>
      </div>

      <hr style="border:none;border-top:1px solid var(--line);margin:20px 0">

      <h3 style="font-size:14px;font-weight:650;margin-bottom:4px">Interpretación con IA <span class="tag">opcional</span></h3>
      <p style="font-size:13px;color:var(--ink-3);margin-bottom:12px">
        Con esto encendido, la IA ayuda a leer los documentos: de qué tipo son, en qué concepto entran y, si es
        una liquidación, los kilos, el precio por kilo y los descuentos. A la IA solo le llega
        <strong>el texto ya leído</strong>, nunca la foto ni el PDF, y solo si tú escribes tu clave. Las reglas del
        programa siempre van primero: si la IA no contesta, se sigue con ellas.
      </p>
      <label style="display:flex;align-items:center;gap:9px;font-size:13.5px;font-weight:600;margin-bottom:12px">
        <input type="checkbox" id="set-ai-on" ${s.aiEnabled ? "checked" : ""}> Usar una IA para leer los documentos
      </label>
      <div class="form-grid">
        <div class="field span-2">
          <label for="set-ai-provider">Servicio</label>
          <select id="set-ai-provider">
            ${AI_PROVIDERS.map((p) => `<option value="${p.id}" ${provider.id === p.id ? "selected" : ""}>${p.label}</option>`).join("")}
          </select>
          <span class="hint" id="set-ai-provider-hint">${esc(provider.hint)}</span>
        </div>
        <div class="field span-2">
          <label for="set-ai-endpoint">Dirección del servicio</label>
          <input id="set-ai-endpoint" type="text" autocomplete="off" value="${esc(s.aiEndpoint || AI_DEFAULTS.aiEndpoint)}" placeholder="https://api.deepseek.com/v1">
          <span class="hint">Se rellena sola al elegir el servicio. Vale cualquier otro que hable el idioma de OpenAI.</span>
        </div>
        <div class="field">
          <label for="set-ai-model">Modelo</label>
          <input id="set-ai-model" type="text" autocomplete="off" value="${esc(s.aiModel || AI_DEFAULTS.aiModel)}" placeholder="deepseek-chat">
        </div>
        <div class="field">
          <label for="set-ai-key">Clave</label>
          <input id="set-ai-key" type="password" autocomplete="off" value="${esc(s.aiKey || "")}" placeholder="sk-…">
          <span class="hint">Se queda guardada en este navegador, junto a tus facturas.</span>
        </div>
      </div>
      <div class="row wrap" style="margin-top:12px">
        <button class="btn sm" data-action="test-ai">${icon("sparkle")} Probar la conexión</button>
        <span id="aiStatus" style="font-size:12.5px;color:var(--ink-3)"></span>
      </div>

      <hr style="border:none;border-top:1px solid var(--line);margin:20px 0">

      <h3 style="font-size:14px;font-weight:650;margin-bottom:4px">Base de datos SQLite</h3>
      ${sqlitePanel()}
    </div>
    <div class="modal-foot">
      <button class="btn primary" data-save>Guardar ajustes</button>
      <button class="btn ghost" data-modal-cancel>Cerrar</button>
    </div>`, { onMount(wrap) {
		wrap.querySelectorAll("[data-modal-cancel]").forEach((b) => b.addEventListener("click", () => closeModal()));
		// Elegir el servicio rellena la dirección y el modelo; después se
		// pueden cambiar a mano si el servicio usa otros nombres.
		const providerSel = wrap.querySelector("#set-ai-provider");
		const endpointInput = wrap.querySelector("#set-ai-endpoint");
		const modelInput = wrap.querySelector("#set-ai-model");
		const providerHint = wrap.querySelector("#set-ai-provider-hint");
		if (providerSel) {
			providerSel.addEventListener("change", () => {
				const chosen = AI_PROVIDERS.find((p) => p.id === providerSel.value);
				if (!chosen) return;
				if (providerHint) providerHint.textContent = chosen.hint;
				if (chosen.endpoint) {
					endpointInput.value = chosen.endpoint;
					modelInput.value = chosen.model;
				}
			});
		}
		wrap.querySelector("[data-save]").addEventListener("click", () => {
			updateSettings({
				defaultRate: Number(wrap.querySelector("#set-rate").value),
				businessName: wrap.querySelector("#set-name").value.trim(),
				aiEnabled: wrap.querySelector("#set-ai-on").checked,
				aiEndpoint: wrap.querySelector("#set-ai-endpoint").value.trim(),
				aiModel: wrap.querySelector("#set-ai-model").value.trim(),
				aiKey: wrap.querySelector("#set-ai-key").value.trim()
			});
			toast("Ajustes guardados.");
			closeModal();
			render();
		});
	} });
}
/* ------------------------------------------------------------------ */
/* Exportar                                                           */
/* ------------------------------------------------------------------ */
function csvCell(value) {
	const s = value == null ? "" : String(value);
	return `"${s.replace(/"/g, "\"\"")}"`;
}
export function exportCsv() {
	const list = sortedInvoices(filteredInvoices());
	if (!list.length) {
		toast("No hay facturas que exportar.", "bad");
		return;
	}
	const headers = [
		"Proveedor",
		"NIF",
		"Nº factura",
		"Fecha",
		"Vencimiento",
		"Base imponible",
		"Tipo IGIC (%)",
		"Cuota IGIC",
		"Total",
		"Estado",
		"Fecha de pago",
		"Origen"
	];
	const rows = list.map((inv) => {
		const sup = supplierById(inv.supplierId) || {};
		return [
			sup.name || "",
			sup.nif || "",
			inv.number || "",
			fmtDate(inv.issueDate),
			inv.dueDate ? fmtDate(inv.dueDate) : "",
			fmtNum(inv.base),
			inv.rate != null ? fmtNum(inv.rate, inv.rate % 1 === 0 ? 0 : 1) : "",
			fmtNum(inv.igic),
			fmtNum(inv.total),
			inv.status === STATUS.PAID ? "Pagado" : "Pendiente",
			inv.paidDate ? fmtDate(inv.paidDate) : "",
			sourceLabel(inv.source)
		].map(csvCell).join(";");
	});
	const csv = "﻿" + [headers.map(csvCell).join(";"), ...rows].join("\r\n");
	downloadText(`facturas-${todayISO()}.csv`, csv);
	toast(`Exportadas ${list.length} facturas.`);
}
export function exportBackup() {
	downloadText(`copia-facturas-${todayISO()}.json`, exportJSON(), "application/json");
	toast("Copia descargada.");
}
export function askImportBackup() {
	const input = document.createElement("input");
	input.type = "file";
	input.accept = "application/json,.json";
	input.addEventListener("change", async () => {
		const file = input.files && input.files[0];
		if (!file) return;
		try {
			const text = await file.text();
			const ok = await confirmDialog({
				title: "Restaurar una copia",
				message: "Se sustituirán las facturas y proveedores que tienes ahora por los de la copia. ¿Seguir?",
				confirm: "Sí, restaurar",
				danger: true
			});
			if (!ok) return;
			importJSON(text);
			toast("Copia restaurada.");
			closeModal();
			render();
		} catch (err) {
			toast(err.message || "No he podido leer esa copia.", "bad");
		}
	});
	input.click();
}
/* ------------------------------------------------------------------ */
/* Acciones                                                           */
/* ------------------------------------------------------------------ */
export async function onAction(action, el) {
	const id = el.dataset.id;
	switch (action) {
		case "new-sale": {
			openInvoiceModal({
				mode: "new",
				preset: {
					kind: "LIQUIDACION",
					direction: "INGRESO"
				}
			});
			return;
		}
		case "export-sales-csv": {
			exportSalesCsv();
			return;
		}
		case "toggle-status": {
			const inv = getState().invoices.find((i) => i.id === id);
			if (!inv) return;
			const isIncome = directionOf(inv.kind) === "INGRESO";
			// Si ya está cobrado o pagado, volver a pendiente borra la fecha y se dice.
			if (inv.status === STATUS.PAID) {
				setInvoiceStatus(id, STATUS.PENDING);
				toast(isIncome ? "Vuelve a estar por cobrar: se ha borrado la fecha de cobro." : "Vuelve a estar pendiente: se ha borrado la fecha de pago.");
				render();
				return;
			}
			askPaidDate(inv, isIncome, (day) => {
				setInvoiceStatus(id, STATUS.PAID, day);
				toast(isIncome ? `Cobrado el ${fmtDate(day)}.` : `Pagado el ${fmtDate(day)}.`);
				render();
			});
			return;
		}
		case "edit-invoice": {
			const inv = getState().invoices.find((i) => i.id === id);
			if (inv) openInvoiceModal({
				mode: "edit",
				invoice: inv
			});
			return;
		}
		case "delete-invoice": {
			const inv = getState().invoices.find((i) => i.id === id);
			if (!inv) return;
			const ok = await confirmDialog({
				title: "Borrar la factura",
				message: `Se borrará la factura ${inv.number || "sin número"} de ${supplierName(inv.supplierId)} (${fmtEUR(inv.total)}). El proveedor se queda en la lista.`,
				confirm: "Sí, borrarla",
				danger: true
			});
			if (!ok) return;
			deleteInvoice(id);
			toast("Factura borrada.");
			render();
			return;
		}
		case "new-invoice":
			openInvoiceModal({ mode: "new" });
			return;
		case "new-supplier":
			openSupplierModal();
			return;
		case "edit-supplier": {
			const s = getState().suppliers.find((x) => x.id === id);
			if (s) openSupplierModal(s);
			return;
		}
		case "delete-supplier": {
			const s = getState().suppliers.find((x) => x.id === id);
			if (!s) return;
			const n = invoicesOf(s.id).length;
			const ok = await confirmDialog({
				title: "Borrar el proveedor",
				message: n ? `Se borrará «${s.name}» y sus ${n} facturas. Esto no se puede deshacer.` : `Se borrará «${s.name}». No tiene facturas.`,
				confirm: "Sí, borrarlo",
				danger: true
			});
			if (!ok) return;
			deleteSupplier(id);
			toast("Proveedor borrado.");
			render();
			return;
		}
		case "filter-supplier":
			ui.filters.supplier = id;
			ui.filters.status = "all";
			location.hash = "#/compras";
			render();
			return;
		case "import-files":
			document.getElementById("filePicker").click();
			return;
		case "import-camera":
			importFromCamera();
			return;
		case "export-sqlite":
			exportSqlite();
			return;
		case "paste-text":
			openPasteModal();
			return;
		case "import-email":
			pickEmails();
			return;
		case "paste-mail":
			openMailPasteModal();
			return;
		case "use-mail":
			useMail(id);
			return;
		case "delete-mail": {
			const ok = await confirmDialog({
				title: "Borrar el correo",
				message: "Se quita de la lista. Las facturas que ya hayas guardado desde él no se tocan.",
				confirm: "Sí, borrar",
				danger: true
			});
			if (!ok) return;
			deleteMessage(id);
			toast("Correo borrado.");
			render();
			return;
		}
		case "test-ai":
			testAi();
			return;
		case "export-csv":
			exportCsv();
			return;
		case "export-json":
			exportBackup();
			return;
		case "import-json":
			askImportBackup();
			return;
		case "settings":
			openSettings();
			return;
		case "clear-all": {
			const ok = await confirmDialog({
				title: "Borrar todo",
				message: "Se borrarán todas las facturas y todos los proveedores. Descarga antes una copia si no estás seguro.",
				confirm: "Sí, borrar todo",
				danger: true
			});
			if (!ok) return;
			clearAll();
			closeModal();
			toast("Todo borrado. Empiezas de cero.");
			render();
			return;
		}
		case "seed-demo": {
			const ok = await confirmDialog({
				title: "Cargar datos de ejemplo",
				message: "Se añadirán 5 proveedores inventados y 11 facturas para que veas cómo funciona. Podrás borrarlo todo después.",
				confirm: "Sí, cargar el ejemplo"
			});
			if (!ok) return;
			seedDemo();
			toast("Datos de ejemplo cargados.");
			render();
			return;
		}
		case "retry-job": {
			const job = ui.jobs.find((j) => j.id === id);
			if (job) {
				job.state = "queued";
				job.pct = 0;
				job.error = "";
				paintIngest();
				runQueue();
			}
			return;
		}
		case "acc-tab": {
			ui.conta.tab = id || "diario";
			render();
			return;
		}
		case "acc-apertura":
		case "acc-settings": {
			accAperturaModal();
			return;
		}
		case "acc-save-apertura": {
			saveApertura();
			return;
		}
		case "export-acc-csv": {
			exportAccCsv();
			return;
		}
		default: return;
	}
}
/* ------------------------------------------------------------------ */
/* Buscadores                                                         */
/* ------------------------------------------------------------------ */
export function onInput(event) {
	const target = event.target;
	if (!(target instanceof HTMLElement)) return;
	if (target.id === "invoiceSearch") {
		ui.filters.q = target.value;
		refreshInvoiceTable();
		return;
	}
	if (target.id === "supplierSearch") {
		ui.supplierQuery = target.value;
		const pos = target.selectionStart;
		refreshSupplierGrid();
		const again = document.getElementById("supplierSearch");
		if (again) {
			again.focus();
			try {
				again.setSelectionRange(pos, pos);
			} catch (_) {}
		}
	}
}
export function onChange(event) {
	const target = event.target;
	if (!(target instanceof HTMLElement)) return;
	if (target.id === "accRange") {
		ui.conta.range = target.value;
		if (ui.conta.range === "custom") {
			if (!ui.conta.from) ui.conta.from = `${new Date().getFullYear()}-01-01`;
			if (!ui.conta.to) ui.conta.to = todayISO();
		}
		render();
		return;
	}
	if (target.id === "accFrom" || target.id === "accTo") {
		ui.conta[target.id === "accFrom" ? "from" : "to"] = target.value;
		render();
		return;
	}
	if (target.id === "salesRange") {
		ui.sales.range = target.value;
		if (ui.sales.range === "custom") {
			if (!ui.sales.from) ui.sales.from = `${new Date().getFullYear()}-01-01`;
			if (!ui.sales.to) ui.sales.to = todayISO();
		}
		refreshSales();
		return;
	}
	if (target.id === "salesFrom" || target.id === "salesTo") {
		ui.sales[target.id === "salesFrom" ? "from" : "to"] = target.value;
		refreshSales();
		return;
	}
	if (target.matches("[data-filter-supplier]")) {
		ui.filters.supplier = target.value;
		refreshInvoiceTable();
	}
}
export function onFilterButton(button) {
	ui.filters.status = button.dataset.filterStatus;
	refreshInvoiceTable();
}
export function onDirectionButton(button) {
	ui.filters.direction = button.dataset.filterDirection || "all";
	document.querySelectorAll("[data-filter-direction]").forEach((b) => {
		b.classList.toggle("active", b.dataset.filterDirection === ui.filters.direction);
	});
	refreshInvoiceTable();
}
/* ------------------------------------------------------------------ */
/* Arrastrar y soltar                                                 */
/* ------------------------------------------------------------------ */
export function wireDropzone() {
	document.addEventListener("dragover", (ev) => {
		const dz = ev.target instanceof Element ? ev.target.closest("#dropzone, #mailDrop") : null;
		if (!dz) return;
		ev.preventDefault();
		dz.classList.add("drag");
	});
	document.addEventListener("dragleave", (ev) => {
		const dz = ev.target instanceof Element ? ev.target.closest("#dropzone, #mailDrop") : null;
		if (dz) dz.classList.remove("drag");
	});
	document.addEventListener("drop", (ev) => {
		const dz = ev.target instanceof Element ? ev.target.closest("#dropzone, #mailDrop") : null;
		if (!dz) return;
		ev.preventDefault();
		dz.classList.remove("drag");
		if (ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files.length) {
			if (dz.id === "mailDrop") importEmails(ev.dataTransfer.files);
			else queueFiles(ev.dataTransfer.files);
		}
	});
}
export function hasJobs() {
	return ui.jobs.length > 0;
}
/* ------------------------------------------------------------------ */
/* Contabilidad                                                       */
/* ------------------------------------------------------------------ */
const ACC_TABS = [
	["diario", "Diario"],
	["mayor", "Mayor"],
	["sumas", "Sumas y saldos"],
	["balance", "Balance de situación"],
	["resultados", "Pérdidas y ganancias"]
];
/** El periodo contable que se está mirando. */
function contaWindow() {
	return windowFor(ui.conta);
}
/** Los documentos con el nombre de su proveedor o comprador, listos para contabilizar. */
function accDocs() {
	const state = getState();
	const names = new Map((state.suppliers || []).map((s) => [s.id, s.name]));
	return (state.invoices || []).map((inv) => Object.assign({}, inv, { party: names.get(inv.supplierId) || "" }));
}
/** El asiento de apertura, si ya se han dicho el capital y el saldo de bancos. */
function accApertura() {
	const s = getState().settings || {};
	const capital = Number(s.openingCapital) || 0;
	const tesoreria = Number(s.openingCash) || 0;
	if (!capital && !tesoreria) return null;
	return {
		capital,
		tesoreria,
		fecha: String(s.openingDate || "").slice(0, 10)
	};
}
/** Los asientos del periodo elegido. */
function asientosContables(w) {
	const win = w || contaWindow();
	return asientosDe(accDocs(), {
		from: win.from,
		to: win.to,
		apertura: accApertura()
	});
}
/** Un número escrito a mano: vale «1.234,56» y «1234.56». */
function accNum(value) {
	const txt = String(value == null ? "" : value).replace(/[€\s]/g, "");
	if (!txt) return 0;
	const last = Math.max(txt.lastIndexOf(","), txt.lastIndexOf("."));
	const clean = last > -1 && txt.length - last <= 3 && txt.indexOf(",", last + 1) === -1 ? txt.slice(0, last).replace(/[.,]/g, "") + "." + txt.slice(last + 1) : txt.replace(/[.,]/g, "");
	const n = Number(clean);
	return Number.isFinite(n) ? round2(n) : 0;
}
function accRangeBar(w) {
	return `
    <div class="filters">
      <select id="accRange" aria-label="Elegir el periodo">
        ${SALES_RANGES.map((r) => `<option value="${r.id}"${ui.conta.range === r.id ? " selected" : ""}>${r.label}</option>`).join("")}
      </select>
      ${ui.conta.range === "custom" ? `
      <label class="date-filter"><span>Desde</span><input id="accFrom" type="date" value="${esc(ui.conta.from)}" aria-label="Desde"></label>
      <label class="date-filter"><span>Hasta</span><input id="accTo" type="date" value="${esc(ui.conta.to)}" aria-label="Hasta"></label>` : ""}
      <div class="spacer"></div>
      <span class="tag kind">${esc(w.label)}</span>
    </div>`;
}
function accTabBar() {
	return `<div class="acc-tabs" role="tablist">
    ${ACC_TABS.map(([id, label]) => `<button class="acc-tab${ui.conta.tab === id ? " is-on" : ""}" data-action="acc-tab" data-id="${id}" role="tab" aria-selected="${ui.conta.tab === id}">${label}</button>`).join("")}
  </div>`;
}
function accEmpty(text) {
	return `<section class="card"><div class="empty">
    <div class="e-icon">${icon("file")}</div>
    <h3>Todavía no hay nada que contabilizar</h3>
    <p>${esc(text || "Los asientos salen solos de lo que ya tienes guardado: facturas, liquidaciones, subvenciones y nóminas. En cuanto haya un documento con fecha e importe en este periodo, aparece aquí.")}</p>
    <div class="e-actions">
      <a class="btn primary" href="#/compras">${icon("plus")} Ir a compras</a>
      <a class="btn" href="#/ventas">${icon("wallet")} Ir a ventas</a>
    </div>
  </div></section>`;
}
/** Diario: un renglón por cuenta y asiento, con la fecha y el número del asiento. */
function accDiarioHtml(entries) {
	if (!entries.length) return accEmpty();
	let debe = 0;
	let haber = 0;
	const rows = [];
	for (const e of entries) {
		const sumDebe = round2(e.lines.reduce((n, l) => n + l.debit, 0));
		const sumHaber = round2(e.lines.reduce((n, l) => n + l.credit, 0));
		debe = round2(debe + sumDebe);
		haber = round2(haber + sumHaber);
		e.lines.forEach((l, i) => {
			rows.push(`<tr class="acc-row${i === 0 ? " acc-row-first" : ""}">
        <td class="num">${i === 0 ? fmtDate(e.date) : ""}</td>
        <td class="num">${i === 0 ? e.number : ""}</td>
        <td class="mono">${esc(l.account)}</td>
        <td>
          <span class="acc-name">${esc(l.name)}</span>
          ${i === 0 && e.concept ? `<div class="sub">${esc(e.concept)}</div>` : ""}
        </td>
        <td class="num">${l.debit ? fmtEUR(l.debit) : ""}</td>
        <td class="num">${l.credit ? fmtEUR(l.credit) : ""}</td>
      </tr>`);
		});
	}
	return `
  <section class="card">
    <div class="card-head">
      <div>
        <h2>Libro diario</h2>
        <p>${entries.length} ${entries.length === 1 ? "asiento" : "asientos"} en orden de fecha</p>
      </div>
      <div class="spacer"></div>
      <button class="btn sm ghost" data-action="export-acc-csv">${icon("download")}<span>Exportar CSV</span></button>
    </div>
    <div class="table-wrap">
      <table class="data acc-table">
        <thead><tr>
          <th>Fecha</th><th class="num">Asiento</th><th>Cuenta</th><th>Concepto</th>
          <th class="num">Debe</th><th class="num">Haber</th>
        </tr></thead>
        <tbody>${rows.join("")}</tbody>
        <tfoot><tr>
          <td colspan="4">Sumas del periodo</td>
          <td class="num">${fmtEUR(debe)}</td>
          <td class="num">${fmtEUR(haber)}</td>
        </tr></tfoot>
      </table>
    </div>
  </section>`;
}
/** Mayor: una tarjeta por cuenta con sus movimientos y el saldo que va quedando. */
function accMayorHtml(mayor) {
	if (!mayor.length) return accEmpty();
	return `
  <div class="acc-toolbar-note">
    <span class="tag kind">${mayor.length} ${mayor.length === 1 ? "cuenta" : "cuentas"} con movimiento</span>
    <button class="btn sm ghost" data-action="export-acc-csv">${icon("download")}<span>Exportar CSV</span></button>
  </div>
  <div class="stack">
  ${mayor.map((r) => `
    <section class="card acc-account">
      <div class="card-head">
        <div>
          <h2><span class="mono">${esc(r.code)}</span> ${esc(r.name)}</h2>
          <p>${r.moves.length} ${r.moves.length === 1 ? "movimiento" : "movimientos"} · saldo ${r.saldo >= 0 ? "deudor" : "acreedor"} ${fmtEUR(Math.abs(r.saldo))}</p>
        </div>
      </div>
      <div class="table-wrap">
        <table class="data acc-table">
          <thead><tr>
            <th>Fecha</th><th class="num">Asiento</th><th>Concepto</th>
            <th class="num">Debe</th><th class="num">Haber</th><th class="num">Saldo</th>
          </tr></thead>
          <tbody>
            ${r.moves.map((m) => `<tr class="acc-row">
              <td class="num">${fmtDate(m.date)}</td>
              <td class="num">${m.number}</td>
              <td><span class="acc-name">${esc(m.concept)}</span></td>
              <td class="num">${m.debit ? fmtEUR(m.debit) : ""}</td>
              <td class="num">${m.credit ? fmtEUR(m.credit) : ""}</td>
              <td class="num strong">${fmtEUR(m.running)}</td>
            </tr>`).join("")}
          </tbody>
          <tfoot><tr>
            <td colspan="3">Sumas y saldo</td>
            <td class="num">${fmtEUR(r.debit)}</td>
            <td class="num">${fmtEUR(r.credit)}</td>
            <td class="num">${fmtEUR(r.saldo)}</td>
          </tr></tfoot>
        </table>
      </div>
    </section>`).join("")}
  </div>`;
}
/** Balance de sumas y saldos: lo que se ha movido en cada cuenta y lo que queda. */
function accSumasHtml(sumas) {
	if (!sumas.rows.length) return accEmpty();
	return `
  <section class="card">
    <div class="card-head">
      <div>
        <h2>Balance de sumas y saldos</h2>
        <p>${sumas.rows.length} ${sumas.rows.length === 1 ? "cuenta" : "cuentas"} · ${sumas.cuadra ? "los saldos cuadran" : "los saldos no cuadran"}</p>
      </div>
      <div class="spacer"></div>
      <button class="btn sm ghost" data-action="export-acc-csv">${icon("download")}<span>Exportar CSV</span></button>
    </div>
    <div class="table-wrap">
      <table class="data acc-table">
        <thead><tr>
          <th>Cuenta</th><th>Nombre</th>
          <th class="num">Suma debe</th><th class="num">Suma haber</th>
          <th class="num">Saldo deudor</th><th class="num">Saldo acreedor</th>
        </tr></thead>
        <tbody>
          ${sumas.rows.map((r) => `<tr class="acc-row">
            <td class="mono">${esc(r.code)}</td>
            <td><span class="acc-name">${esc(r.name)}</span></td>
            <td class="num">${fmtEUR(r.debit)}</td>
            <td class="num">${fmtEUR(r.credit)}</td>
            <td class="num">${r.deudor ? fmtEUR(r.deudor) : "<span class=\"muted\">—</span>"}</td>
            <td class="num">${r.acreedor ? fmtEUR(r.acreedor) : "<span class=\"muted\">—</span>"}</td>
          </tr>`).join("")}
        </tbody>
        <tfoot><tr>
          <td colspan="2">Totales</td>
          <td class="num">${fmtEUR(sumas.totals.debit)}</td>
          <td class="num">${fmtEUR(sumas.totals.credit)}</td>
          <td class="num">${fmtEUR(sumas.totals.deudor)}</td>
          <td class="num">${fmtEUR(sumas.totals.acreedor)}</td>
        </tr></tfoot>
      </table>
    </div>
    ${sumas.cuadra ? "" : `<div class="acc-warn">Los saldos deudores y acreedores no suman lo mismo. Revisa los documentos del periodo.</div>`}
  </section>`;
}
/** Balance de situación, con los epígrafes del modelo oficial. */
function accBalanceHtml(bal, resultado) {
	const rows = bal.rows.map((r) => {
		const total = r.kind === "total" || r.kind === "grand";
		const shown = total ? fmtEUR(r.value) : r.value ? fmtEUR(r.value) : "<span class=\"muted\">—</span>";
		return `<tr class="acc-row acc-${r.kind}">
      <td class="acc-label">${esc(r.label)}</td>
      <td class="num">${shown}</td>
    </tr>`;
	});
	const aviso = bal.cuadra ? "" : `<div class="acc-warn">
        <strong>El balance no cuadra por ${fmtEUR(Math.abs(bal.descuadre))}.</strong>
        Lo normal es que falte el asiento de apertura: el capital social y el dinero que había en el banco el primer día.
        Mientras no se pongan, el activo y el patrimonio no pueden coincidir.
        <button class="btn sm" data-action="acc-apertura">${icon("edit")}<span>Poner los datos de partida</span></button>
      </div>`;
	return `
  <section class="card">
    <div class="card-head">
      <div>
        <h2>Balance de situación</h2>
        <p>Modelo oficial del Plan General de Contabilidad · resultado del periodo ${fmtEUR(resultado)}</p>
      </div>
      <div class="spacer"></div>
      <button class="btn sm ghost" data-action="export-acc-csv">${icon("download")}<span>Exportar CSV</span></button>
    </div>
    <div class="table-wrap">
      <table class="data acc-table acc-balance">
        <thead><tr><th>Epígrafe</th><th class="num">Importe</th></tr></thead>
        <tbody>${rows.join("")}</tbody>
        <tfoot><tr>
          <td>Comprobación: activo − (patrimonio neto + pasivo)</td>
          <td class="num">${fmtEUR(bal.descuadre)}</td>
        </tr></tfoot>
      </table>
    </div>
    ${aviso}
  </section>`;
}
/** Cuenta de pérdidas y ganancias, también con el modelo oficial. */
function accResultadosHtml(pyg) {
	const rows = pyg.lines.map((l) => {
		const shown = l.total ? fmtEUR(l.value) : l.value ? fmtEUR(l.value) : "<span class=\"muted\">—</span>";
		return `<tr class="acc-row ${l.total ? "acc-total" : ""}">
      <td class="acc-label">${esc(l.label)}</td>
      <td class="num">${shown}</td>
    </tr>`;
	});
	const aviso = pyg.sinClasificar ? `<div class="acc-warn">Hay ${fmtEUR(Math.abs(pyg.sinClasificar))} en cuentas de gasto o ingreso que no he sabido colocar en ninguna línea del modelo. Revisa el concepto de esos documentos.</div>` : "";
	return `
  <section class="card">
    <div class="card-head">
      <div>
        <h2>Cuenta de pérdidas y ganancias</h2>
        <p>Modelo oficial del Plan General de Contabilidad · los gastos van en negativo</p>
      </div>
      <div class="spacer"></div>
      <button class="btn sm ghost" data-action="export-acc-csv">${icon("download")}<span>Exportar CSV</span></button>
    </div>
    <div class="table-wrap">
      <table class="data acc-table acc-balance">
        <thead><tr><th>Concepto</th><th class="num">Importe</th></tr></thead>
        <tbody>${rows.join("")}</tbody>
      </table>
    </div>
    ${aviso}
  </section>`;
}
/** El libro que está elegido en las pestañas. */
function accBody() {
	const entries = asientosContables();
	const mayor = libroMayor(entries);
	if (ui.conta.tab === "mayor") return accMayorHtml(mayor);
	if (ui.conta.tab === "sumas") return accSumasHtml(balanceSumasYSaldos(mayor));
	if (ui.conta.tab === "balance") {
		const pyg = cuentaResultados(mayor);
		return accBalanceHtml(balanceSituacion(mayor, pyg.resultado), pyg.resultado);
	}
	if (ui.conta.tab === "resultados") return accResultadosHtml(cuentaResultados(mayor));
	return accDiarioHtml(entries);
}
function viewContabilidad() {
	const w = contaWindow();
	return `
  <div class="stack">
    <section class="card">
      <div class="card-body acc-head">
        ${accRangeBar(w)}
        ${accTabBar()}
      </div>
    </section>
    <div id="accBody">${accBody()}</div>
  </div>`;
}
/** Los datos de partida: con qué capital y con cuánto dinero en el banco se empezó. */
function accAperturaModal() {
	const s = getState().settings || {};
	openModal(`<div class="modal-head">
       <div>
         <h2>Datos de partida</h2>
         <p>Con esto se hace el asiento de apertura. Sin él, el balance no puede cuadrar.</p>
       </div>
       <button class="icon-btn" data-modal-cancel aria-label="Cerrar">${icon("x")}</button>
     </div>
     <div class="modal-body">
       <div class="form-grid">
         <label class="field">
           <span>Capital social (€)</span>
           <input id="accCapital" type="text" inputmode="decimal" value="${s.openingCapital ? esc(String(s.openingCapital)) : ""}" placeholder="3.000,00">
         </label>
         <label class="field">
           <span>Dinero en el banco y en caja (€)</span>
           <input id="accCash" type="text" inputmode="decimal" value="${s.openingCash ? esc(String(s.openingCash)) : ""}" placeholder="12.000,00">
         </label>
         <label class="field">
           <span>Fecha de apertura</span>
           <input id="accDate" type="date" value="${esc(s.openingDate || "")}">
         </label>
       </div>
       <p class="muted">Si el dinero del banco es más que el capital, la diferencia se apunta en reservas; si es menos, en resultados negativos. No me invento ninguna cifra.</p>
     </div>
     <div class="modal-foot">
       <button class="btn primary" data-action="acc-save-apertura">${icon("check")}<span>Guardar</span></button>
       <button class="btn ghost" data-modal-cancel>Cancelar</button>
     </div>`, {
		narrow: true,
		onMount: (wrap) => {
			wrap.querySelectorAll("[data-modal-cancel]").forEach((el) => {
				el.addEventListener("click", () => closeModal());
			});
		}
	});
}
/** Guarda los datos de partida y vuelve a pintar. */
function saveApertura() {
	const cap = document.getElementById("accCapital");
	const cash = document.getElementById("accCash");
	const day = document.getElementById("accDate");
	const capital = accNum(cap ? cap.value : "");
	const tesoreria = accNum(cash ? cash.value : "");
	const fecha = String(day && day.value || "").slice(0, 10) || `${new Date().getFullYear()}-01-01`;
	updateSettings({
		openingCapital: capital,
		openingCash: tesoreria,
		openingDate: fecha
	});
	closeModal();
	toast(capital || tesoreria ? `Datos de partida guardados: ${fmtEUR(capital)} de capital y ${fmtEUR(tesoreria)} en bancos.` : "Datos de partida borrados.", "ok");
	render();
}
/** Descarga en CSV lo que se está viendo. */
function exportAccCsv() {
	const w = contaWindow();
	const entries = asientosContables(w);
	if (!entries.length) {
		toast("No hay asientos en ese periodo.", "warn");
		return;
	}
	const mayor = libroMayor(entries);
	let headers = [];
	let rows = [];
	const tab = ui.conta.tab;
	if (tab === "mayor") {
		headers = [
			"Cuenta",
			"Nombre",
			"Fecha",
			"Asiento",
			"Concepto",
			"Debe",
			"Haber",
			"Saldo"
		];
		for (const r of mayor) {
			for (const m of r.moves) {
				rows.push([
					r.code,
					r.name,
					m.date,
					m.number,
					m.concept,
					fmtNum(m.debit),
					fmtNum(m.credit),
					fmtNum(m.running)
				]);
			}
		}
	} else if (tab === "sumas") {
		const sumas = balanceSumasYSaldos(mayor);
		headers = [
			"Cuenta",
			"Nombre",
			"Suma debe",
			"Suma haber",
			"Saldo deudor",
			"Saldo acreedor"
		];
		rows = sumas.rows.map((r) => [
			r.code,
			r.name,
			fmtNum(r.debit),
			fmtNum(r.credit),
			fmtNum(r.deudor),
			fmtNum(r.acreedor)
		]);
		rows.push([
			"",
			"TOTALES",
			fmtNum(sumas.totals.debit),
			fmtNum(sumas.totals.credit),
			fmtNum(sumas.totals.deudor),
			fmtNum(sumas.totals.acreedor)
		]);
	} else if (tab === "balance") {
		const pyg = cuentaResultados(mayor);
		const bal = balanceSituacion(mayor, pyg.resultado);
		headers = ["Epígrafe", "Importe"];
		rows = bal.rows.map((r) => [r.label, fmtNum(r.value)]);
		rows.push(["Comprobación (activo − patrimonio y pasivo)", fmtNum(bal.descuadre)]);
	} else if (tab === "resultados") {
		const pyg = cuentaResultados(mayor);
		headers = ["Concepto", "Importe"];
		rows = pyg.lines.map((l) => [l.label, fmtNum(l.value)]);
	} else {
		headers = [
			"Fecha",
			"Asiento",
			"Cuenta",
			"Nombre",
			"Concepto",
			"Debe",
			"Haber"
		];
		for (const e of entries) {
			for (const l of e.lines) {
				rows.push([
					e.date,
					e.number,
					l.account,
					l.name,
					e.concept,
					fmtNum(l.debit),
					fmtNum(l.credit)
				]);
			}
		}
	}
	const csv = "﻿" + [headers.map(csvCell).join(";"), ...rows.map((r) => r.map(csvCell).join(";"))].join("\r\n");
	downloadText(`contabilidad-${tab}-${w.from || "todo"}-${todayISO()}.csv`, csv);
	toast(`Descargado el ${tab === "sumas" ? "balance de sumas y saldos" : tab}.`);
}
