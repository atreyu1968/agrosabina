/*
 * Las pantallas del sitio y lo que hace cada botón.
 */
import { renderFruitControl } from "./fruit-control-view.js";

import {
  IGIC_RATES,
  STATUS,
  daysUntil,
  downloadBytes,
  downloadText,
  esc,
  fmtDate,
  fmtEUR,
  fmtNum,
  initials,
  lastMonths,
  monthKey,
  monthLabel,
  normaliseSpanishNif,
  parseAmount,
  round2,
  todayISO,
  uid,
} from "./util.js";
import {
  addInvoice,
  addMessage,
  activeExerciseYear,
  applyBankReconciliation,
  clearAll,
  deleteInvoice,
  deleteMessage,
  deleteSupplier,
  ensureSupplier,
  exportJSON,
  exportCompleteBackup,
  importCompleteBackup,
  findDuplicate,
  findSupplierByNameOrNif,
  exerciseDateError,
  getState,
  importJSON,
  invoicesOf,
  markMessageUsed,
  messages,
  seedDemo,
  saveWorked,
  setInvoiceStatus,
  sortedInvoices,
  statsBySupplier,
  supplierById,
  toggleInvoiceStatus,
  totals,
  updateInvoice,
  updateSettings,
  updateSupplier,
  exportSqliteBytes,
  sqliteIgicSummary,
  storageInfo,
  keepInvoiceOriginal,
  invoiceOriginalBody,
  originalsUsage,
} from "./store.js";
import { MAX_BACKUP_BYTES, unpackCompleteBackup } from "./complete-backup.js";
import { parseKg, parseLiquidacion, parsePrice, looksLikeInvoice } from "./parse.js";
import { leerDocumento, importadoresDisponibles } from "./importers.js";
import { documentPageImages, describeFile, readFile, sourceLabel } from "./read.js";
import { cameraSupported, openCamera } from "./camera.js";
import {
  categoryInfo,
  categoryOptions,
  classifyLocal,
  directionOf,
  invoiceDirection,
  kindInfo,
  kindOptions,
} from "./model.js";
import { AI_DEFAULTS, AI_PROVIDERS, aiConfigured, aiExtract, aiPing, aiProviderOf, classifyDocument } from "./ai.js";
import { isEmailFile, looksLikeInvoiceMail, parseEml } from "./mail.js";
import {
  asientosDe,
  balanceSituacion,
  balanceSumasYSaldos,
  claveDeTercero,
  claveDeTrabajador,
  cuentaResultados,
  libroMayor,
  setPlanDeCuentas,
  aperturaDesdeCierre,
} from "./accounting.js";
import { pgcNombre, siguienteSubcuenta } from "./pgc.js";
import { igicPorTrimestre, tesoreriaPorCuenta, vencimientos } from "./erp.js";
import { parseBankStatement, statementFingerprint, suggestBankMatches } from "./bank-reconciliation.js";
import { dropOriginal, keepOriginal, originalOf } from "./files.js";
import { CUENTAS_NOMINA, calcularNomina, esNomina } from "./nomina.js";
import { informeBalancePdf, informeResultadosPdf } from "./reports.js";
import {
  closeModal,
  confirmDialog,
  icon,
  modalIsOpen,
  openModal,
  toast,
} from "./dom.js";

/* ------------------------------------------------------------------ */
/* Estado de la interfaz                                              */
/* ------------------------------------------------------------------ */


/*
 * Las pantallas del sitio y lo que hace cada botón.
 */
/* ------------------------------------------------------------------ */
/* Estado de la interfaz                                              */
/* ------------------------------------------------------------------ */

export const ui = {
  route: "resumen",
  filters: { status: "all", supplier: "", q: "", direction: "GASTO" },
  supplierQuery: "",
  // Pantalla de terceros: si se miran los proveedores, los clientes o todos.
  supplierRole: "PROVEEDOR",
  jobs: [],
  // Pantalla de ventas: periodo elegido y fechas a mano.
  sales: { range: "year", from: "", to: "" },
  // Pantalla de contabilidad: qué libro se mira y de qué fechas. Empieza en «Todo lo
  // registrado» para que se vea la contabilidad entera desde el primer momento.
  conta: { tab: "diario", range: "all", from: "", to: "", year: new Date().getFullYear() },
  // Pantalla de documentos: el archivo de todo lo guardado, con buscador y filtros.
  docs: { q: "", kind: "all", dir: "all", status: "all", supplier: "", range: "all", from: "", to: "", sort: "recent" },
  // Banco de pruebas de lectura: los documentos que se han soltado para mirarlos.
  // No se guarda nada: se vacía al cerrar la pestaña.
  pruebas: { list: [], busy: false, status: "" },
};

const ROUTES = [
  "resumen",
  "ventas",
  "control-fruta",
  "nominas",
  "contabilidad",
  "compras",
  "proveedores",
  "documentos",
  "correo",
  "importar",
  "pruebas",
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
  const ajustes = getState().settings || {};
  const guardadas = Array.isArray(ajustes.bankAccounts) ? ajustes.bankAccounts : [];
  const cajaNombre = String(ajustes.cashAccount || "").trim() || "Caja general";
  const medioInicial = ["CAJA", "TARJETA"].includes(String(inv.payMethod || "").toUpperCase()) ? String(inv.payMethod).toUpperCase() : "BANCO";
  const cuentaInicial =
    String(inv.payAccount || "").trim() || (medioInicial === "CAJA" ? cajaNombre : guardadas[0] || "");
  const cuentasGuardadas = guardadas
    .map((c) => `<option value="${esc(c)}"></option>`)
    .join("");
  openModal(
    `<div class="modal-head">
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
      <div class="field">
        <label>¿Cómo se ${isIncome ? "ha cobrado" : "ha pagado"}?</label>
        <div class="segmented" id="paid-method" data-value="${medioInicial}">
          <button type="button" data-method="CAJA" class="${medioInicial === "CAJA" ? "active" : ""}">En efectivo (caja)</button>
          <button type="button" data-method="BANCO" class="${medioInicial === "BANCO" ? "active" : ""}">Por el banco</button>
          <button type="button" data-method="TARJETA" class="${medioInicial === "TARJETA" ? "active" : ""}">Con tarjeta</button>
        </div>
        <span class="hint">La caja entra en la cuenta 570; banco y tarjeta, en la 572.</span>
      </div>
      <div class="field">
        <label for="paid-account">Cuenta corriente <span class="hint">(o el nombre de la caja)</span></label>
        <input id="paid-account" type="text" value="${esc(cuentaInicial)}" placeholder="Caja general" list="paid-accounts">
        <datalist id="paid-accounts">${cuentasGuardadas}</datalist>
        <span class="hint" id="paid-account-hint">Escribe el nombre de la cuenta o su número. Se guarda con el documento y se apunta en el asiento.</span>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn primary" data-ok>Guardar</button>
      <button class="btn ghost" data-modal-cancel>Cancelar</button>
    </div>`,
    {
      onMount(wrap) {
        wrap.querySelectorAll("[data-modal-cancel]").forEach((b) =>
          b.addEventListener("click", () => closeModal())
        );
        const input = wrap.querySelector("#paid-date");
        const seg = wrap.querySelector("#paid-method");
        const acc = wrap.querySelector("#paid-account");
        const hint = wrap.querySelector("#paid-account-hint");
        const sync = () => {
          const banco = ((seg && seg.dataset.value) || "BANCO") !== "CAJA";
          if (hint) {
            hint.textContent = banco
              ? "Escribe el nombre de la cuenta. Se guarda con el documento y se recuerda para la próxima vez."
              : "Un nombre para la caja, por ejemplo «Caja general». El dinero entra en la cuenta 570 del PGC.";
          }
          if (acc) {
            acc.placeholder = banco ? "Cuenta corriente" : "Caja general";
          }
        };
        if (seg) {
          seg.querySelectorAll("[data-method]").forEach((b) =>
            b.addEventListener("click", () => {
              seg.dataset.value = b.dataset.method;
              seg.querySelectorAll("[data-method]").forEach((o) => o.classList.toggle("active", o === b));
              sync();
            })
          );
        }
        sync();
        const go = () => {
          const day = String((input && input.value) || "").slice(0, 10) || today;
          const method = (seg && seg.dataset.value) || "BANCO";
          const account = String((acc && acc.value) || "").trim();
          closeModal();
          onSave(day, { method, account });
        };
        wrap.querySelector("[data-ok]").addEventListener("click", go);
        if (input) {
          input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") go();
          });
          setTimeout(() => input.focus(), 40);
        }
      },
    }
  );
}

/**
 * Cómo se cobró o se pagó, en palabras: «Caja · Caja general» o «Banco · ES91…».
 */
function payMethodText(inv) {
  const medio = String((inv && inv.payMethod) || "").toUpperCase();
  const cuenta = String((inv && inv.payAccount) || "").trim();
  if (medio === "CAJA") return `Caja${cuenta ? ` · ${esc(cuenta)}` : ""}`;
  if (medio === "TARJETA") return `Tarjeta${cuenta ? ` · ${esc(cuenta)}` : ""}`;
  if (medio === "BANCO") return `Banco${cuenta ? ` · ${esc(cuenta)}` : ""}`;
  return cuenta ? esc(cuenta) : "—";
}

/** Recuerda la cuenta usada, para ofrecerla la próxima vez en la lista. */
function rememberPayAccount(method, account) {
  const nombre = String(account || "").trim();
  if (!nombre || !["BANCO", "TARJETA"].includes(String(method || "").toUpperCase())) return;
  const ajustes = getState().settings || {};
  const lista = Array.isArray(ajustes.bankAccounts) ? ajustes.bankAccounts.slice() : [];
  if (lista.includes(nombre)) return;
  lista.unshift(nombre);
  updateSettings({ bankAccounts: lista.slice(0, 12) });
}

function statusPill(inv, interactive = true) {
  const paid = inv.status === STATUS.PAID;
  const cls = paid ? "paid" : "pending";
  const isIncome = directionOf(inv.kind) === "INGRESO";
  const label = paid ? (isIncome ? "Cobrado" : "Pagado") : "Pendiente";
  const day = paid && inv.paidDate ? fmtDate(inv.paidDate) : "";
  const via =
    paid && inv.payMethod
      ? inv.payMethod === "CAJA"
        ? " en efectivo (caja)"
        : " por el banco"
      : "";
  if (!interactive) {
    return `<span class="status static ${cls}" ${day ? `title="${isIncome ? "Cobrado" : "Pagado"} el ${day}${via}"` : ""}>${label}${
      day ? `<span class="status-day">${esc(day)}</span>` : ""
    }</span>`;
  }
  const nextLabel = paid ? "pendiente" : isIncome ? "cobrado" : "pagado";
  return `<button class="status ${cls}" data-action="toggle-status" data-id="${inv.id}"
    title="${day ? `${isIncome ? "Cobrado" : "Pagado"} el ${day}${via}. ` : ""}Cambiar a ${nextLabel}">${label}${
    day ? `<span class="status-day">${esc(day)}</span>` : ""
  }</button>`;
}

function supplierName(id) {
  const s = supplierById(id);
  return s ? s.name : "Sin tercero";
}

function rateText(rate) {
  return Number.isFinite(rate) ? `${fmtNum(rate, rate % 1 === 0 ? 0 : 1)} %` : "—";
}

/** Etiqueta corta del tipo y del concepto, para las listas. */
function tagOf(inv) {
  const kind = kindInfo(inv.kind);
  const cat = categoryInfo(inv.category);
  const isIn = invoiceDirection(inv) === "INGRESO";
  const cls = isIn ? "tag is-in" : "tag";
  const label = inv.category && cat.id ? `${kind.short} · ${cat.label}` : kind.short;
  return `<span class="${cls}">${isIn ? "+" : "−"} ${esc(label)}</span>`;
}

/** Cómo se reparte el gasto por concepto (agua, luz, laborales…). */
function categoryCard(t) {
  const rows = Object.entries(t.byCategory)
    .map(([id, row]) => ({ id, ...row }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);
  if (!rows.length) return "";
  const max = Math.max(...rows.map((r) => r.total), 1);
  return `
    <section class="card">
      <div class="card-head">
        <div>
          <h2>Gastos e ingresos por categoría</h2>
          <p>Gastos e ingresos agrupados por concepto</p>
        </div>
        <div class="spacer"></div>
        <a class="btn sm ghost" href="#/compras">Ver documentos ${icon("arrow")}</a>
      </div>
      <div class="card-body">
        <div class="cat-list">
          ${rows
            .map((r) => {
              const info = categoryInfo(r.id === "SIN" ? "" : r.id);
              const isIn = r.direction === "INGRESO";
              return `<div class="cat-row">
                <div class="cat-name">${esc(info.label)}${isIn ? " <span class=\"tag is-in\">ingreso</span>" : ""}</div>
                <div class="cat-track"><i class="${isIn ? "is-in" : ""}" style="width:${Math.max(3, Math.round((r.total / max) * 100))}%"></i></div>
                <div class="cat-num">${fmtEUR(r.total)}</div>
              </div>`;
            })
            .join("")}
        </div>
      </div>
    </section>`;
}

/* ------------------------------------------------------------------ */
/* Pintado general                                                    */
/* ------------------------------------------------------------------ */

/** Lo que se ve mientras se abre la base de datos. */
export function renderLoading(message = "Un momento: preparo las tablas de proveedores y facturas.") {
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
    <p role="status">${esc(message)}</p>
  </div></section>`;
}

export function render() {
  const route = ROUTES.includes(ui.route) ? ui.route : "resumen";
  ui.route = route;

  document.querySelectorAll(".nav a").forEach((a) => {
    a.classList.toggle("active", a.dataset.route === route);
  });
  document.querySelectorAll(".nav-tools").forEach((group) => {
    group.open = !!group.querySelector(`[data-route="${route}"]`);
  });

  const meta = pageMeta(route);
  document.getElementById("viewTitle").textContent = meta.title;
  document.getElementById("viewSub").textContent = meta.sub;
  document.getElementById("topActions").innerHTML = topActions(route);

  const view = document.getElementById("view");
  if (route === "resumen") view.innerHTML = viewResumen();
  else if (route === "ventas") view.innerHTML = viewVentas();
  else if (route === "control-fruta") renderFruitControl(view, getState().invoices.map((inv) => ({
    ...inv, supplierName: supplierById(inv.supplierId)?.name || inv.supplierName || "",
  })));
  else if (route === "contabilidad") view.innerHTML = viewContabilidad();
  else if (route === "compras") view.innerHTML = viewFacturas();
  else if (route === "nominas") view.innerHTML = viewNominas();
  else if (route === "proveedores") view.innerHTML = viewProveedores();
  else if (route === "documentos") view.innerHTML = viewDocumentos();
  else if (route === "correo") view.innerHTML = viewCorreo();
  else if (route === "pruebas") view.innerHTML = viewPruebas();
  else view.innerHTML = viewImportar();

  updateNavBadge();
}

/* ------------------------------------------------------------------ */
/* Documentos: el archivo de todo lo guardado                          */
/* ------------------------------------------------------------------ */

const DOC_SORTS = [
  { id: "recent", label: "Más recientes primero" },
  { id: "oldest", label: "Más antiguos primero" },
  { id: "amount", label: "Por importe, de mayor a menor" },
  { id: "supplier", label: "Por proveedor, de la A a la Z" },
];

/** La fecha con la que se filtra y se ordena un documento. */
function docDay(inv) {
  return inv.issueDate || String(inv.createdAt || "").slice(0, 10) || "";
}

function docDirection(inv) {
  return inv.direction || directionOf(inv.kind || "FACTURA");
}

/** El proveedor o comprador de un documento, o un hueco si ya no está. */
function docSupplier(inv) {
  const list = getState().suppliers || [];
  return list.find((s) => s.id === inv.supplierId) || null;
}

/** Los documentos guardados que pasan por el buscador y todos los filtros. */
function docList() {
  const st = ui.docs;
  const w = windowFor(st);
  const needle = st.q.trim().toLowerCase();
  let list = getState().invoices.slice();

  if (st.kind !== "all") list = list.filter((inv) => (inv.kind || "FACTURA") === st.kind);
  if (st.dir !== "all") list = list.filter((inv) => docDirection(inv) === st.dir);
  if (st.status === "pending") list = list.filter((inv) => inv.status !== STATUS.PAID);
  else if (st.status === "paid") list = list.filter((inv) => inv.status === STATUS.PAID);
  if (st.supplier) list = list.filter((inv) => inv.supplierId === st.supplier);
  if (w.from || w.to) list = list.filter((inv) => inSalesWindow(docDay(inv), w));

  if (needle) {
    list = list.filter((inv) => {
      const sup = docSupplier(inv) || {};
      const info = kindInfo(inv.kind || "FACTURA") || {};
      const hay = [
        inv.number,
        inv.fileName,
        inv.notes,
        sup.name,
        sup.nif,
        info.label,
        docDay(inv),
        fmtEUR(inv.total),
        String(inv.rawText || "").slice(0, 3000),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }

  const nameOf = (inv) => String((docSupplier(inv) || {}).name || "").toLowerCase();
  if (st.sort === "oldest") list.sort((a, b) => docDay(a).localeCompare(docDay(b)));
  else if (st.sort === "amount") list.sort((a, b) => (Number(b.total) || 0) - (Number(a.total) || 0));
  else if (st.sort === "supplier") list.sort((a, b) => nameOf(a).localeCompare(nameOf(b), "es"));
  else list.sort((a, b) => docDay(b).localeCompare(docDay(a)));
  return list;
}

/** La franja de filtros de la pantalla de documentos. */
function docsFilters() {
  const state = getState();
  const w = windowFor(ui.docs);
  const seg = (on) => (on ? "active" : "");
  return `
    <div class="filters">
      <label class="search">
        ${icon("search")}
        <input type="search" id="docSearch" placeholder="Buscar en el número, el proveedor o el texto leído" value="${esc(ui.docs.q)}" aria-label="Buscar en los documentos">
      </label>
      <div class="segmented">
        <button data-action="doc-dir" data-value="all" class="${seg(ui.docs.dir === "all")}">Todo</button>
        <button data-action="doc-dir" data-value="GASTO" class="${seg(ui.docs.dir === "GASTO")}">Gastos</button>
        <button data-action="doc-dir" data-value="INGRESO" class="${seg(ui.docs.dir === "INGRESO")}">Ingresos</button>
      </div>
      <div class="segmented">
        <button data-action="doc-status" data-value="all" class="${seg(ui.docs.status === "all")}">Todos</button>
        <button data-action="doc-status" data-value="pending" class="${seg(ui.docs.status === "pending")}">Pendientes</button>
        <button data-action="doc-status" data-value="paid" class="${seg(ui.docs.status === "paid")}">Cobrados o pagados</button>
      </div>
    </div>
    <div class="filters">
      <select id="docKind" aria-label="Tipo de documento">
        <option value="all">Todos los tipos</option>
        ${kindOptions(ui.docs.kind === "all" ? "" : ui.docs.kind)}
      </select>
      <select id="docSupplier" aria-label="Proveedor o comprador">
        <option value="">Cualquier proveedor</option>
        ${state.suppliers
          .map((s) => `<option value="${s.id}" ${ui.docs.supplier === s.id ? "selected" : ""}>${esc(s.name)}</option>`)
          .join("")}
      </select>
      <select id="docRange" aria-label="Periodo">
        ${SALES_RANGES.map((r) => `<option value="${r.id}" ${ui.docs.range === r.id ? "selected" : ""}>${r.label}</option>`).join("")}
      </select>
      ${
        ui.docs.range === "custom"
          ? `<label class="date-filter"><span>Desde</span><input id="docFrom" type="date" value="${esc(ui.docs.from)}" aria-label="Desde"></label>
             <label class="date-filter"><span>Hasta</span><input id="docTo" type="date" value="${esc(ui.docs.to)}" aria-label="Hasta"></label>`
          : ""
      }
      <select id="docSort" aria-label="Ordenar">
        ${DOC_SORTS.map((s) => `<option value="${s.id}" ${ui.docs.sort === s.id ? "selected" : ""}>${s.label}</option>`).join("")}
      </select>
      <div class="spacer"></div>
      <span class="tag">${esc(w.label)}</span>
    </div>`;
}

/** La tabla de documentos, con sus totales debajo. */
function docTableHtml(list) {
  const t = totals(list);
  const filas = list
    .map((inv) => {
      const info = kindInfo(inv.kind || "FACTURA") || {};
      const sup = docSupplier(inv) || {};
      const isIn = docDirection(inv) === "INGRESO";
      return `<tr data-id="${inv.id}">
        <td class="num">${fmtDate(docDay(inv))}</td>
        <td><span class="tag${isIn ? " is-in" : ""}">${esc(info.label || "Documento")}</span></td>
        <td>
          <div class="cell-main">
            <span class="name">${esc(sup.name || "Sin proveedor")}</span>
            ${sup.nif ? `<span class="sub">${esc(sup.nif)}</span>` : ""}
          </div>
        </td>
        <td class="mono">${esc(inv.number || "—")}</td>
        <td class="num">${fmtEUR(inv.base)}</td>
        <td class="num">${fmtEUR(inv.igic)}</td>
        <td class="num strong">${fmtEUR(inv.total)}</td>
        <td>${statusPill(inv)}</td>
        <td><span class="sub">${esc(sourceLabel(inv.source))}</span></td>
        <td>
          <div class="row-actions">
            <button class="icon-btn" data-action="doc-open" data-id="${inv.id}" title="Ver lo que se leyó">${icon("file")}</button>
            <button class="icon-btn" data-action="edit-invoice" data-id="${inv.id}" title="Abrir la ficha">${icon("edit")}</button>
          </div>
        </td>
      </tr>`;
    })
    .join("");

  return `<div class="table-wrap">
    <table class="data">
      <thead>
        <tr>
          <th>Fecha</th><th>Tipo</th><th>Proveedor</th><th>Número</th>
          <th class="num">Base</th><th class="num">IGIC</th><th class="num">Total</th>
          <th>Estado</th><th>Cómo entró</th><th></th>
        </tr>
      </thead>
      <tbody>${filas}</tbody>
      <tfoot>
        <tr>
          <td colspan="4">${list.length} ${list.length === 1 ? "documento" : "documentos"}</td>
          <td class="num">${fmtEUR(t.base)}</td>
          <td class="num">${fmtEUR(t.igic)}</td>
          <td class="num strong">${fmtEUR(t.total)}</td>
          <td colspan="3"></td>
        </tr>
      </tfoot>
    </table>
  </div>`;
}

/** El recuadro de cifras y la tabla; se repinta solo al filtrar. */
function docResults() {
  const list = docList();
  const t = totals(list);
  const todos = getState().invoices.length;
  const vacio = `<section class="card">
    <div class="empty">
      <div class="e-icon">${icon("folder")}</div>
      <h3>Ningún documento con esos filtros</h3>
      <p>Prueba a quitar la búsqueda, cambiar el periodo o mirar en todos los tipos.</p>
      <div class="e-actions"><button class="btn" data-action="docs-reset">Quitar los filtros</button></div>
    </div>
  </section>`;

  return `
    <section class="kpis">
      <article class="kpi">
        <div class="kpi-label"><span class="dot"></span>Documentos</div>
        <div class="kpi-value">${list.length}</div>
        <div class="kpi-foot">de ${todos} guardados</div>
      </article>
      <article class="kpi is-brand">
        <div class="kpi-label"><span class="dot"></span>Importe</div>
        <div class="kpi-value">${fmtEUR(t.total)}</div>
        <div class="kpi-foot">${fmtEUR(t.expense)} de gasto y ${fmtEUR(t.income)} de ingreso</div>
      </article>
      <article class="kpi is-paid">
        <div class="kpi-label"><span class="dot"></span>Pendiente</div>
        <div class="kpi-value">${fmtEUR(t.pending)}</div>
        <div class="kpi-foot">${t.pendingCount} ${t.pendingCount === 1 ? "documento" : "documentos"} sin cobrar o pagar</div>
      </article>
      <article class="kpi">
        <div class="kpi-label"><span class="dot"></span>IGIC</div>
        <div class="kpi-value">${fmtEUR(t.igic)}</div>
        <div class="kpi-foot">soportado y repercutido en estos documentos</div>
      </article>
    </section>
    <section class="card">
      <div class="card-head">
        <div>
          <h2>${list.length === 1 ? "Un documento" : `${list.length} documentos`}</h2>
          <p>El folio abre lo que se leyó del documento; el lápiz, su ficha</p>
        </div>
        <div class="spacer"></div>
        <button class="btn sm ghost" data-action="docs-export">${icon("download")}<span>Exportar índice</span></button>
      </div>
      ${list.length ? docTableHtml(list) : ""}
    </section>
    ${list.length ? "" : vacio}`;
}

function viewDocumentos() {
  const state = getState();
  if (!state.invoices.length) {
    return `<section class="card">
      <div class="empty">
        <div class="e-icon">${icon("folder")}</div>
        <h3>Todavía no hay documentos</h3>
        <p>Sube una foto o un PDF y quedará archivado aquí, con su texto leído y sus importes.</p>
        <div class="e-actions">
          <button class="btn primary" data-action="import-files">${icon("upload")}<span>Subir documento</span></button>
          <button class="btn" data-action="new-invoice">${icon("plus")}<span>Añadir a mano</span></button>
        </div>
      </div>
    </section>`;
  }
  return `
    <div class="stack">
      <section class="card">${docsFilters()}</section>
      <div id="docResults">${docResults()}</div>
    </div>`;
}

/** Repinta solo la tabla, sin perder el foco del buscador. */
function refreshDocResults() {
  if (ui.route !== "documentos") return;
  const box = document.getElementById("docResults");
  if (box) box.innerHTML = docResults();
}

/** La ventana con todo lo que se leyó de un documento. */
function docPreviewModal(inv) {
  const info = kindInfo(inv.kind || "FACTURA") || {};
  const sup = docSupplier(inv) || {};
  const isIn = docDirection(inv) === "INGRESO";
  const lines = Array.isArray(inv.lines) ? inv.lines : [];
  const liq = inv.liquidacion || null;
  const liqNum = liquidacionNumbers(inv);
  const notes = Array.isArray(inv.notes) ? inv.notes.join("\n") : String(inv.notes || "");
  const raw = String(inv.rawText || "");

  const filas = [
    ["Tipo", esc(info.label || "Documento")],
    ["Sentido", isIn ? "Ingreso" : "Gasto"],
    [isIn ? "Cliente" : "Proveedor", esc(sup.name || (isIn ? "Sin cliente" : "Sin proveedor"))],
    ["NIF", esc(sup.nif || "—")],
    ["Número", esc(inv.number || "—")],
    ["Fecha", inv.issueDate ? fmtDate(inv.issueDate) : "—"],
    ["Base imponible", fmtEUR(inv.base)],
    ["IGIC", `${fmtEUR(inv.igic)}${inv.rate ? ` · ${rateText(inv.rate)}` : ""}`],
    ["Total", `<strong>${fmtEUR(inv.total)}</strong>`],
    [
      "Estado",
      inv.status === STATUS.PAID
        ? `${isIn ? "Cobrado" : "Pagado"}${inv.paidDate ? ` el ${fmtDate(inv.paidDate)}` : " (sin fecha)"}`
        : "Pendiente",
    ],
    ...(inv.status === STATUS.PAID && (inv.payMethod || inv.payAccount)
      ? [[isIn ? "Cobrado con" : "Pagado con", payMethodText(inv)]]
      : []),
    ["Cómo entró", esc(sourceLabel(inv.source))],
    [
      "Archivo",
      inv.original
        ? `${esc(inv.original.name || inv.fileName || "documento")} <span class="sub">· ${esc(originalSizeText(inv.original.size))}</span>
           <div class="row wrap" style="margin-top:8px;gap:8px">
             <button type="button" class="btn sm" data-open-original="${esc(inv.id)}">Ver el original</button>
             <button type="button" class="btn sm" data-save-original="${esc(inv.id)}">Descargar el original</button>
           </div>`
        : inv.fileName
          ? `${esc(inv.fileName)} <span class="sub">· el fichero no se guardó, solo lo leído</span>`
          : "El archivo no se guardó, solo lo leído",
    ],
  ];

  const body = `
    <div class="table-wrap">
      <table class="data"><tbody>
        ${filas.map(([k, v]) => `<tr><th style="width:38%">${esc(k)}</th><td>${v}</td></tr>`).join("")}
      </tbody></table>
    </div>
    ${
      lines.length
        ? `<h3 style="margin:16px 0 6px">Tipos de IGIC del documento</h3>
           <div class="table-wrap"><table class="data">
             <thead><tr><th>Tipo</th><th class="num">Base</th><th class="num">Cuota</th></tr></thead>
             <tbody>
               ${lines
                 .map((l) => {
                   const lr = l.rate != null ? l.rate : l.tipo;
                   const lb = l.base != null ? l.base : l.importe;
                   const li = l.igic != null ? l.igic : l.cuota;
                   return `<tr><td>${esc(rateText(lr))}</td><td class="num">${fmtEUR(lb)}</td><td class="num">${fmtEUR(li)}</td></tr>`;
                 })
                 .join("")}
             </tbody>
           </table></div>`
        : ""
    }
    ${
      liq
        ? `<h3 style="margin:16px 0 6px">Liquidación de fruta</h3>
           <div class="table-wrap"><table class="data"><tbody>
             <tr><th>Producto</th><td>${esc(liq.product || "—")}</td></tr>
             <tr><th>Categoría</th><td>${esc(liq.category || "—")}</td></tr>
             <tr><th>Kilos</th><td>${liqNum.kg != null ? fmtNum(liqNum.kg) : "—"}</td></tr>
             <tr><th>Precio €/kg</th><td>${liqNum.price != null ? fmtNum(liqNum.price, 3) : "—"}</td></tr>
             <tr><th>Bruto</th><td>${fmtEUR(liqNum.gross)}</td></tr>
             <tr><th>Descuentos</th><td>${fmtEUR(liqNum.discounts)}</td></tr>
             <tr><th>Líquido a percibir</th><td><strong>${fmtEUR(liqNum.net)}</strong></td></tr>
           </tbody></table></div>`
        : ""
    }
    ${notes ? `<h3 style="margin:16px 0 6px">Notas</h3><p class="sub" style="white-space:pre-wrap">${esc(notes)}</p>` : ""}
    <h3 style="margin:16px 0 6px">El texto que se leyó</h3>
    ${
      raw
        ? `<div class="raw-text">${esc(raw)}</div>`
        : `<p class="sub">De este documento no se guardó texto: se escribió a mano.</p>`
    }`;

  openModal(
    `<div class="modal-head">
      <div>
        <h2>${esc(info.label || "Documento")}${inv.number ? ` ${esc(inv.number)}` : ""}</h2>
        <p>${esc(sup.name || "Sin proveedor")} · ${fmtEUR(inv.total)}</p>
      </div>
      <button class="icon-btn" data-modal-cancel aria-label="Cerrar">${icon("x")}</button>
    </div>
    <div class="modal-body">${body}</div>
    <div class="modal-foot">
      <div class="spacer"></div>
      <button class="btn primary" data-modal-cancel>Cerrar</button>
    </div>`,
    {
      onMount: (wrap) => {
        wrap.querySelectorAll("[data-open-original]").forEach((btn) => {
          btn.addEventListener("click", () => showDocOriginal(btn.getAttribute("data-open-original"), "view"));
        });
        wrap.querySelectorAll("[data-save-original]").forEach((btn) => {
          btn.addEventListener("click", () => showDocOriginal(btn.getAttribute("data-save-original"), "download"));
        });
      },
    }
  );
}

/** Lo que ocupa un fichero, en palabras: 48 KB, 2,3 MB. */
function originalSizeText(bytes) {
  const n = Number(bytes) || 0;
  if (!n) return "tamaño sin apuntar";
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

/**
 * Enseña o descarga el fichero original de un documento.
 * El navegador solo deja abrir una pestaña nueva si se hace en el mismo clic,
 * así que el fichero se busca primero y se abre desde el mismo gesto cuando se
 * puede; si el navegador bloquea la pestaña, se ofrece la descarga.
 */
async function showDocOriginal(id, mode) {
  if (!id) return;
  let got = null;
  try {
    got = await invoiceOriginalBody(id);
  } catch (err) {
    got = null;
  }
  if (!got || !got.blob) {
    toast("El original de este documento no está guardado en este navegador.", "bad", 5200);
    return;
  }
  const name = got.name || "documento";
  const type = got.type || got.blob.type || "application/octet-stream";
  if (mode === "download") {
    downloadBytes(name, got.blob, type);
    return;
  }
  const url = URL.createObjectURL(got.blob);
  const win = window.open(url, "_blank");
  if (!win) {
    toast("El navegador no ha dejado abrir el original. Prueba con «Descargar el original».", "warn", 6000);
  }
  setTimeout(() => URL.revokeObjectURL(url), 90000);
}

/** El índice de documentos en CSV, con lo que se está viendo. */
function exportDocsCsv() {
  const list = docList();
  if (!list.length) {
    toast("No hay documentos con esos filtros.", "warn");
    return;
  }
  const headers = [
    "Fecha",
    "Tipo",
    "Sentido",
    "Proveedor",
    "NIF",
    "Número",
    "Base",
    "IGIC",
    "Total",
    "Estado",
    "Fecha de cobro o pago",
    "Cómo entró",
    "Archivo",
  ];
  const rows = list.map((inv) => {
    const sup = docSupplier(inv) || {};
    const isIn = docDirection(inv) === "INGRESO";
    return [
      docDay(inv),
      (kindInfo(inv.kind || "FACTURA") || {}).label || "Documento",
      isIn ? "Ingreso" : "Gasto",
      sup.name || "",
      sup.nif || "",
      inv.number || "",
      fmtNum(inv.base),
      fmtNum(inv.igic),
      fmtNum(inv.total),
      inv.status === STATUS.PAID ? (isIn ? "Cobrado" : "Pagado") : "Pendiente",
      inv.status === STATUS.PAID && inv.paidDate ? inv.paidDate : "",
      sourceLabel(inv.source),
      inv.fileName || "",
    ]
      .map(csvCell)
      .join(";");
  });
  const w = windowFor(ui.docs);
  const csv = "﻿" + [headers.map(csvCell).join(";"), ...rows].join("\r\n");
  downloadText(`documentos-${w.from || "todo"}-${todayISO()}.csv`, csv);
  toast(`Exportados ${list.length} ${list.length === 1 ? "documento" : "documentos"}.`);
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
    case "control-fruta":
      return { title: "Control de fruta", sub: "Kilos, categorías y precios por fecha de liquidación" };
    case "ventas": {
      const list = salesDocs();
      const s = salesStats(list);
      return {
        title: "Ventas e ingresos",
        sub: `${salesWindow().label} · ${fmtNum(Math.round(s.kg))} kg vendidos · ${fmtEUR(s.money)} de ingresos`,
      };
    }
    case "contabilidad": {
      try {
        const e = asientosContables();
        const pyg = cuentaResultados(libroMayor(e));
        return {
          title: "Contabilidad",
          sub: `${contaWindow().label} · ${e.length} ${e.length === 1 ? "asiento" : "asientos"} · resultado ${fmtEUR(pyg.resultado)}`,
        };
      } catch (err) {
        console.error("Contabilidad:", err);
        return { title: "Contabilidad", sub: "No he podido calcular los asientos" };
      }
    }
    case "compras": {
      const expenses = getState().invoices.filter((inv) => invoiceDirection(inv) === "GASTO");
      return {
        title: "Compras",
        sub: `${expenses.length} ${expenses.length === 1 ? "compra" : "compras"} · ${expenses.filter((inv) => inv.status !== STATUS.PAID).length} pendientes de pago`,
      };
    }
    case "proveedores":
      return {
        title: "Proveedores y clientes",
        sub: `${supCount} ${supCount === 1 ? "contacto" : "contactos"} guardados`,
      };
    case "documentos": {
      const docs = getState().invoices.length;
      return {
        title: "Documentos",
        sub:
          docs === 0
            ? "El archivo de todo lo que subas: busca, filtra y mira lo que se leyó"
            : `${docs} ${docs === 1 ? "documento guardado" : "documentos guardados"} · busca, filtra y mira lo que se leyó`,
      };
    }
    case "nominas": {
      const nom = nominasList();
      const s = nominasTotals(nom);
      return {
        title: "Nóminas",
        sub:
          nom.length === 0
            ? "Sube un recibo de salarios y lo leo yo: sueldo bruto, Seguridad Social, IRPF y líquido"
            : `${nom.length} ${nom.length === 1 ? "nómina" : "nóminas"} · ${fmtEUR(s.neto)} de líquido a percibir · ${fmtEUR(s.coste)} de coste para la empresa`,
      };
    }
    case "correo": {
      const count = messages().length;
      return {
        title: "Correo",
        sub:
          count === 0
            ? "Trae aquí los correos con facturas o liquidaciones"
            : `${count} ${count === 1 ? "correo guardado" : "correos guardados"} en el buzón`,
      };
    }
    case "importar":
      return {
        title: "Importar documentos",
        sub: "Sube una foto o un PDF y yo relleno los datos",
      };
    case "pruebas": {
      const n = ui.pruebas.list.length;
      return {
        title: "Probar la lectura",
        sub:
          n === 0
            ? "Suelta un PDF de ejemplo y te enseño el texto que saco y lo que entiendo de él, sin guardar nada"
            : `${n} ${n === 1 ? "documento probado" : "documentos probados"} · nada de esto se ha guardado`,
      };
    }
    default: {
      const who = (getState().settings.businessName || "Agrosabina SL").trim();
      const pendingParts = [];
      if (t.expensePending > 0) pendingParts.push(`${fmtEUR(t.expensePending)} por pagar`);
      if (t.incomePending > 0) pendingParts.push(`${fmtEUR(t.incomePending)} por cobrar`);
      const pending = pendingParts.length ? pendingParts.join(" · ") : "Todo al día";
      return {
        title: "Resumen",
        sub: `${who} · ${pending}`,
      };
    }
  }
}

function topActions(route) {
  if (route === "control-fruta") {
    return `<button class="btn primary" data-action="import-files">${icon("upload")}<span>Subir liquidación</span></button>`;
  }
  if (route === "ventas") {
    return `
      <button class="btn" data-action="export-sales-csv">${icon("download")}<span>Exportar</span></button>
      <button class="btn" data-action="new-sale">${icon("edit")}<span>Añadir a mano</span></button>
      <button class="btn primary" data-action="import-files">${icon("upload")}<span>Subir liquidación</span></button>`;
  }
  if (route === "contabilidad") {
    return `
      <button class="btn primary" data-action="bank-upload">${icon("upload")}<span>Subir extracto</span></button>
      <button class="btn" data-action="acc-apertura">${icon("gear")}<span>Datos de partida</span></button>
      <button class="btn" data-action="export-acc-csv">${icon("download")}<span>Exportar</span></button>`;
  }
  if (route === "compras") {
    return `
      <button class="btn" data-action="export-csv">${icon("download")}<span>Exportar</span></button>
      <button class="btn primary" data-action="import-files" aria-label="Importar factura de compra">${icon("upload")}<span>Importar factura</span></button>
      <button class="btn" data-action="new-invoice">${icon("plus")}<span>Nueva compra</span></button>`;
  }
  if (route === "nominas") {
    return `
      <button class="btn" data-action="new-invoice">${icon("edit")}<span>Escribir una nómina</span></button>
      <button class="btn primary" data-action="import-files">${icon("upload")}<span>Subir nómina</span></button>`;
  }
  if (route === "proveedores") {
    return `<button class="btn primary" data-action="new-supplier">${icon("plus")}<span>Nuevo proveedor</span></button>`;
  }
  if (route === "documentos") {
    return `
      <button class="btn" data-action="docs-export" aria-label="Exportar el índice">${icon("download")}<span>Exportar índice</span></button>
      <button class="btn primary" data-action="import-files">${icon("upload")}<span>Subir documento</span></button>`;
  }
  if (route === "importar") {
    return `<button class="btn" data-action="new-invoice">${icon("edit")}<span>Añadir a mano</span></button>`;
  }
  if (route === "correo") {
    return `
      <button class="btn" data-action="settings" aria-label="Ajustes">${icon("gear")}<span>Ajustes</span></button>
      <button class="btn primary" data-action="import-email">${icon("mail")}<span>Añadir correo</span></button>`;
  }
  if (route === "pruebas") {
    return `<button class="btn primary" data-action="prueba-open">${icon("upload")}<span>Elegir un PDF o una foto</span></button>`;
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
  const expenses = invs.filter((inv) => invoiceDirection(inv) === "GASTO");
  const expensePending = expenses.filter((inv) => inv.status !== STATUS.PAID);
  const expensePaid = expenses.filter((inv) => inv.status === STATUS.PAID);
  const expenseOverdue = expensePending.filter((inv) => inv.dueDate && inv.dueDate < todayISO());
  const paidExpenseTotal = expensePaid.reduce((sum, inv) => sum + (Number(inv.total) || 0), 0);
  const expenseIgic = expenses.reduce((sum, inv) => sum + (Number(inv.igic) || 0), 0);
  const pendingExpenseIgic = expensePending.reduce((sum, inv) => sum + (Number(inv.igic) || 0), 0);
  const months = lastMonths(6);
  const byMonth = new Map(months.map((m) => [m, { paid: 0, pending: 0 }]));
  for (const inv of expenses) {
    const k = monthKey(inv.issueDate);
    const row = byMonth.get(k);
    if (!row) continue;
    const amount = Number(inv.total) || 0;
    if (inv.status === STATUS.PAID) row.paid += amount;
    else row.pending += amount;
  }
  const monthMax = Math.max(1, ...months.map((m) => byMonth.get(m).paid + byMonth.get(m).pending));

  const latest = sortedInvoices(invs).slice(0, 5);
  const upcoming = expenses
    .filter((i) => i.status === STATUS.PENDING)
    .sort((a, b) => (a.dueDate || a.issueDate || "9999").localeCompare(b.dueDate || b.issueDate || "9999"))
    .slice(0, 5);

  const pendingBySupplier = new Map();
  for (const inv of expensePending) {
    if (!inv.supplierId) continue;
    const row = pendingBySupplier.get(inv.supplierId) || { pending: 0, countPending: 0, count: 0 };
    row.pending = round2(row.pending + (Number(inv.total) || 0));
    row.countPending += 1;
    row.count += 1;
    pendingBySupplier.set(inv.supplierId, row);
  }
  const topSuppliers = [...pendingBySupplier.entries()]
    .sort((a, b) => b[1].pending - a[1].pending)
    .slice(0, 4);

  return `
  <div class="stack">
    <section class="kpis">
      <article class="kpi is-income">
        <div class="kpi-label"><span class="dot"></span>Ingresos registrados</div>
        <div class="kpi-value">${fmtEUR(t.income)}</div>
        <div class="kpi-foot">${t.incomeCount} ${t.incomeCount === 1 ? "documento" : "documentos"} · ${fmtEUR(t.incomePending)} por cobrar</div>
      </article>
      <article class="kpi is-expense">
        <div class="kpi-label"><span class="dot"></span>Compras y gastos</div>
        <div class="kpi-value">${fmtEUR(t.expense)}</div>
        <div class="kpi-foot">${t.expenseCount} ${t.expenseCount === 1 ? "documento" : "documentos"} · ${fmtEUR(t.expensePending)} por pagar</div>
      </article>
      <article class="kpi">
        <div class="kpi-label"><span class="dot"></span>Pendiente de cobro</div>
        <div class="kpi-value">${fmtEUR(t.incomePending)}</div>
        <div class="kpi-foot">${t.incomeCount} ${t.incomeCount === 1 ? "ingreso registrado" : "ingresos registrados"}</div>
      </article>
      <article class="kpi is-brand">
        <div class="kpi-label"><span class="dot"></span>Pendiente de pago</div>
        <div class="kpi-value">${fmtEUR(t.expensePending)}</div>
        <div class="kpi-foot">${expensePending.length === 0 ? "Nada pendiente" : `${expensePending.length} ${expensePending.length === 1 ? "compra" : "compras"}${expenseOverdue.length ? ` · ${expenseOverdue.length} vencida${expenseOverdue.length === 1 ? "" : "s"}` : ""}`}</div>
      </article>
    </section>

    <section class="summary-strip" aria-label="Otros datos del resumen">
      <article><span>Compras pagadas</span><strong>${fmtEUR(paidExpenseTotal)}</strong><small>${expensePaid.length} documentos</small></article>
      <article><span>IGIC soportado</span><strong>${fmtEUR(expenseIgic)}</strong><small>${fmtEUR(pendingExpenseIgic)} en compras pendientes</small></article>
      <article><span>Resultado provisional</span><strong>${fmtEUR(round2(t.income - t.expense))}</strong><small>Ingresos menos gastos registrados</small></article>
    </section>

    ${categoryCard(t)}

    <div class="two-col">
      <section class="card">
        <div class="card-head">
          <div>
            <h2>Actividad reciente</h2>
            <p>Últimas compras, ventas y liquidaciones</p>
          </div>
          <div class="spacer"></div>
          <a class="btn sm ghost" href="#/documentos">Ver documentos ${icon("arrow")}</a>
        </div>
        <div class="table-wrap">
          <table class="data">
            <thead>
              <tr>
                <th>Cliente o proveedor</th><th>Documento</th><th>Fecha</th>
                <th class="num">Total</th><th>Estado</th>
              </tr>
            </thead>
            <tbody>
              ${latest.map((inv) => `
                <tr data-id="${inv.id}">
                  <td><div class="cell-main"><span class="name">${esc(supplierName(inv.supplierId))}</span><span class="sub">${esc(kindInfo(inv.kind).short)} · ${invoiceDirection(inv) === "INGRESO" ? "ingreso" : "gasto"}</span></div></td>
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
              <h2>Próximos pagos</h2>
              <p>Compras pendientes con fecha de vencimiento</p>
            </div>
          </div>
          ${upcoming.length ? `<div class="mini-list">
            ${upcoming.map((inv) => {
              const d = daysUntil(inv.dueDate);
              const when = inv.dueDate
                ? d < 0
                  ? `Vencida hace ${Math.abs(d)} días`
                  : d === 0
                    ? "Vence hoy"
                    : `Vence en ${d} días`
                : `Emitida el ${fmtDate(inv.issueDate)}`;
              return `<div class="mini-row">
                <div class="m-main">
                  <div class="t">${esc(supplierName(inv.supplierId))}</div>
                  <div class="s">${esc(when)}</div>
                </div>
                <div class="num">${fmtEUR(inv.total)}</div>
              </div>`;
            }).join("")}
          </div>` : `<div class="empty" style="padding:30px 18px">
            <h3>No hay pagos pendientes</h3>
            <p>Las compras aparecerán aquí cuando tengan una fecha de vencimiento.</p>
          </div>`}
        </section>

        <section class="card">
          <div class="card-head">
            <div>
              <h2>Pagos de compras</h2>
              <p>Pagado y pendiente en los últimos 6 meses</p>
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
                const paidH = Math.round((row.paid / monthMax) * 100);
                const pendingH = Math.round((row.pending / monthMax) * 100);
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
        <h3>Empieza por una compra o una venta de fruta</h3>
        <p>Sube una factura o liquidación. Revisamos los datos juntos antes de guardarlos y luego aparecen en compras, ventas y control de fruta.</p>
        <div class="e-actions">
          <button class="btn primary" data-action="import-files">${icon("upload")} Subir factura o liquidación</button>
          <button class="btn" data-action="new-sale">${icon("edit")} Registrar liquidación</button>
          <button class="btn" data-action="new-invoice">${icon("edit")} Añadir compra a mano</button>
          <button class="btn ghost" data-action="seed-demo">Ver con datos de ejemplo</button>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-head">
        <div>
          <h2>Cómo funciona</h2>
          <p>Tú decides qué se guarda: nada se confirma sin revisar</p>
        </div>
      </div>
      <div class="card-body">
        <div class="howto">
          <div class="step">
            <div class="n">1</div>
            <h4>Sube una foto o PDF</h4>
            <p>Puede ser una factura, una liquidación de fruta o una nómina.</p>
          </div>
          <div class="step">
            <div class="n">2</div>
            <h4>Revisa los datos</h4>
            <p>Comprueba quién lo emite, la fecha, los importes y los avisos.</p>
          </div>
          <div class="step">
            <div class="n">3</div>
            <h4>Guarda y organiza</h4>
            <p>El documento aparece en Ventas, Compras o Nóminas, según su tipo.</p>
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
  { id: "year", label: "Este año" },
  { id: "quarter", label: "Este trimestre" },
  { id: "month", label: "Este mes" },
  { id: "campaign", label: "Últimos 12 meses" },
  { id: "all", label: "Todo lo registrado" },
  { id: "custom", label: "Elegir fechas" },
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

  if (range === "month") return { id: range, from: monthFrom, to: today, label: "Este mes" };
  if (range === "quarter") return { id: range, from: quarterFrom, to: today, label: "Este trimestre" };
  if (range === "campaign") return { id: range, from: yearAgo, to: today, label: "Últimos 12 meses" };
  if (range === "all") return { id: range, from: "", to: "", label: "Todo lo registrado" };
  if (range === "custom") {
    const from = state.from || "";
    const to = state.to || "";
    const label = from && to
      ? `Del ${fmtDate(from)} al ${fmtDate(to)}`
      : from
        ? `Desde el ${fmtDate(from)}`
        : to
          ? `Hasta el ${fmtDate(to)}`
          : "Elige las fechas";
    return { id: range, from, to, label };
  }
  return { id: "year", from: `${y}-01-01`, to: today, label: "Este año" };
}

function inSalesWindow(date, w) {
  const d = date || "";
  if (w.from && (!d || d < w.from)) return false;
  if (w.to && (!d || d > w.to)) return false;
  return true;
}

/* ------------------------------------------------------------------ */
/* Nóminas: los recibos de salarios                                   */
/* ------------------------------------------------------------------ */

/** Todas las nóminas guardadas, de la más reciente a la más antigua. */
function nominasList() {
  return getState()
    .invoices.filter(esNomina)
    .sort((a, b) => String(b.issueDate || "").localeCompare(String(a.issueDate || "")));
}

/**
 * Suma de una lista de nóminas con las mismas cuentas que hace la
 * contabilidad, para que el total de la pantalla y el asiento digan lo mismo.
 */
function nominasTotals(list) {
  const t = { bruto: 0, ssTrabajador: 0, irpf: 0, ssEmpresa: 0, neto: 0, coste: 0, pendiente: 0 };
  for (const inv of list) {
    const c = calcularNomina(inv.nomina || {});
    t.bruto += Number(c.bruto) || 0;
    t.ssTrabajador += Number(c.ssTrabajador) || 0;
    t.irpf += Number(c.irpf) || 0;
    t.ssEmpresa += Number(c.ssEmpresa) || 0;
    t.neto += Number(c.neto) || 0;
    t.coste += Number(c.coste) || 0;
    if (inv.status !== STATUS.PAID) t.pendiente += Number(inv.total) || 0;
  }
  for (const k of Object.keys(t)) t[k] = round2(t[k]);
  return t;
}

function viewNominas() {
  const list = nominasList();
  const t = nominasTotals(list);

  const cuentas = `
    <section class="card">
      <div class="card-head">
        <div>
          <h2>Cómo se apunta una nómina</h2>
          <p>Al leer el recibo, el programa guarda sus números y la contabilidad hace el asiento sola.</p>
        </div>
      </div>
      <div class="card-body">
        <p class="hint">
          El sueldo bruto va a la <strong>${CUENTAS_NOMINA.sueldos}</strong> (sueldos y salarios) y la Seguridad Social
          a cargo de la empresa a la <strong>${CUENTAS_NOMINA.ssEmpresa}</strong> (Seguridad Social a cargo de la empresa).
          Al haber quedan la <strong>${CUENTAS_NOMINA.ssPagar}</strong> (Seguridad Social, obrera más empresa), la
          <strong>${CUENTAS_NOMINA.irpf}</strong> (IRPF) y la <strong>${CUENTAS_NOMINA.liquido}</strong> (remuneraciones
          pendientes de pago) por el líquido. Cuando marques la nómina como pagada, el dinero sale de la caja (570) o del
          banco (572) contra esa ${CUENTAS_NOMINA.liquido}.
        </p>
      </div>
    </section>`;

  if (!list.length) {
    return `<div class="stack">
      <section class="card">
        <div class="empty" style="padding:54px 24px">
          <div class="e-icon">${icon("wallet")}</div>
          <h3>Todavía no hay ninguna nómina</h3>
          <p>Sube el PDF o una foto del recibo de salarios, o pégalo como texto, y yo saco el sueldo bruto, la
          Seguridad Social, el IRPF y el líquido a percibir. También puedes escribirla a mano.</p>
          <div class="row" style="justify-content:center;gap:10px;margin-top:14px">
            <button class="btn" data-action="new-invoice">${icon("edit")}<span>Escribir una nómina</span></button>
            <button class="btn primary" data-action="import-files">${icon("upload")}<span>Subir nómina</span></button>
          </div>
        </div>
      </section>
      ${cuentas}
    </div>`;
  }

  const rows = list
    .map((inv) => {
      const c = calcularNomina(inv.nomina || {});
      const sup = docSupplier(inv) || {};
      const quien = sup.name || (inv.nomina && inv.nomina.trabajador) || "Sin nombre";
      const pagada = inv.status === STATUS.PAID;
      return `<tr data-id="${inv.id}">
        <td class="num">${inv.issueDate ? fmtDate(inv.issueDate) : "—"}</td>
        <td>${esc(quien)}</td>
        <td>${esc((inv.nomina && inv.nomina.periodo) || "—")}</td>
        <td class="num">${c.bruto == null ? "—" : fmtEUR(c.bruto)}</td>
        <td class="num">${c.ssTrabajador == null ? "—" : fmtEUR(c.ssTrabajador)}</td>
        <td class="num">${c.irpf == null ? "—" : fmtEUR(c.irpf)}</td>
        <td class="num">${c.ssEmpresa == null ? "—" : fmtEUR(c.ssEmpresa)}</td>
        <td class="num"><strong>${c.neto == null ? "—" : fmtEUR(c.neto)}</strong></td>
        <td class="num">${c.coste == null ? "—" : fmtEUR(c.coste)}</td>
        <td>${statusPill(inv)}</td>
        <td class="num">
          <button class="icon-btn" data-action="doc-open" data-id="${inv.id}" aria-label="Ver la nómina">${icon("file")}</button>
          <button class="icon-btn" data-action="edit-invoice" data-id="${inv.id}" aria-label="Editar la nómina">${icon("edit")}</button>
        </td>
      </tr>`;
    })
    .join("");

  return `<div class="stack">
    <section class="card">
      <div class="card-head">
        <div>
          <h2>Recibos de salarios</h2>
          <p>${list.length} ${list.length === 1 ? "nómina" : "nóminas"} · el líquido es lo que se paga y el bruto lo que cuesta el sueldo</p>
        </div>
      </div>
      <div class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Trabajador</th>
              <th>Periodo</th>
              <th class="num">Bruto</th>
              <th class="num">SS obrera</th>
              <th class="num">IRPF</th>
              <th class="num">SS empresa</th>
              <th class="num">Líquido</th>
              <th class="num">Coste</th>
              <th>Estado</th>
              <th class="num"></th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
          <tfoot>
            <tr>
              <td colspan="3"><strong>Total</strong></td>
              <td class="num"><strong>${fmtEUR(t.bruto)}</strong></td>
              <td class="num"><strong>${fmtEUR(t.ssTrabajador)}</strong></td>
              <td class="num"><strong>${fmtEUR(t.irpf)}</strong></td>
              <td class="num"><strong>${fmtEUR(t.ssEmpresa)}</strong></td>
              <td class="num"><strong>${fmtEUR(t.neto)}</strong></td>
              <td class="num"><strong>${fmtEUR(t.coste)}</strong></td>
              <td colspan="2">${t.pendiente > 0 ? `Pendiente de pago: ${fmtEUR(t.pendiente)}` : "Todas pagadas"}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
    ${cuentas}
  </div>`;
}

/** Todo lo que entra: liquidaciones de fruta, subvenciones, cobros… */
function isIncomeDoc(inv) {
  return invoiceDirection(inv) === "INGRESO";
}

function salesDocs() {
  const w = salesWindow();
  return getState()
    .invoices.filter(isIncomeDoc)
    .filter((inv) => inSalesWindow(inv.issueDate, w))
    .sort((a, b) => String(b.issueDate || "").localeCompare(String(a.issueDate || "")));
}

/** Kilos, precio por kilo, descuentos, bruto y líquido de un documento. */
function liquidacionNumbers(inv) {
  const liq = inv.liquidacion;
  const kg = liq && Number.isFinite(Number(liq.kg)) ? Number(liq.kg) : 0;
  const price = liq && Number.isFinite(Number(liq.price)) ? Number(liq.price) : 0;
  const discounts = liq && Array.isArray(liq.discounts)
    ? round2(liq.discounts.reduce((a, d) => a + (Number(d.amount) || 0), 0))
    : 0;
  const gross = kg > 0 && price > 0 ? round2(kg * price) : 0;
  const net = gross > 0 ? round2(gross - discounts) : Number(inv.base) || 0;
  return { kg, price, discounts, gross, net: round2(net) };
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
    buyers: new Set(),
  };

  const bump = (map, key) => {
    let row = map.get(key);
    if (!row) {
      row = { key, count: 0, kg: 0, gross: 0, net: 0 };
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
      [s.byBuyer, buyer],
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
            <div class="cat-track" style="width:100%;margin-top:6px"><i style="width:${Math.max(3, Math.round((r.kg / maxKg) * 100))}%"></i></div>
          </td>
          <td class="num">${r.count}</td>
          <td class="num">${fmtNum(Math.round(r.kg))} kg</td>
          <td class="num">${r.kg > 0 ? `${fmtNum(r.gross / r.kg, 3)} €` : '<span class="muted">—</span>'}</td>
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
  const monthRows = [...s.byMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([mk, row]) => ({ ...row, key: monthLabel(mk) }));
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
            <div class="kpi-foot">${s.gross > 0 ? `${fmtNum((s.discounts / s.gross) * 100, 1)} % del bruto` : "sin datos de kilos"}</div>
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
                <td class="num">${num.kg > 0 ? fmtNum(num.kg) : '<span class="muted">—</span>'}</td>
                <td class="num">${num.price > 0 ? fmtNum(num.price, 3) : '<span class="muted">—</span>'}</td>
                <td class="num">${num.discounts > 0 ? fmtEUR(num.discounts) : '<span class="muted">—</span>'}</td>
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
    "Fecha de cobro",
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
      inv.status === STATUS.PAID && inv.paidDate ? fmtDate(inv.paidDate) : "",
    ].map(csvCell).join(";");
  });
  const csv = "\ufeff" + [headers.map(csvCell).join(";"), ...rows].join("\r\n");
  downloadText(`ventas-${w.from || "todo"}-${todayISO()}.csv`, csv);
  toast(`Exportadas ${list.length} ${list.length === 1 ? "venta" : "ventas"} del periodo.`);
}

/* ------------------------------------------------------------------ */
/* Facturas                                                           */
/* ------------------------------------------------------------------ */

function filteredInvoices() {
  const { status, supplier, q } = ui.filters;
  const needle = q.trim().toLowerCase();
  // «Compras» contiene exclusivamente gastos. Las liquidaciones de fruta y
  // demás ingresos se consultan en Ventas o en el archivo de Documentos.
  let list = getState().invoices.filter((i) =>
    invoiceDirection(i) === "GASTO"
  );

  if (status === "pending") list = list.filter((i) => i.status !== STATUS.PAID);
  else if (status === "paid") list = list.filter((i) => i.status === STATUS.PAID);
  if (supplier) list = list.filter((i) => i.supplierId === supplier);

  if (needle) {
    list = list.filter((inv) => {
      const sup = supplierById(inv.supplierId);
      const hay = [inv.number, sup && sup.name, sup && sup.nif, inv.issueDate, String(inv.total)]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
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
        <button class="btn primary" data-action="import-files" aria-label="Importar factura de compra">${icon("upload")} Importar factura de compra</button>
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
      <h3>Ninguna compra con esos filtros</h3>
      <p>Las ventas y las liquidaciones de fruta se consultan en Ventas.</p>
      <div class="e-actions">
        <a class="btn primary" href="#/ventas">${icon("wallet")} Ir a ventas</a>
        <button class="btn" data-filter-status="all">Quitar filtro de estado</button>
      </div>
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
            <td class="num">${inv.dueDate ? `${fmtDate(inv.dueDate)}${overdue ? ' <span class="tag" style="background:var(--danger-soft);color:var(--danger)">vencida</span>' : ""}` : '<span class="muted">—</span>'}</td>
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

/** Los terceros de un papel: proveedores, clientes o todos. */
function tercerosPorRol(rol) {
  const lista = getState().suppliers;
  if (rol === "TODOS") return lista.slice();
  if (rol === "CLIENTE") {
    return lista.filter((s) => {
      const r = String(s.role || "").toUpperCase();
      return r === "CLIENTE" || r === "AMBOS";
    });
  }
  return lista.filter((s) => {
    const r = String(s.role || "").toUpperCase();
    return r === "PROVEEDOR" || r === "AMBOS";
  });
}

function viewProveedores() {
  const state = getState();
  if (!state.suppliers.length) {
    return `<section class="card"><div class="empty">
      <div class="e-icon">${icon("store")}</div>
      <h3>Los proveedores y los clientes se crean solos</h3>
      <p>En cuanto subas una factura, guardo el proveedor con su nombre y su NIF; con las liquidaciones y los ingresos pasa lo mismo con el cliente. Si quieres, también puedes darlos de alta tú.</p>
      <div class="e-actions">
        <button class="btn primary" data-action="import-files">${icon("upload")} Subir factura</button>
        <button class="btn" data-action="new-supplier">${icon("plus")} Añadir proveedor o cliente</button>
      </div>
    </div></section>`;
  }

  const rol = ui.supplierRole || "PROVEEDOR";
  const cuantos = tercerosPorRol(rol).length;
  return `
  <section class="card" style="margin-bottom:16px">
    <div class="filters">
      <div class="segmented" id="supplierRoleSeg" data-value="${esc(rol)}">
        <button type="button" data-action="supplier-role" data-role="PROVEEDOR" class="${rol === "PROVEEDOR" ? "active" : ""}">Proveedores</button>
        <button type="button" data-action="supplier-role" data-role="CLIENTE" class="${rol === "CLIENTE" ? "active" : ""}">Clientes</button>
        <button type="button" data-action="supplier-role" data-role="TODOS" class="${rol === "TODOS" ? "active" : ""}">Todos</button>
      </div>
      <div class="spacer"></div>
      <span class="tag">${cuantos} de ${state.suppliers.length}</span>
    </div>
    <div class="filters" style="margin-top:10px">
      <label class="search">
        ${icon("search")}
        <input type="search" id="supplierSearch" placeholder="Buscar por nombre o NIF" value="${esc(ui.supplierQuery)}" aria-label="Buscar proveedores y clientes">
      </label>
    </div>
  </section>
  <div id="supplierGridWrap">${supplierGrid()}</div>`;
}

function supplierGrid() {
  const bySupplier = statsBySupplier();
  const q = ui.supplierQuery.trim().toLowerCase();
  let list = tercerosPorRol(ui.supplierRole || "PROVEEDOR");
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
      <h3>Nadie con ese nombre</h3>
      <p>Prueba con otra parte del nombre o con el NIF.</p>
    </div></section>`;
  }

  return `<div class="supplier-grid">
    ${list.map((s) => {
      const st = bySupplier.get(s.id) || { count: 0, total: 0, pending: 0, countPending: 0, lastDate: "" };
      const suRol = String(s.role || "").toUpperCase();
      const esCliente = suRol === "CLIENTE" || (suRol === "AMBOS" && ui.supplierRole === "CLIENTE");
      const etiqueta = suRol === "AMBOS" ? "Cliente y proveedor" : esCliente ? "Cliente" : "Proveedor";
      return `<article class="supplier-card">
        <div class="supplier-top">
          <div class="avatar">${esc(initials(s.name))}</div>
          <div class="who">
            <div class="n">${esc(s.name)}</div>
            <div class="i">${esc(s.nif || "sin NIF")} · ${etiqueta}</div>
          </div>
        </div>
        <div class="supplier-figures">
          <div>
            <div class="f-label">${esCliente ? "Vendido" : "Facturado"}</div>
            <div class="f-value">${fmtEUR(st.total)}</div>
          </div>
          <div>
            <div class="f-label">${esCliente ? "Por cobrar" : "Pendiente"}</div>
            <div class="f-value ${st.pending > 0 ? "pending" : ""}">${fmtEUR(st.pending)}</div>
          </div>
        </div>
        <div class="supplier-foot">
          <span class="meta">${st.count} ${st.count === 1 ? "factura" : "facturas"}${st.lastDate ? ` · ${fmtDate(st.lastDate)}` : ""}</span>
          <div class="spacer"></div>
          <button class="icon-btn" data-action="edit-supplier" data-id="${s.id}" title="Editar" aria-label="Editar proveedor o cliente">${icon("edit")}</button>
          <button class="icon-btn" data-action="delete-supplier" data-id="${s.id}" title="Borrar" aria-label="Borrar proveedor o cliente">${icon("trash")}</button>
          <button class="btn sm" data-action="filter-supplier" data-id="${s.id}">Ver movimientos</button>
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
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" });
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
      <span>${
        aiOn
          ? "Cada correo y cada adjunto se clasifica con tu IA y, si falla, con las reglas del programa."
          : "El programa decide el tipo y el concepto con sus propias reglas. Si quieres ayuda de una IA, se enciende en Ajustes con tu clave."
      }</span>
    </div>

    <section class="card">
      <div class="card-head">
        <div>
          <h2>Correos guardados</h2>
          <p>${list.length ? "Pulsa «Leer y revisar» para sacar la factura del correo" : "Aquí aparecerán los correos que traigas"}</p>
        </div>
      </div>
      <div class="card-body">
        ${
          list.length
            ? `<div class="mail-list">${list.map(mailRow).join("")}</div>`
            : `<div class="empty">
                 <div class="e-icon">${icon("mail")}</div>
                 <h3>Todavía no hay correos</h3>
                 <p>Lo más cómodo: desde el móvil reenvía la factura a ti mismo y guárdala como .eml la próxima vez que abras el ordenador.</p>
               </div>`
        }
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
          stage: "En cola",
        });
        attached++;
      }
    } catch (err) {
      toast(`No he podido leer «${file.name}»: ${(err && err.message) || "formato no reconocido"}`, "bad", 6000);
    }
  }

  if (!saved && !attached) return null;

  if (saved) {
    toast(
      `Guardado${saved === 1 ? "" : "s"} ${saved} correo${saved === 1 ? "" : "s"}${
        attached ? ` y ${attached} adjunto${attached === 1 ? "" : "s"} en cola` : ""
      }.`
    );
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
  return { saved, attached, lastId };
}

/** Saca la factura de un correo guardado. */
async function useMail(id) {
  const msg = messages().find((m) => m.id === id);
  if (!msg) return;
  const text = [msg.subject, msg.from, msg.date, msg.text].filter(Boolean).join("\n");
  if (text.trim().length < 12) {
    toast("Ese correo no tiene texto suficiente. Prueba con sus adjuntos.", "bad", 5200);
    return;
  }
  const { lectura } = await leerTextoDocumento(text, msg.subject || "correo.eml");
  const parsed = lectura.doc;
  parsed.rawText = text.slice(0, 6000);
  parsed.notes = Array.isArray(parsed.notes) ? parsed.notes : [];

  markMessageUsed(id);

  const job = {
    id: `mail_${id}`,
    file: { name: msg.subject || "correo.eml" },
    source: "email",
    parsed,
  };
  await reviewJob(job);
  render();
}

export function openMailPasteModal() {
  openModal(
    `<div class="modal-head">
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
    </div>`,
    {
      onMount(wrap) {
        wrap.querySelectorAll("[data-modal-cancel]").forEach((b) =>
          b.addEventListener("click", () => closeModal())
        );
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
            attachments: [],
          });
          closeModal();
          if (stored) await useMail(stored.id);
        });
      },
    }
  );
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
    aiKey: key.value.trim(),
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
    const sample =
      "FACTURA Aguas de Canarias SA. NIF A38000123. Concepto: consumo de agua riego campaña 2024. Base 120,00 IGIC 0% Total 120,00";
    cls = await classifyDocument(sample, settings, { fileName: "prueba" });
  } catch (err) {
    const why = err && err.message ? err.message : "La IA no ha contestado.";
    if (status) status.textContent = why;
    toast(why, "bad", 7000);
    return;
  }
  if (status) {
    status.textContent = cls.note
      ? cls.note
      : `Contesta (${hello.slice(0, 20)}) y entiende la prueba: ${kindInfo(cls.kind).label}${cls.category ? ` · ${categoryInfo(cls.category).label}` : ""}.`;
  }
  toast(cls.note ? cls.note : "La IA contesta. Todo listo.", cls.note ? "warn" : undefined, 6000);
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
          <h3>Arrastra aquí los documentos</h3>
          <p>Fotos (JPG, PNG) o PDF, varias a la vez. Cada tipo se lee con su propio lector: ${importadoresDisponibles()
            .map((i) => i.label.toLowerCase())
            .join(", ")}. Todo se lee en tu ordenador y se guarda en tu base de datos.</p>
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
    else if (job.state === "saved") { stateText = job.savedLabel || "Guardada"; pct = 100; }
    else if (job.state === "skipped") { stateText = "Descartada"; pct = 100; }
    else if (job.state === "error") { stateText = job.error || "Error al leer"; pct = 100; }

    const cls = job.state === "saved" ? "done" : job.state === "error" ? "error" : "";
    const right = job.state === "reading" || job.state === "queued"
      ? `<div class="spinner"></div>`
      : job.state === "saved"
        ? `<span class="status paid static">Guardada</span>`
        : job.state === "error"
          ? `<button class="btn sm" data-action="retry-job" data-id="${job.id}">Reintentar</button>`
          : "";

    return `<div class="fileitem ${cls}">
      <div class="fi-icon">${icon(icoName)}</div>
      <div class="fi-body">
        <div class="fi-name">${esc(job.name || job.file.name)}</div>
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
      stage: "En cola",
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

/**
 * Lee un texto con el importador que le toca y, cuando el papel no tiene un
 * tipo propio claro (una factura, un justificante cualquiera), afina el tipo
 * con las reglas que el programa lleva dentro (model.js). Si esas reglas
 * nombran un tipo que tiene lector propio (nómina, liquidación, subvención…),
 * el documento se vuelve a leer entero con él, para que no salga a medias.
 *
 * Aquí no se llama a ninguna IA: el documento se lee solo con el programa, en
 * este ordenador, sin mandar el texto a ninguna parte.
 */
async function leerTextoDocumento(text, fileName, { useAi = true } = {}) {
  const finish = async (result) => {
    if (useAi && aiConfigured(getState().settings)) {
      await applyAiDocument({ parsed: result.lectura.doc }, text);
    }
    return result;
  };
  const opciones = { defaultRate: getState().settings.defaultRate, fileName };
  let lectura = leerDocumento(text, opciones);
  let cls = null;
  if (!lectura.generico) return finish({ lectura, cls });

  cls = classifyLocal(text, { fileName });
  if (cls.kind && cls.kind !== lectura.doc.kind) {
    const otra = leerDocumento(text, { ...opciones, tipo: cls.kind });
    if (otra.reconoce) return finish({ lectura: otra, cls: null });
    lectura.doc.kind = cls.kind;
    lectura.doc.direction = cls.direction || directionOf(cls.kind);
  }
  lectura.doc.category = cls.category || lectura.doc.category;
  lectura.doc.direction = cls.direction || lectura.doc.direction;
  lectura.doc.classifyWhy = cls.why || "";
  lectura.doc.classifyNote = cls.note || "";
  return finish({ lectura, cls });
}

/**
 * ¿Esta hoja es un papel con su propio total, o es la continuación del
 * anterior? Se apoya en lo que llevan los tres papeles que llegan aquí: una
 * nómina dice «nómina» y «líquido a percibir»; una liquidación dice
 * «liquidación» y «a percibir»; una factura dice «factura» y «total».
 */
function hojaEsPapelPropio(texto) {
  const t = String(texto || "");
  if (t.replace(/\s/g, "").length < 120) return false;
  if (/\b(continuaci[oó]n|contin[uú]a|viene de la p[aá]gina|anexo|resumen anual)\b/i.test(t)) {
    return false;
  }
  const titulo =
    /\b(n[oó]mina|recibo de salarios|liquidaci[oó]n|factura|factura simplificada|subvenci[oó]n|justificante|devengos)\b/i.test(
      t
    );
  const cifras =
    /\b(total(es)?|importe|a percibir|l[ií]quido|neto a percibir|total factura|total a pagar)\b/i.test(t);
  return titulo && cifras;
}

/**
 * Un mismo archivo puede traer varias hojas y cada hoja ser un papel distinto:
 * dos nóminas, una liquidación y una factura del mismo mes. Antes se leía todo
 * junto como un solo documento y los importes de una hoja se mezclaban con los
 * de otra (y la fecha de una, con el nombre de otra).
 *
 * Ahora se mira hoja por hoja: la hoja que trae su propio título y su propio
 * total abre un documento nuevo; la que no (la segunda hoja de una factura
 * larga) se queda con la anterior, como una sola cosa. Cada trozo se llama
 * «archivo · páginas 2-3» para que se vea de dónde sale.
 */
function trocearPorPaginas(textos, nombre) {
  const hojas = (Array.isArray(textos) ? textos : [])
    .map((t) => String(t || "").trim())
    .filter((t) => t.length);
  if (hojas.length <= 1) {
    return [{ texto: hojas[0] || "", nombre, hojas: hojas.length ? [1] : [] }];
  }

  const grupos = [];
  hojas.forEach((hoja, i) => {
    if (!grupos.length || hojaEsPapelPropio(hoja)) {
      grupos.push({ texto: hoja, hojas: [i + 1] });
    } else {
      const ultimo = grupos[grupos.length - 1];
      ultimo.texto = `${ultimo.texto}\n\n${hoja}`;
      ultimo.hojas.push(i + 1);
    }
  });

  if (grupos.length <= 1) {
    return [{ texto: grupos[0].texto, nombre, hojas: grupos[0].hojas }];
  }
  return grupos.map((g) => ({
    texto: g.texto,
    hojas: g.hojas,
    nombre: `${nombre} · ${g.hojas.length > 1 ? "páginas" : "página"} ${g.hojas.join(" y ")}`,
  }));
}

/*
 * Los títulos con los que empieza un papel. Hacen falta porque tres nóminas
 * pueden venir en tres hojas o pegadas en una sola página (una foto larga, un
 * escaneo): cada vez que reaparece uno de estos títulos empieza un papel nuevo.
 */
const RE_TITULO_PAPEL =
  /^\s*(recibo individual de salarios|recibo de salarios|n[oó]mina|hoja de salario|liquidaci[oó]n de fruta|liquidaci[oó]n|factura(?: simplificada)?|subvenci[oó]n)\b/i;

/** Corta un texto cada vez que vuelve a empezar un papel con su título. */
function trocearPorTitulos(texto) {
  const entero = String(texto || "");
  const lineas = entero.split(/\r?\n/);
  const cortes = [];
  let desde = 0;
  let visto = false;
  lineas.forEach((l, i) => {
    const limpia = l.trim();
    if (limpia.length < 4 || limpia.length > 70) return;
    if (limpia.split(/\s+/).filter(Boolean).length > 6) return;
    if (!RE_TITULO_PAPEL.test(limpia)) return;
    if (!visto) {
      visto = true;
      return;
    }
    // Solo cuenta como principio de un papel nuevo si lo de antes ya había
    // llegado a su total: así una línea suelta como «Nómina: marzo» dentro de
    // la misma hoja no parte el papel en dos.
    const antes = lineas.slice(desde, i).join("\n");
    if (!/(total|importe|l[ií]quido|a percibir|neto)/i.test(antes)) return;
    cortes.push(i);
    desde = i;
  });
  if (!cortes.length) return [entero];
  const trozos = [];
  desde = 0;
  for (const c of cortes) {
    trozos.push(lineas.slice(desde, c).join("\n"));
    desde = c;
  }
  trozos.push(lineas.slice(desde).join("\n"));
  return trozos.filter((t) => t.replace(/\s/g, "").length > 40);
}

/**
 * Separa un archivo en los papeles que trae de verdad: primero por hoja y,
 * dentro de cada hoja, cada vez que vuelve a empezar un título. Lo que no
 * vuelve a empezar (la segunda hoja de una factura larga) se queda con el papel
 * anterior, que es lo que es.
 */
function trocearPapeles(textos, nombre) {
  const porHoja = trocearPorPaginas(textos, nombre);
  const salida = [];
  for (const g of porHoja) {
    const dentro = trocearPorTitulos(g.texto);
    if (dentro.length <= 1) {
      salida.push(g);
      continue;
    }
    const donde =
      g.hojas.length === 1 ? `página ${g.hojas[0]}` : `páginas ${g.hojas.join(" y ")}`;
    dentro.forEach((t, i) => {
      salida.push({
        texto: t,
        hojas: g.hojas,
        nombre: `${nombre} · ${donde}, papel ${i + 1}`,
      });
    });
  }
  return salida;
}

async function runOne(job) {
  job.state = "reading";
  job.stage = "Abriendo el archivo";
  job.pct = 4;
  paintIngestSoon();

  try {
    let text = "";
    let source = job.preSource || "pdf-text";
    let hojas = null;

    if (job.preTexto) {
      // Esta entrada ya viene leída: es otra hoja del mismo archivo.
      text = job.preTexto;
      hojas = [job.preTexto];
    } else {
      const leido = await readFile(job.file, (stage, pct) => {
        job.stage = stage;
        job.pct = pct;
        paintIngestSoon();
      });
      text = leido.text;
      source = leido.source;
      hojas = leido.textos || null;
    }

    // Varias hojas en el mismo archivo: puede haber varios papeles dentro (dos
    // nóminas, una liquidación y una factura…). Se separan antes de leer, para
    // que los importes de una hoja no se mezclen con los de la de al lado.
    if (!job.preTexto) {
      const trozos = trocearPapeles(hojas, job.name || job.file.name);
      if (trozos.length > 1) {
        for (let i = 1; i < trozos.length; i += 1) {
          ui.jobs.push({
            id: `job_${Math.random().toString(36).slice(2, 9)}`,
            file: job.file,
            name: trozos[i].nombre,
            state: "queued",
            pct: 0,
            stage: "En cola (otra hoja del mismo archivo)",
            preTexto: trozos[i].texto,
            preSource: source,
            pages: trozos[i].hojas,
            trozos: trozos.length,
            papel: i + 1,
          });
        }
        job.name = trozos[0].nombre;
        job.trozos = trozos.length;
        job.pages = trozos[0].hojas;
        job.papel = 1;
        text = trozos[0].texto;
      }
    }

    job.text = text;
    job.source = source;

    if (!text.trim()) {
      job.state = "error";
      job.error = "No he podido sacar texto. Prueba con una foto más nítida o escríbela a mano.";
      paintIngest();
      return;
    }

    job.stage = "Mirando qué documento es";
    job.pct = 90;
    paintIngestSoon();

    // Cada tipo de documento se lee con su propio importador: la nómina con el
    // suyo, la liquidación con el suyo… Nada de leerlo todo como una factura y
    // luego ir parcheándolo.
    const { lectura, cls } = await leerTextoDocumento(text, job.name || job.file.name, { useAi: false });
    job.importador = lectura.etiqueta;
    job.parsed = lectura.doc;
    job.parsed.rawText = text.slice(0, 30000);
    if (job.trozos > 1) {
      job.parsed.notes.unshift(
        `En el mismo archivo venían ${job.trozos} papeles: este es el de ${job.name.split(" · ").pop()}. Cada uno se guarda por separado.`
      );
    }
    if (lectura.id === "factura" && !looksLikeInvoice(text)) {
      job.parsed.notes.unshift("Esto no parece una factura. Comprueba que has subido el documento correcto.");
    }

    // Si la persona ha encendido la IA, la IA lee el documento tal cual (las
    // hojas o la foto) y corrige lo que mis reglas hayan podido ver mal: los
    // importes de una tabla, las columnas cambiadas, un papel torcido… Aquí es
    // donde se nota: sus datos mandan sobre los míos y quedan anotados.
    const settings = getState().settings;
    if (aiConfigured(settings)) {
      await applyAiDocument(job, text);
    }

    job.state = "parsed";
    paintIngest();
    if (cls && cls.note) toast(cls.note, "warn", 6000);
    await reviewJob(job);
  } catch (err) {
    job.state = "error";
    job.error = err && err.message ? err.message : "No he podido leer el archivo.";
    paintIngest();
  }
}

/* ------------------------------------------------------------------ */
/* Banco de pruebas: leer un PDF de ejemplo y ver qué sale             */
/* ------------------------------------------------------------------ */

/**
 * Coge un PDF (o una foto) de ejemplo, lo lee igual que lo leería de verdad
 * y enseña dos cosas: el texto tal cual ha salido y lo que el programa
 * entiende de él. No guarda nada —ni documento, ni proveedor, ni fichero— y
 * no manda nada a internet. Sirve para mirar por qué un papel se lee mal
 * antes de tocar el programa.
 */
async function runPruebas(files) {
  if (ui.pruebas.busy) {
    toast("Espera un momento: estoy terminando con el documento anterior.", "warn");
    return;
  }
  ui.pruebas.busy = true;
  try {
    for (const file of files) {
      const item = {
        name: file.name || "documento",
        kb: Math.max(1, Math.round((file.size || 0) / 1024)),
        source: "",
        pages: 1,
        texto: "",
        error: "",
        lectura: null,
        pendiente: true,
      };
      ui.pruebas.list.unshift(item);
      setPruebaStatus(`Leyendo ${item.name}…`);
      paintPruebas();
      try {
        const leido = await readFile(file, (stage, pct) => {
          const p = Number.isFinite(pct) ? ` · ${Math.round(pct)} %` : "";
          setPruebaStatus(`Leyendo ${item.name}: ${stage || "un momento"}${p}`);
        });
        item.source = leido.source || "";
        item.pages = leido.pages || 1;
        item.texto = String(leido.text || "");
        if (!item.texto.trim()) {
          item.error = "No he podido sacar ni una letra de este fichero. Prueba con otra copia del PDF o con una foto más nítida.";
        } else {
          // Se lee con el mismo camino que la importación de verdad
          // (leerTextoDocumento): primero el lector que más se parece al papel
          // y, si no hay ninguno claro, las reglas afinan el tipo. Si aquí se
          // llamara solo a leerDocumento, la prueba diría «factura genérica»
          // donde la aplicación acierta con la nómina, y no serviría de nada.
          // Un archivo puede traer varios papeles (tres nóminas, una nómina y
          // una factura…). Se separan ANTES de leer y cada uno se lee por su
          // cuenta: así la prueba enseña lo que el programa entiende de cada
          // papel, no una mezcla de todos los textos metida en un solo
          // documento. Es el mismo camino que la importación de verdad.
          const trozos = trocearPapeles(leido.textos, item.name);
          if (trozos.length > 1) {
            const cola = [];
            trozos.forEach((t, i) => {
              let it = item;
              if (i > 0) {
                it = {
                  name: "",
                  kb: item.kb,
                  source: item.source,
                  pages: t.hojas.length,
                  texto: "",
                  error: "",
                  lectura: null,
                  pendiente: true,
                };
                ui.pruebas.list.unshift(it);
              }
              it.name = t.nombre;
              it.texto = t.texto;
              it.pages = t.hojas.length;
              it.varios = trozos.length;
              cola.push(it);
            });
            paintPruebas();
            for (const it of cola) {
              try {
                const { lectura, cls } = await leerTextoDocumento(it.texto, it.name, { useAi: false });
                it.lectura = lectura;
                it.cls = cls || null;
              } catch (err) {
                it.error = err && err.message ? err.message : "No he podido leer este papel.";
              }
              it.pendiente = false;
              paintPruebas();
            }
          } else {
            const { lectura, cls } = await leerTextoDocumento(item.texto, item.name, { useAi: false });
            item.lectura = lectura;
            item.cls = cls || null;
          }
        }
      } catch (err) {
        item.error = err && err.message ? err.message : "No he podido leer este fichero.";
      }
      item.pendiente = false;
      paintPruebas();
    }
  } finally {
    ui.pruebas.busy = false;
    const ultimo = ui.pruebas.list[0];
    setPruebaStatus(
      ultimo
        ? `Ya está: ${ultimo.name}. Esto no se ha guardado en ningún sitio.`
        : "Ningún documento probado todavía."
    );
    // Se vuelve a pintar la pantalla entera para que aparezcan los botones de
    // copiar y guardar el informe, que antes no hacían falta.
    render();
  }
}

/**
 * Tres papeles de mentira para probar la pantalla sin tener el papel a mano.
 * Están escritos a mano, con los mismos nombres que traen los de verdad, para
 * poder comprobar de un vistazo si la pantalla enseña cada dato con su nombre.
 */
const EJEMPLOS_PRUEBA = {
  nomina: {
    nombre: "Ejemplo de nómina",
    texto: [
      "RECIBO INDIVIDUAL DE SALARIOS",
      "Trabajador: ANTONIO PÉREZ MARTÍN   NIF: 12345678Z",
      "Período: 01/03/2025 a 31/03/2025   30 días",
      "Salario base ..................... 1.200,00",
      "Plus convenio .................... 300,00",
      "Total devengado .................. 1.500,00",
      "Seguridad Social (6,35 %) ........ 95,25",
      "IRPF (8,00 %) .................... 120,00",
      "Total a cargo del trabajador ..... 95,25",
      "Líquido a percibir ............... 1.284,75",
      "Total a cargo de la empresa ...... 450,00",
    ].join("\n"),
  },
  liquidacion: {
    nombre: "Ejemplo de liquidación de fruta",
    texto: [
      "LIQUIDACIÓN DE FRUTA",
      "Alhóndiga La Palma, S. Coop.",
      "Comprador: FRUTAS DEL SUR SL   NIF: B35123456",
      "Fecha: 12/03/2025   Albarán: 412",
      "Producto: Plátano   Categoría: Primera",
      "Kilos: 1.000,00",
      "Precio: 0,85 €/kg",
      "Importe bruto: 850,00",
      "Descuento manipulación 3 %: 25,50",
      "Líquido a percibir: 824,50",
    ].join("\n"),
  },
  factura: {
    nombre: "Ejemplo de factura",
    texto: [
      "FACTURA Nº 2025/118",
      "Fecha: 14/03/2025",
      "Proveedor: SUMINISTROS AGRÍCOLAS SA   NIF: A38234567",
      "Base imponible: 1.000,00",
      "IGIC 7 %: 70,00",
      "Total: 1.070,00",
    ].join("\n"),
  },
};

/**
 * Prueba un texto pegado a mano: el mismo camino que un PDF (mismo
 * leerTextoDocumento), solo que aquí no hay fichero que abrir. Sirve para
 * mirar los nombres de los campos con los ejemplos de arriba o con un papel
 * que ya se tenga copiado. Tampoco guarda nada.
 */
async function probarTextoPegado(nombre, texto) {
  const cuerpo = String(texto || "");
  if (!cuerpo.trim()) {
    toast("Pega primero el texto del papel, o pulsa uno de los ejemplos.", "warn");
    return;
  }
  if (ui.pruebas.busy) {
    toast("Espera un momento: estoy terminando con el documento anterior.", "warn");
    return;
  }
  ui.pruebas.busy = true;
  const item = {
    name: String(nombre || "texto pegado a mano"),
    kb: Math.max(1, Math.round(cuerpo.length / 1024)),
    source: "",
    pages: 0,
    texto: cuerpo,
    error: "",
    lectura: null,
    pendiente: true,
  };
  ui.pruebas.list.unshift(item);
  setPruebaStatus(`Leyendo ${item.name}…`);
  paintPruebas();
  try {
    // Sin nombre de fichero: aquí no hay fichero, así que el lector no puede
    // dejarse llevar por cómo se llame. Se decide solo por el texto.
    const { lectura, cls } = await leerTextoDocumento(cuerpo, "", { useAi: false });
    item.lectura = lectura;
    item.cls = cls || null;
  } catch (err) {
    item.error = err && err.message ? err.message : "No he podido leer este texto.";
  } finally {
    item.pendiente = false;
    ui.pruebas.busy = false;
  }
  setPruebaStatus(`Ya está: ${item.name}. Esto no se ha guardado en ningún sitio.`);
  render();
}

/** El estado de la línea que dice qué está haciendo. */
function setPruebaStatus(texto) {
  ui.pruebas.status = String(texto || "");
  const el = document.getElementById("pruebaStatus");
  if (el) el.textContent = ui.pruebas.status;
}

/** Vuelve a pintar solo la lista de resultados (sin tocar los botones). */
function paintPruebas() {
  const host = document.getElementById("pruebaResults");
  if (!host) return;
  host.innerHTML = pruebasResultadosHtml();
  const el = document.getElementById("pruebaStatus");
  if (el) el.textContent = ui.pruebas.status || "Ningún documento probado todavía.";
}

function viewPruebas() {
  const hay = ui.pruebas.list.length > 0;
  return `
    <section class="card">
      <div class="card-head">
        <div>
          <h2>Probar cómo leo un documento</h2>
          <p>Elige un PDF o una foto de ejemplo y te enseño el texto que saco y lo que entiendo de él. Sin guardar nada y sin mandarlo a ningún sitio.</p>
        </div>
      </div>
      <div class="card-body">
        <div class="row wrap">
          <button class="btn primary" data-action="prueba-open">${icon("upload")}<span>Elegir un PDF o una foto</span></button>
          ${
            hay
              ? `<button class="btn" data-action="prueba-copy">${icon("file")}<span>Copiar el informe</span></button>
                 <button class="btn" data-action="prueba-export">${icon("download")}<span>Guardar el informe</span></button>
                 <button class="btn ghost" data-action="prueba-clear">${icon("trash")}<span>Vaciar</span></button>`
              : ""
          }
        </div>
        <input id="pruebaPicker" type="file" accept="application/pdf,image/*" multiple hidden>
        <p class="hint" id="pruebaStatus">${esc(ui.pruebas.status || "Ningún documento probado todavía.")}</p>
        <p class="hint">Si el PDF trae el texto incrustado se copia tal cual, y eso es exacto. Si es un escaneo o una foto, se pasa por el lector de fotos en español. La primera vez hace falta internet para bajar las dos bibliotecas (PDF.js y el lector de fotos); después ya se quedan guardadas.</p>
        <div class="prueba-pega">
          <h3>…o pega aquí el texto del papel</h3>
          <p class="hint">Para probar sin tener el PDF a mano, o con un papel que ya tengas copiado. Tampoco se guarda ni sale de aquí.</p>
          <textarea id="pruebaTexto" class="prueba-textarea" rows="7" spellcheck="false" placeholder="Pega aquí el texto de una nómina, una liquidación de fruta o una factura…"></textarea>
          <div class="row wrap">
            <button class="btn primary" data-action="prueba-leer-texto">${icon("file")}<span>Leer este texto</span></button>
            <button class="btn ghost" data-action="prueba-ejemplo" data-ejemplo="nomina">${icon("plus")}<span>Ejemplo: nómina</span></button>
            <button class="btn ghost" data-action="prueba-ejemplo" data-ejemplo="liquidacion">${icon("plus")}<span>Ejemplo: liquidación</span></button>
            <button class="btn ghost" data-action="prueba-ejemplo" data-ejemplo="factura">${icon("plus")}<span>Ejemplo: factura</span></button>
          </div>
        </div>
      </div>
    </section>
    <div id="pruebaResults">${pruebasResultadosHtml()}</div>`;
}

function pruebasResultadosHtml() {
  if (!ui.pruebas.list.length) return "";
  return ui.pruebas.list.map((r) => pruebaHtml(r)).join("");
}

/** Un bloque por documento probado: la cabecera, los datos y los dos textos. */
function pruebaHtml(r) {
  const L = r.lectura;
  const doc = L ? L.doc : null;
  const comoSeLeyo = r.source ? sourceLabel(r.source) : "";
  const cabecera = `
    <div class="card-head">
      <div>
        <h3>${esc(r.name)}</h3>
        <p>${esc(`${r.kb} KB`)}${comoSeLeyo ? ` · ${esc(comoSeLeyo)}` : ""}${
          doc ? ` · leído con el importador «${esc(L.etiqueta)}»` : ""
        }</p>
      </div>
      <span class="spacer"></span>
      ${doc ? `<span class="tag">${esc(kindInfo(doc.kind).label)}</span>` : ""}
    </div>`;

  if (r.pendiente) {
    return `<section class="card prueba">${cabecera}
      <div class="card-body"><p class="hint">Leyendo… en cuanto termine salen aquí el texto y lo que entiendo.</p></div>
    </section>`;
  }

  if (r.error || !doc) {
    return `<section class="card prueba">${cabecera}
      <div class="card-body"><p class="prueba-error">${esc(r.error || "No he podido leerlo.")}</p></div>
    </section>`;
  }

  const secciones = seccionesDeLectura(doc);
  const avisos = Array.isArray(doc.notes) ? doc.notes : [];
  const json = jsonDocumento(doc);
  const explicacion = explicacionDeLectura(r, doc);

  return `<section class="card prueba">
    ${cabecera}
    <div class="card-body">
      ${explicacion ? `<p class="prueba-explica">${esc(explicacion)}</p>` : ""}
      ${
        L.reconoce
          ? ""
          : `<p class="prueba-aviso">Este papel no lo reconoce ningún lector con nombre, así que se ha mirado como documento genérico. Puede que falte algún dato: mira la lista antes de fiarte.</p>`
      }
      ${secciones
        .map(
          (s) => `<h4 class="prueba-grupo">${esc(s.titulo)}</h4>
      <dl class="prueba-datos">
        ${s.filas
          .map((f) => `<div class="prueba-fila"><dt>${esc(f.etiqueta)}</dt><dd>${esc(f.valor)}</dd></div>`)
          .join("")}
      </dl>`
        )
        .join("")}
      ${
        r.varios > 1
          ? `<div class="prueba-separa"><strong>Este archivo traía ${r.varios} papeles distintos. Este es uno de ellos, leído por su cuenta:</strong> ${esc(
              r.name
            )}${r.pages > 1 ? ` (${r.pages} hojas)` : ""}. Cada uno se guarda como documento aparte.</div>`
          : ""
      }
      ${
        avisos.length
          ? `<div class="prueba-avisos"><strong>Lo que no me cuadra:</strong><ul>${avisos
              .map((a) => `<li>${esc(a)}</li>`)
              .join("")}</ul></div>`
          : ""
      }
      <details class="prueba-detalle">
        <summary>Ver el texto que he leído (${fmtNum(r.texto.length, 0)} caracteres)</summary>
        <pre class="prueba-texto">${esc(r.texto)}</pre>
      </details>
      <details class="prueba-detalle">
        <summary>Todos los datos tal cual</summary>
        <pre class="prueba-texto">${esc(json)}</pre>
      </details>
    </div>
  </section>`;
}

/**
 * Los datos del documento, en bloques y con el nombre que de verdad tienen en
 * ese papel. En una nómina no hay base imponible ni IGIC, y en una liquidación
 * de fruta la «base» del documento es el líquido a percibir, no la base de una
 * factura: ponerles la etiqueta de factura era leerlos mal.
 *
 * `categoryInfo("")` devuelve la primera categoría de la lista (agua), así que
 * un documento sin clasificar se quedaría con un concepto inventado: aquí se
 * comprueba antes.
 */
function seccionesDeLectura(doc) {
  const secciones = [];
  const push = (titulo, filas) => {
    const limpias = filas
      .filter((f) => f && f.valor !== null && f.valor !== undefined && String(f.valor).trim() !== "")
      .map((f) => ({ etiqueta: f.etiqueta, valor: String(f.valor) }));
    if (limpias.length) secciones.push({ titulo, filas: limpias });
  };
  const num = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const etiquetaContraparte =
    doc.kind === "NOMINA"
      ? "Trabajador"
      : doc.kind === "LIQUIDACION"
      ? "Comprador o alhóndiga"
      : doc.kind === "SUBVENCION"
      ? "Organismo"
      : "Proveedor";

  push("Qué es este papel", [
    { etiqueta: "Tipo de documento", valor: kindInfo(doc.kind).label },
    {
      etiqueta: "Concepto",
      valor: doc.category ? categoryInfo(doc.category).label : "sin clasificar",
    },
    {
      etiqueta: "¿Entra o sale dinero?",
      valor: doc.direction === "INGRESO" ? "Entra (ingreso)" : "Sale (gasto)",
    },
  ]);

  const pagado = doc.status === STATUS.PAID;
  push("Lo que dice el papel", [
    { etiqueta: "Número", valor: doc.number },
    { etiqueta: "Fecha", valor: doc.issueDate ? fmtDate(doc.issueDate) : "" },
    { etiqueta: "Vencimiento", valor: doc.dueDate ? fmtDate(doc.dueDate) : "" },
    { etiqueta: etiquetaContraparte, valor: doc.supplierName },
    { etiqueta: "NIF", valor: doc.supplierNif },
    {
      etiqueta: "Estado",
      valor: pagado
        ? doc.paidDate
          ? `Cobrado o pagado · ${fmtDate(doc.paidDate)}`
          : "Cobrado o pagado"
        : "Pendiente",
    },
  ]);

  const nom = doc.nomina || null;
  const liq = doc.liquidacionRead || doc.liquidacion || null;

  if (doc.kind === "NOMINA" || nom) {
    const n = nom || {};
    const bruto = num(n.bruto);
    const neto = num(n.neto);
    const ssT = num(n.ssTrabajador);
    const irpf = num(n.irpf);
    push("La nómina, línea a línea", [
      { etiqueta: "Trabajador", valor: n.trabajador || doc.supplierName },
      { etiqueta: "NIF", valor: n.nif || doc.supplierNif },
      { etiqueta: "Periodo", valor: n.periodo },
      { etiqueta: "Días", valor: num(n.dias) != null ? fmtNum(n.dias, 0) : "" },
      { etiqueta: "Salario base", valor: num(n.salarioBase) != null ? fmtEUR(n.salarioBase) : "" },
      { etiqueta: "Devengos (bruto)", valor: bruto != null ? fmtEUR(bruto) : "" },
      { etiqueta: "Seguridad Social del trabajador", valor: ssT != null ? fmtEUR(ssT) : "" },
      { etiqueta: "IRPF", valor: irpf != null ? fmtEUR(irpf) : "" },
      { etiqueta: "Seguridad Social de la empresa", valor: num(n.ssEmpresa) != null ? fmtEUR(n.ssEmpresa) : "" },
      { etiqueta: "Líquido a percibir", valor: neto != null ? fmtEUR(neto) : "" },
    ]);
    if (bruto != null && neto != null && ssT != null && irpf != null) {
      const calculado = round2(bruto - ssT - irpf);
      const diferencia = round2(calculado - neto);
      push("Comprobación de las cuentas", [
        { etiqueta: "Bruto − Seguridad Social − IRPF", valor: fmtEUR(calculado) },
        { etiqueta: "Líquido que pone el papel", valor: fmtEUR(neto) },
        {
          etiqueta: "Diferencia",
          valor:
            Math.abs(diferencia) <= 0.05
              ? "Cuadra"
              : `${fmtEUR(diferencia)} (no cuadra: míralo antes de guardar)`,
        },
      ]);
    }
  } else if (doc.kind === "LIQUIDACION" || liq) {
    const l = liq || {};
    const kg = num(l.kg);
    const precio = num(l.price);
    const bruto = num(l.gross);
    const neto = num(l.net);
    const descuentos = Array.isArray(l.discounts) ? l.discounts : [];
    const totalDescuentos = round2(
      descuentos.reduce((a, d) => a + (num(d && d.amount) || 0), 0)
    );
    const tipo = num(l.rate) != null ? num(l.rate) : num(doc.rate);
    push("La liquidación de fruta", [
      { etiqueta: "Producto", valor: l.product },
      { etiqueta: "Categoría", valor: l.category },
      { etiqueta: "Kilos", valor: kg != null ? `${fmtNum(kg, 2)} kg` : "" },
      { etiqueta: "Precio por kilo", valor: precio != null ? `${fmtNum(precio, 3)} €/kg` : "" },
      { etiqueta: "Bruto (kilos × precio)", valor: bruto != null ? fmtEUR(bruto) : "" },
      { etiqueta: "Descuentos", valor: descuentos.length ? fmtEUR(totalDescuentos) : "ninguno" },
      { etiqueta: "Líquido a percibir (bruto − descuentos)", valor: neto != null ? fmtEUR(neto) : "" },
      { etiqueta: "Tipo de IGIC del papel", valor: tipo != null ? `${fmtNum(tipo, 2)} %` : "" },
      { etiqueta: "Total con IGIC", valor: num(doc.total) != null ? fmtEUR(doc.total) : "" },
    ]);
    if (descuentos.length) {
      push(
        "Descuentos leídos",
        descuentos.slice(0, 12).map((d, i) => ({
          etiqueta: `${i + 1}. ${(d && d.label) || "Descuento"}`,
          valor: fmtEUR(num(d && d.amount) || 0),
        }))
      );
    }
    const partidas = Array.isArray(l.partidas) ? l.partidas : [];
    if (partidas.length > 1) {
      push(
        "Partidas leídas",
        partidas.slice(0, 12).map((p, i) => ({
          etiqueta: `${i + 1}. ${(p && p.categoria) || "sin categoría"}`,
          valor: `${fmtNum(num(p && p.kg) || 0, 2)} kg × ${fmtNum(num(p && p.price) || 0, 3)} €/kg = ${fmtEUR(
            num(p && p.gross) || 0
          )}`,
        }))
      );
    }
    if (kg != null && precio != null) {
      const calculado = round2(kg * precio);
      if (bruto != null) {
        const diferencia = round2(calculado - bruto);
        push("Comprobación de las cuentas", [
          { etiqueta: "Kilos × precio", valor: fmtEUR(calculado) },
          { etiqueta: "Bruto que pone el papel", valor: fmtEUR(bruto) },
          {
            etiqueta: "Diferencia",
            valor: Math.abs(diferencia) <= 0.05 ? "Cuadra" : `${fmtEUR(diferencia)} (no cuadra: míralo)`,
          },
        ]);
      }
    }
    if (neto != null && descuentos.length) {
      const diferencia = round2(round2((bruto || 0) - totalDescuentos) - neto);
      if (bruto != null && Math.abs(diferencia) > 0.05) {
        push("Comprobación de las cuentas", [
          { etiqueta: "Bruto − descuentos", valor: fmtEUR(round2(bruto - totalDescuentos)) },
          { etiqueta: "Líquido que pone el papel", valor: fmtEUR(neto) },
          { etiqueta: "Diferencia", valor: `${fmtEUR(diferencia)} (no cuadra: míralo)` },
        ]);
      }
    }
  } else {
    const base = num(doc.base);
    const tipo = num(doc.rate);
    const cuota = num(doc.igic);
    const total = num(doc.total);
    push("Los importes", [
      { etiqueta: "Base imponible", valor: base != null ? fmtEUR(base) : "" },
      { etiqueta: "Tipo de IGIC", valor: tipo != null ? `${fmtNum(tipo, 2)} %` : "" },
      { etiqueta: "Cuota de IGIC", valor: cuota != null ? fmtEUR(cuota) : "" },
      { etiqueta: "Total", valor: total != null ? fmtEUR(total) : "" },
    ]);
    if (base != null && tipo != null && total != null) {
      const calculado = round2(base * (1 + tipo / 100));
      const diferencia = round2(calculado - total);
      push("Comprobación de las cuentas", [
        { etiqueta: "Base + IGIC calculado", valor: fmtEUR(calculado) },
        { etiqueta: "Total que pone el papel", valor: fmtEUR(total) },
        {
          etiqueta: "Diferencia",
          valor: Math.abs(diferencia) <= 0.05 ? "Cuadra" : `${fmtEUR(diferencia)} (no cuadra: míralo)`,
        },
      ]);
    }
  }

  if (num(doc.confidence) != null) {
    push("Cómo de fiable es esta lectura", [
      { etiqueta: "Confianza del lector", valor: `${Math.round(num(doc.confidence) * 100)} %` },
      {
        etiqueta: "Qué ha pasado",
        valor:
          num(doc.confidence) >= 0.8
            ? "El papel traía los datos claros y se han leído enteros."
            : num(doc.confidence) >= 0.5
            ? "Faltan datos o hay algo que no cuadra: repasa los avisos."
            : "Se ha leído a medias. No lo des por bueno sin mirar el texto.",
      },
    ]);
  }

  return secciones;
}


/**
 * Una frase llana que dice qué ha entendido y por qué: la nota del lector
 * (classifyNote, la misma que se enseña al importar), el motivo de las reglas
 * (classifyWhy) y un aviso si las reglas y el lector no opinan lo mismo.
 */
function explicacionDeLectura(r, doc) {
  const partes = [];
  const nota = String(doc.classifyNote || "").trim();
  const motivo = String(doc.classifyWhy || "").trim();
  if (nota) partes.push(nota);
  if (motivo && motivo !== nota) partes.push(motivo);
  const cls = r && r.cls;
  if (cls && cls.kind && cls.kind !== doc.kind) {
    partes.push(
      `Ojo: las reglas del programa dicen «${kindInfo(cls.kind).label}» y el lector que ha ganado dice «${kindInfo(
        doc.kind
      ).label}». Se ha quedado el del lector.`
    );
  }
  return partes.join(" ");
}

/** El documento en JSON, sin el texto entero: eso ya se enseña aparte. */
function jsonDocumento(doc) {
  try {
    const copia = { ...doc };
    delete copia.rawText;
    return JSON.stringify(copia, null, 2);
  } catch (_) {
    return "";
  }
}

/** El informe en texto de todo lo probado, para copiarlo o guardarlo. */
function informePruebas() {
  const list = ui.pruebas.list;
  if (!list.length) return "";
  const lineas = [
    "AGROSABINA SL · Informe de lectura de documentos de ejemplo",
    `Fecha: ${fmtDate(todayISO())}`,
    "Nada de esto se ha guardado en la aplicación.",
  ];
  list.forEach((r, i) => {
    lineas.push("");
    lineas.push(`${i + 1}. ${r.name} (${r.kb} KB)`);
    if (r.source) lineas.push(`   Leído así: ${sourceLabel(r.source)}`);
    if (r.pendiente) {
      lineas.push("   (todavía leyéndose)");
      return;
    }
    if (r.error || !r.lectura) {
      lineas.push(`   NO SE HA PODIDO LEER: ${r.error || "sin texto"}`);
      return;
    }
    const L = r.lectura;
    const doc = L.doc;
    lineas.push(
      `   Importador: ${L.etiqueta}${L.generico ? " (genérico)" : ""} · reconoce el papel: ${
        L.reconoce ? "sí" : "no"
      }`
    );
    const explicacion = explicacionDeLectura(r, doc);
    if (explicacion) lineas.push(`   Qué he entendido: ${explicacion}`);
    for (const s of seccionesDeLectura(doc)) {
      lineas.push(`   [${s.titulo}]`);
      for (const f of s.filas) lineas.push(`     ${f.etiqueta}: ${f.valor}`);
    }
    const avisos = Array.isArray(doc.notes) ? doc.notes : [];
    if (avisos.length) {
      lineas.push("   Avisos:");
      for (const a of avisos) lineas.push(`     - ${a}`);
    }
    lineas.push(`   --- TEXTO LEÍDO (${r.texto.length} caracteres) ---`);
    lineas.push(r.texto);
    lineas.push("   --- DATOS TAL CUAL ---");
    lineas.push(jsonDocumento(doc));
  });
  return lineas.join("\n");
}

/* ------------------------------------------------------------------ */
/* La IA lee el papel, no solo el texto que ha salido del papel       */
/* ------------------------------------------------------------------ */

/**
 * Le pasa a la IA el documento tal cual —las hojas del PDF dibujadas o la
 * foto— para que lo lea ella misma, y se queda con lo que ha leído.
 *
 * Va DESPUÉS de las reglas: las reglas dejan una primera ficha y la IA
 * corrige lo que ha visto mal (columnas de importes, dos nóminas juntas, una
 * foto torcida…). Lo que cambia se apunta en la ficha con el nombre del
 * modelo, para que en la revisión se vea de dónde viene cada dato.
 *
 * Solo se manda el documento, y solo si la persona ha encendido la IA y ha
 * dejado que lea el papel en Ajustes. Si la IA falla, no se toca nada.
 */
async function applyAiDocument(job, text) {
  const settings = getState().settings;
  if (!aiConfigured(settings)) return [];

  const p = job.parsed;
  if (!Array.isArray(p.notes)) p.notes = [];
  const model = String(settings.aiModel || AI_DEFAULTS.aiModel);

  // Cuando el archivo traía varios papeles, a la IA hay que decirle cuál de
  // ellos es este. Si sé en qué hoja está (el troceo lo apunta en job.pages),
  // se le manda solo esa hoja; si el papel está dentro de una hoja con otros
  // (tres nóminas en una foto), se le manda la hoja entera diciéndole por el
  // título dónde empieza el suyo.
  const cuantos = job.trozos || 1;
  const cual = job.papel || 1;
  const pages = Array.isArray(job.pages) && job.pages.length ? job.pages : null;
  const variasHojas = !!pages && pages.length > 1;

  let contexto = "";
  if (cuantos > 1) {
    const titulo = String(text || "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length >= 4 && l.length <= 70) || "";
    contexto =
      `En el mismo archivo vienen ${cuantos} papeles distintos y este es el número ${cual}. ` +
      (variasHojas
        ? `Te mando solo sus hojas (${pages.join(" y ")}). `
        : "Te mando la hoja donde está, que también trae otros papeles. ") +
      (titulo ? `El suyo empieza en la línea «${titulo}». ` : "") +
      "Lee SOLO ese papel: no mezcles sus importes con los de los demás.";
  }

  let images = [];
  try {
    job.stage = "Preparando el documento para la IA";
    job.pct = 93;
    paintIngestSoon();
    if (job.file && settings.aiReadDocument !== false) {
      const sacadas = await documentPageImages(job.file, {
        maxPages: pages ? Math.min(6, pages.length) : 6,
        pages,
      });
      images = sacadas.images || [];
      if (pages ? pages.length > images.length : sacadas.total > images.length) {
        p.notes.push("La IA no ha visto todas las páginas en imagen; revisa las páginas restantes y sus totales.");
      }
    }
  } catch (_) {
    images = [];
  }

  let ai;
  try {
    job.stage = images.length
      ? `La IA está leyendo el documento (${model})…`
      : `La IA está leyendo el texto (${model})…`;
    paintIngestSoon();
    ai = await aiExtract(text, settings, {
      images,
      contexto,
      timeoutMs: 60000,
      onNote: (msg) => p.notes.push(msg),
    });
  } catch (err) {
    const why = err && err.message ? err.message : "no ha contestado";
    p.notes.push(`La IA no ha podido leer el documento (${why}). Se queda lo que he leído yo.`);
    return [];
  }

  const cambiado = [];
  p.notes.push(...(ai.warnings || []).map((v) => `Revisión de IA: ${v}`));
  const aiSupplierNif = normaliseSpanishNif(ai.supplierNif);
  if (ai.supplierNif && !aiSupplierNif) {
    p.notes.push("La lectura de IA del NIF no supera la comprobación; no la he usado.");
  }
  p.requiresReview = !!ai.requiresReview;
  if (ai.confidence < 0.7) {
    p.notes.push("La IA no sustituye datos porque su lectura tiene confianza baja.");
    p.confidence = Math.min(p.confidence ?? 1, ai.confidence);
    return [];
  }
  if (p.supplierNif && aiSupplierNif && p.supplierNif !== aiSupplierNif) {
    p.notes.push("La IA y el lector identifican personas distintas. No se han mezclado sus datos; revisa el emisor o trabajador.");
    p.requiresReview = true;
    return [];
  }
  const pon = (key, valor, etiqueta) => {
    if (valor == null || valor === "") return;
    const antes = p[key];
    const vacio = antes == null || antes === "" || (typeof antes === "number" && !Number.isFinite(antes));
    if (!vacio) {
      if (typeof valor === "number" && typeof antes === "number") {
        if (Math.abs(valor - antes) < 0.005) return;
      } else if (String(antes) === String(valor)) {
        return;
      }
      p.notes.push(`Discrepancia en ${etiqueta}: lector «${antes}», IA «${valor}». Comprueba el documento.`);
      p.requiresReview = true;
      if (ai.leido !== "papel") return;
    }
    p[key] = valor;
    cambiado.push(etiqueta);
  };

  // El tipo: si mis reglas no han sabido qué papel es, manda la IA. Si yo
  // había reconocido un tipo propio (nómina, liquidación, subvención…) el
  // papel manda y solo se avisa de que la IA ve otra cosa.
  const tipoIA = ai.kind || "";
  if (tipoIA) {
    const tipoMio = p.kind || "";
    const generico = !tipoMio || tipoMio === "OTRO" || tipoMio === "FACTURA";
    if (tipoIA === tipoMio) {
      /* de acuerdo */
    } else if (generico) {
      p.kind = tipoIA;
      p.direction = directionOf(tipoIA);
      cambiado.push(`que es ${kindInfo(tipoIA).label.toLowerCase()}`);
    } else {
      p.notes.push(
        `Ojo: la IA cree que esto es ${kindInfo(tipoIA).label.toLowerCase()} y yo he leído ${
          kindInfo(tipoMio).label.toLowerCase()
        }. Mira de qué papel se trata antes de guardarlo.`
      );
    }
  }

  pon("category", ai.category, "el concepto");
  pon("supplierName", ai.supplierName, "el nombre");
  pon("supplierNif", aiSupplierNif, "el NIF");
  pon("number", ai.number, "el número");
  pon("issueDate", ai.issueDate, "la fecha");
  pon("dueDate", ai.dueDate, "el vencimiento");
  if (ai.amountsValid && (p.kind !== "NOMINA" || ai.payrollValid)) {
    pon("base", ai.base, "la base");
    pon("igic", ai.igic, "la cuota de IGIC");
    pon("total", ai.total, "el total");
    pon("rate", ai.rate, "el tipo de IGIC");
    if (ai.lines.length && (ai.leido === "papel" || !p.lines?.length)) {
      p.lines = ai.lines;
      cambiado.push("el desglose de IGIC");
    }
  }
  if (p.kind === "NOMINA" && ai.nomina && ai.payrollValid) {
    const previous = p.nomina || {};
    const merged = { ...previous };
    for (const [key, value] of Object.entries(ai.nomina)) {
      if (value == null || value === "") continue;
      if (previous[key] != null && previous[key] !== "" && previous[key] !== value) {
        p.notes.push(`Discrepancia en nómina (${key}): lector «${previous[key]}», IA «${value}».`);
        p.requiresReview = true;
        if (ai.leido !== "papel") continue;
      }
      merged[key] = value;
    }
    p.nomina = merged;
    cambiado.push("el desglose de nómina");
  }

  // La liquidación de fruta: kilos, precio por kilo y descuentos. Solo se pone
  // si el papel es una liquidación (por mis reglas o por lo que dice la IA) y
  // la IA ha traído algo de eso.
  const liqIA = ai.liquidacion;
  const esLiquidacion = p.kind === "LIQUIDACION";
  if (liqIA && esLiquidacion && ai.settlementValid && ai.amountsValid) {
    const kg = liqIA.kg;
    const price = liqIA.price;
    const discounts = Array.isArray(liqIA.discounts) ? liqIA.discounts : [];
    const bruto = liqIA.gross ?? (kg != null && price != null ? round2(kg * price) : null);
    const dto = round2(discounts.reduce((s, d) => s + (Number(d.amount) || 0), 0));
    const liquido = liqIA.net != null ? liqIA.net : bruto != null ? round2(bruto - dto) : null;

    if (kg != null || price != null || liquido != null) {
      p.liquidacion = {
        product: liqIA.product || (p.liquidacion && p.liquidacion.product) || "",
        category: liqIA.category || (p.liquidacion && p.liquidacion.category) || "",
        kg,
        price,
        discounts,
        partidas: liqIA.partidas?.length ? liqIA.partidas : (p.liquidacion?.partidas || []),
      };
      p.liquidacionRead = {
        kg,
        price,
        gross: bruto,
        discounts,
        net: liquido,
        product: p.liquidacion.product,
        category: p.liquidacion.category,
        partidas: p.liquidacion.partidas,
        ok: !ai.requiresReview,
      };
      if (p.kind !== "LIQUIDACION") {
        p.kind = "LIQUIDACION";
        p.direction = "INGRESO";
        cambiado.push("que es una liquidación");
      }
      if (kg != null) cambiado.push("los kilos");
      if (price != null) cambiado.push("el precio por kilo");
      if (discounts.length) cambiado.push("los descuentos");
      if (liquido != null) {
        const tipo = Number.isFinite(Number(p.rate)) ? Number(p.rate) : 0;
        const cuota = round2((liquido * tipo) / 100);
        p.base = liquido;
        p.igic = cuota;
        p.total = round2(liquido + cuota);
        cambiado.push("el líquido a percibir");
      }
    }
  }

  p.aiUsed = model;
  p.confidence = Math.min(p.confidence ?? 1, ai.confidence, p.requiresReview ? 0.65 : 1);
  p.aiLeido = ai.leido === "papel" ? "papel" : "texto";
  if (cuantos > 1 && images.length === 0) {
    p.notes.push(
      "La IA ha leído el texto de este papel, no su imagen, porque no he podido preparar la imagen del archivo."
    );
  }

  if (cambiado.length) {
    const como = p.aiLeido === "papel" ? "mirando el papel" : "a partir del texto";
    const msg = `Estos datos los ha leído la IA (${model}) ${como}, y no las reglas: ${cambiado.join(
      ", "
    )}. Revísalos antes de guardar.`;
    p.notes.push(msg);
    p.classifyNote = p.classifyNote ? `${p.classifyNote} · ${msg}` : msg;
  } else if (ai.why) {
    p.notes.push(`La IA ha mirado el documento y coincide con lo que he leído yo. Dice: ${ai.why}`);
  }

  return cambiado;
}

/* ------------------------------------------------------------------ */
/* (Sin usar) La IA como segundo par de ojos                          */
/* ------------------------------------------------------------------ */

/**
 * OJO: esto ya no se llama desde ningún sitio. La aplicación lee los
 * documentos solo con sus propias reglas; queda aquí aparcado, sin usar, por
 * si algún día se quiere volver a enchufar. No lo enganches a la lectura.
 *
 * Antes pedía a la IA que interpretara el texto del documento y rellenaba SOLO
 * lo que las reglas no habían sabido leer (o una liquidación que no cuadraba).
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
  const aiSupplierNif = normaliseSpanishNif(ai.supplierNif);
  if (ai.supplierNif && !aiSupplierNif) {
    p.notes.push("La lectura de IA del NIF no supera la comprobación; no la he usado.");
  }

  const setIfEmpty = (key, value, label) => {
    const current = p[key];
    const empty =
      current == null || current === "" || (typeof current === "number" && !Number.isFinite(current));
    if (empty && value != null && value !== "") {
      p[key] = value;
      filled.push(label);
    }
  };

  // La IA propone el tipo, pero manda el papel: solo se cambia si el lector de
  // ese tipo reconoce el documento. Así una nómina no se convierte en
  // liquidación (ni al revés) porque el modelo vea «líquido a percibir».
  if (ai.kind && ai.kind !== p.kind && (!p.kind || p.kind === "OTRO")) {
    const otra = leerDocumento(text, { tipo: ai.kind });
    if (otra.reconoce) {
      Object.assign(p, otra.doc, {
        rawText: p.rawText,
        notes: [...(otra.doc.notes || []), ...(p.notes || [])],
      });
      filled.push("el tipo de documento");
    }
  }
  setIfEmpty("category", ai.category, "el concepto");
  setIfEmpty("supplierName", ai.supplierName, "el proveedor");
  setIfEmpty("supplierNif", aiSupplierNif, "el NIF");
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
  // lo que encontraron no cuadraba (kilos × precio ≠ bruto). Pero solo en una
  // liquidación de fruta de verdad: una nómina también dice «líquido a
  // percibir» y no por eso lleva kilos ni es dinero que entra.
  const reconoceLiquidacion =
    p.kind === "LIQUIDACION" || leerDocumento(text, { tipo: "LIQUIDACION" }).reconoce;
  const rulesFailed =
    reconoceLiquidacion && (!p.liquidacion || (p.liquidacionRead && p.liquidacionRead.ok === false));
  if (ai.liquidacion && rulesFailed) {
    const liqAI = ai.liquidacion;
    const kg = liqAI.kg;
    const price = liqAI.price;
    const discounts = liqAI.discounts || [];
    const gross = kg != null && price != null ? round2(kg * price) : null;
    const dtoSum = round2(discounts.reduce((sum, d) => sum + d.amount, 0));
    const net = liqAI.net != null ? liqAI.net : gross != null ? round2(gross - dtoSum) : null;

    p.liquidacion = {
      product: liqAI.product || (p.liquidacion && p.liquidacion.product) || "",
      category: liqAI.category || (p.liquidacion && p.liquidacion.category) || "",
      kg,
      price,
      discounts,
    };
    p.liquidacionRead = {
      kg,
      price,
      gross,
      discounts,
      net,
      product: p.liquidacion.product,
      category: p.liquidacion.category,
      ok: true,
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
      const cuota = round2((net * rate) / 100);
      p.base = net;
      p.igic = cuota;
      p.total = round2(net + cuota);
      filled.push("el líquido a percibir");
    }
  }

  if (filled.length) {
    p.aiUsed = model;
    const msg = `Estos datos los ha leído la IA (${model}) y no las reglas: ${filled.join(
      ", "
    )}. Revísalos antes de guardar.`;
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
  const opts = IGIC_RATES.map(
    (r) => `<option value="${r.value}" ${hasCurrent && Number(current) === r.value ? "selected" : ""}>${rateText(r.value)} — ${r.label.split("—")[1].trim()}</option>`
  );
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
 * Las partidas leídas por categoría (EXTRA, PRIMERA…), tal cual, y escondidas en
 * un campo para que al guardar no se pierdan: el bloque de arriba solo tiene
 * unos kilos y un precio totales.
 */
function liqPartidasHtml(liq) {
  const partidas = (liq && Array.isArray(liq.partidas) ? liq.partidas : []).filter(Boolean);
  if (!partidas.length) return "";
  const filas = partidas
    .map((p) => {
      const trozos = [];
      if (p.kg != null) trozos.push(`${fmtNum(p.kg, 2)} kg`);
      if (p.price != null) trozos.push(`${fmtNum(p.price, 3)} €/kg`);
      if (p.gross != null) trozos.push(fmtEUR(p.gross));
      return `<span>${esc(p.categoria || "Partida")}</span><span>${trozos.join(" · ") || "—"}</span>`;
    })
    .join("");
  return `<div style="margin-top:8px">
        <div style="font-size:12px;color:var(--ink-3);margin-bottom:2px">Kilos leídos por categoría</div>
        <div style="display:grid;grid-template-columns:auto auto;gap:2px 14px;font-size:13px">${filas}</div>
        <input type="hidden" id="l-partidas" value="${esc(JSON.stringify(partidas))}">
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
    notes: liq.notes,
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
  const dtos = (read && read.discounts) || (liq && liq.discounts) || [];
  const dto = round2(dtos.reduce((a, d) => a + (d.amount || 0), 0));
  const gross =
    read && read.gross != null ? read.gross : kg != null && price != null ? round2(kg * price) : null;
  const net = read && read.net != null ? read.net : gross != null ? round2(gross - dto) : null;
  if (kg == null && price == null && net == null) return "";

  const rows = [];
  const row = (k, val, strong) => rows.push([k, val, strong]);
  if (read && read.product) row("Producto", esc(read.product));
  if (read && read.category) row("Categoría", esc(read.category));
  if (read && Array.isArray(read.partidas) && read.partidas.length) {
    read.partidas.forEach((p, i) => {
      const nombre = (p && p.categoria) || `Partida ${i + 1}`;
      const trozos = [];
      if (p && p.kg != null) trozos.push(`${fmtNum(p.kg, 2)} kg`);
      if (p && p.price != null) trozos.push(`${fmtNum(p.price, 3)} €/kg`);
      if (p && p.gross != null) trozos.push(fmtEUR(p.gross));
      row(esc(nombre), trozos.join(" · ") || "—");
    });
  }
  if (kg != null) row("Kilos", `${fmtNum(kg, 2)} kg`, true);
  if (price != null) row("Precio por kilo", `${fmtNum(price, 3)} €/kg`, true);
  if (gross != null) row("Bruto (kilos × precio)", fmtEUR(gross));
  if (dto) row(`Descuentos (${dtos.length})`, fmtEUR(dto));
  if (net != null) row("Líquido a percibir", fmtEUR(net), true);
  if (net != null) {
    const rate = read && read.rate != null ? Number(read.rate) : 0;
    const cuota = read && read.igic != null ? read.igic : round2((net * (rate || 0)) / 100);
    row("IGIC del papel", rate ? `${rateText(rate)} · ${fmtEUR(cuota)}` : "0 % (no aparece)");
    row("Total a cobrar", fmtEUR(round2(net + cuota)), true);
  }

  return `<div class="summary-box span-2" style="margin-bottom:12px">
    ${icon("info")}
    <div>
      <div style="font-weight:600;margin-bottom:4px">Datos que voy a importar</div>
      <div style="display:grid;grid-template-columns:auto auto;gap:2px 14px;font-size:13px">
        ${rows
          .map(
            ([k, val, strong]) =>
              `<span>${k}</span><span${strong ? ' style="font-weight:600"' : ""}>${val}</span>`
          )
          .join("")}
      </div>
      <div style="font-size:12px;color:var(--ink-3);margin-top:6px">
        La base es el líquido a percibir y el IGIC es el que trae el papel. Si algo no te cuadra, cámbialo antes de guardar.
      </div>
    </div>
  </div>`;
}

/**
 * El recuadro con lo que se ha leído de una nómina, antes de guardarla.
 */
function nominaReadHtml(v) {
  const read = v && v.nominaRead;
  if (!read) return "";
  const n = calcularNomina(read);
  const filas = [];
  const fila = (k, val, strong) => filas.push([k, val, strong]);
  if (n.trabajador) fila("Trabajador", esc(n.trabajador), true);
  if (n.periodo) fila("Periodo", esc(n.periodo));
  if (n.dias != null) fila("Días", fmtNum(n.dias, 0));
  if (n.bruto != null) fila("Bruto (devengos)", fmtEUR(n.bruto), true);
  if (n.ssTrabajador != null) fila("Seguridad Social del trabajador", fmtEUR(n.ssTrabajador));
  if (n.irpf != null) {
    fila("IRPF", `${fmtEUR(n.irpf)}${n.irpfPct != null ? ` (${fmtNum(n.irpfPct, 2)} %)` : ""}`);
  }
  if (n.neto != null) fila("Líquido a percibir", fmtEUR(n.neto), true);
  if (n.ssEmpresa != null) fila("Seguridad Social de la empresa", fmtEUR(n.ssEmpresa));
  if (n.coste != null) fila("Coste para la empresa", fmtEUR(n.coste), true);
  if (!filas.length) return "";
  const notas = Array.isArray(read.notas) ? read.notas : [];
  return `<div class="summary-box span-2" style="margin-bottom:12px">
    ${icon("info")}
    <div>
      <div style="font-weight:600;margin-bottom:4px">Datos que voy a importar de la nómina</div>
      <div style="display:grid;grid-template-columns:auto auto;gap:2px 14px;font-size:13px">
        ${filas
          .map(
            ([k, val, strong]) =>
              `<span>${k}</span><span${strong ? ' style="font-weight:600"' : ""}>${val}</span>`
          )
          .join("")}
      </div>
      ${
        notas.length
          ? `<div style="font-size:12px;color:var(--ink-3);margin-top:6px">${notas
              .map((t) => esc(t))
              .join("<br>")}</div>`
          : ""
      }
    </div>
  </div>`;
}

/**
 * El bloque de la nómina en la ficha del documento: solo se ve cuando el tipo
 * es «Nómina». El líquido sale solo (bruto − Seguridad Social − IRPF).
 */
function nominaFormHtml(v) {
  const n = calcularNomina((v && v.nomina) || {});
  const kind = (v && v.kind) || "FACTURA";
  const val = (x) => (x == null ? "" : fmtNum(x));
  return `<div class="field span-2" id="f-nom" ${kind === "NOMINA" ? "" : "hidden"}>
    <div class="lines-head">
      <div>
        <label>Recibo de salarios</label>
        <p class="lines-hint">Bruto, Seguridad Social e IRPF que trae el papel. La contabilidad apunta ${CUENTAS_NOMINA.sueldos} sueldos y ${CUENTAS_NOMINA.ssEmpresa} Seguridad Social de la empresa contra ${CUENTAS_NOMINA.ssPagar} Seguridad Social y ${CUENTAS_NOMINA.irpf} IRPF, y el líquido a la subcuenta de ${CUENTAS_NOMINA.liquido} de este trabajador (${CUENTAS_NOMINA.liquido}001, ${CUENTAS_NOMINA.liquido}002…), una por cada uno.</p>
      </div>
    </div>
    <div class="form-grid">
      <div class="field">
        <label for="n-trabajador">Trabajador</label>
        <input id="n-trabajador" type="text" autocomplete="off" value="${esc(n.trabajador)}" placeholder="Nombre y apellidos">
      </div>
      <div class="field">
        <label for="n-periodo">Periodo <span class="hint">(opcional)</span></label>
        <input id="n-periodo" type="text" autocomplete="off" value="${esc(n.periodo)}" placeholder="01/03/2025 a 31/03/2025">
      </div>
      <div class="field">
        <label for="n-bruto">Bruto (devengos)</label>
        <div class="with-suffix"><input id="n-bruto" type="text" inputmode="decimal" value="${val(n.bruto)}" placeholder="0,00"><span>€</span></div>
      </div>
      <div class="field">
        <label for="n-ss">Seguridad Social del trabajador</label>
        <div class="with-suffix"><input id="n-ss" type="text" inputmode="decimal" value="${val(n.ssTrabajador)}" placeholder="0,00"><span>€</span></div>
      </div>
      <div class="field">
        <label for="n-irpf">IRPF</label>
        <div class="with-suffix"><input id="n-irpf" type="text" inputmode="decimal" value="${val(n.irpf)}" placeholder="0,00"><span>€</span></div>
      </div>
      <div class="field">
        <label for="n-ssemp">Seguridad Social de la empresa</label>
        <div class="with-suffix"><input id="n-ssemp" type="text" inputmode="decimal" value="${val(n.ssEmpresa)}" placeholder="0,00"><span>€</span></div>
      </div>
      <div class="field span-2">
        <label for="n-neto">Líquido a percibir</label>
        <div class="with-suffix"><input id="n-neto" type="text" inputmode="decimal" value="${val(n.neto)}" placeholder="0,00"><span>€</span></div>
      </div>
      <p class="lines-sum" id="iv-nom-sum"></p>
      <p class="lines-hint span-2">La nómina no lleva IGIC. El líquido pasa a ser el importe a pagar y el bruto se registra como sueldo.</p>
    </div>
  </div>`;
}

/**
 * Conecta el bloque de la nómina con los campos de importes de la ficha:
 * al escribir el bruto y las deducciones se rellena solo el líquido.
 */
function bindNomina(wrap, ctx) {
  const box = wrap.querySelector("#f-nom");
  if (!box) return;
  const q = (id) => wrap.querySelector(id);
  const nBruto = q("#n-bruto");
  const nSs = q("#n-ss");
  const nIrpf = q("#n-irpf");
  const nSsEmp = q("#n-ssemp");
  const nNeto = q("#n-neto");
  const sum = q("#iv-nom-sum");
  if (!nBruto || !nSs || !nIrpf || !nSsEmp || !nNeto) return;

  const valor = (el) => (el && typeof el.value === "string" ? parseAmount(el.value) : null);

  function leer() {
    return {
      trabajador: (q("#n-trabajador") || {}).value || "",
      periodo: (q("#n-periodo") || {}).value || "",
      bruto: valor(nBruto),
      ssTrabajador: valor(nSs),
      irpf: valor(nIrpf),
      ssEmpresa: valor(nSsEmp),
      neto: valor(nNeto),
    };
  }

  function pintarResumen() {
    const n = calcularNomina(leer());
    if (sum) {
      sum.textContent =
        n.bruto == null ? "" : `Coste para la empresa ${fmtEUR(n.coste)} (bruto más la Seguridad Social de la empresa)`;
    }
    return n;
  }

  function pasarAlDocumento(n) {
    if (ctx.base && document.activeElement !== ctx.base) ctx.base.value = n.bruto == null ? "" : fmtNum(n.bruto);
    if (ctx.igic) ctx.igic.value = "0";
    if (ctx.rate) ctx.rate.value = "0";
    if (ctx.total && document.activeElement !== ctx.total) ctx.total.value = n.neto == null ? "" : fmtNum(n.neto);
  }

  function recalcular() {
    const n = pintarResumen();
    pasarAlDocumento(n);
  }

  function ver() {
    const payroll = !!ctx.kindSel && ctx.kindSel.value === "NOMINA";
    box.hidden = !payroll;
    for (const field of ctx.taxFields || []) field.hidden = payroll;
    if (payroll) {
      if (ctx.igic) ctx.igic.value = "0";
      if (ctx.rate) ctx.rate.value = "0";
    }
  }

  for (const el of [nBruto, nSs, nIrpf, nSsEmp, nNeto]) {
    el.addEventListener("input", () => {
      // El líquido se recalcula con lo escrito, salvo que se esté escribiendo a mano.
      const n = calcularNomina({ ...leer(), neto: null });
      if (document.activeElement !== nNeto) nNeto.value = n.neto == null ? "" : fmtNum(n.neto);
      recalcular();
    });
  }
  if (ctx.kindSel) ctx.kindSel.addEventListener("change", () => {
    ver();
    if (ctx.kindSel.value === "NOMINA") recalcular();
    else pintarResumen();
  });
  ver();
  if (ctx.kindSel && ctx.kindSel.value === "NOMINA") recalcular();
  else pintarResumen();
}

/**
 * Lo que se escribe en el bloque de la nómina, listo para guardar.
 */
function readNomina(wrap) {
  const box = wrap.querySelector("#f-nom");
  if (!box) return null;
  const val = (sel) => {
    const el = wrap.querySelector(sel);
    return el && typeof el.value === "string" ? el.value : "";
  };
  const n = {
    trabajador: val("#n-trabajador").trim(),
    nif: val("#f-nif").trim(),
    periodo: val("#n-periodo").trim(),
    bruto: parseAmount(val("#n-bruto")),
    ssTrabajador: parseAmount(val("#n-ss")),
    irpf: parseAmount(val("#n-irpf")),
    ssEmpresa: parseAmount(val("#n-ssemp")),
    neto: parseAmount(val("#n-neto")),
  };
  const algo = Object.keys(n).some((k) => n[k] != null && n[k] !== "");
  return algo ? n : null;
}

function invoiceFormHtml(v) {
  const state = getState();
  const exerciseYear = activeExerciseYear();
  const missingDetectedDate = !v.id && Array.isArray(v.notes) && v.notes.some((note) => /no he encontrado la fecha de la factura/i.test(String(note)));
  const issueDateValue = missingDetectedDate ? "" : String(v.issueDate || "");
  const issueYear = Number(issueDateValue.slice(0, 4));
  const matchesExercise = issueYear === exerciseYear;
  const dateBounds = (v.id ? matchesExercise : !issueDateValue || matchesExercise)
    ? `min="${exerciseYear}-01-01" max="${exerciseYear}-12-31"`
    : "";
  const exerciseHint = missingDetectedDate
    ? "No se detectó la fecha del documento. Escríbela para poder asignarlo al ejercicio correcto."
    : issueDateValue && !matchesExercise
      ? `El documento está fechado en ${issueYear}, fuera del ejercicio ${exerciseYear}. Selecciona ese año en Contabilidad para guardarlo.`
    : v.id && v.issueDate && !matchesExercise
    ? `Este documento pertenece al ejercicio ${issueYear}. Para cambiar su fecha, selecciona primero ese ejercicio en Contabilidad.`
    : `La fecha de emisión debe pertenecer al ejercicio ${exerciseYear}. El vencimiento o el pago pueden ser de otro año.`;
  const kind = v.kind || "FACTURA";
  const direction = v.direction || directionOf(kind);
  const payrollTaxHidden = kind === "NOMINA" ? "hidden" : "";
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
    ${v.classifyWhy || v.classifyNote ? `<div class="classify-why span-2" id="f-why">${icon("sparkle")}<span>${esc(
      [v.classifyWhy, v.classifyNote].filter(Boolean).join(" · ")
    )}</span></div>` : `<div class="classify-why span-2" id="f-why" hidden></div>`}
    ${liquidacionReadHtml(v)}
    ${nominaReadHtml(v)}
    <div class="field span-2">
      <label for="f-name">${kind === "NOMINA" ? "Trabajador" : kind === "LIQUIDACION" ? "Cliente o comprador" : "Proveedor"} <span class="tag" id="supplierHint" hidden></span></label>
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
      <input id="f-issue" type="date" ${dateBounds} value="${esc(issueDateValue)}" required>
      <span class="hint">${esc(exerciseHint)}</span>
    </div>
    <div class="field">
      <label for="f-due">Vencimiento <span class="hint">(opcional)</span></label>
      <input id="f-due" type="date" value="${esc(v.dueDate || "")}">
    </div>
    <div class="field invoice-tax-field" id="f-base-field" ${payrollTaxHidden}>
      <label for="f-base">Base imponible</label>
      <div class="with-suffix"><input id="f-base" type="text" inputmode="decimal" value="${v.base != null ? fmtNum(v.base) : ""}" placeholder="0,00"><span>€</span></div>
    </div>
    <div class="field invoice-tax-field" id="f-rate-field" ${payrollTaxHidden}>
      <label for="f-rate">Tipo de IGIC</label>
      <select id="f-rate">${rateOptions(v.rate)}</select>
    </div>
    <div class="field invoice-tax-field" id="f-igic-field" ${payrollTaxHidden}>
      <label for="f-igic">Cuota de IGIC</label>
      <div class="with-suffix"><input id="f-igic" type="text" inputmode="decimal" value="${v.igic != null ? fmtNum(v.igic) : ""}" placeholder="0,00"><span>€</span></div>
    </div>
    <div class="field invoice-tax-field" id="f-total-field" ${payrollTaxHidden}>
      <label for="f-total">Total de la factura</label>
      <div class="with-suffix"><input id="f-total" type="text" inputmode="decimal" value="${v.total != null ? fmtNum(v.total) : ""}" placeholder="0,00"><span>€</span></div>
    </div>
    <div class="field span-2 invoice-tax-field" id="f-lines-field" ${payrollTaxHidden}>
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
          <input id="l-product" type="text" value="${esc((v.liquidacion && v.liquidacion.product) || "")}" placeholder="Plátano, aguacate, tomate…">
        </div>
        <div class="field">
          <label for="l-category">Categoría <span class="hint">(opcional)</span></label>
          <input id="l-category" type="text" list="liq-categories" value="${esc((v.liquidacion && v.liquidacion.category) || "")}" placeholder="Extra, primera, segunda…">
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
          <div class="with-suffix"><input id="l-price" type="text" inputmode="decimal" value="${v.liquidacion && v.liquidacion.price != null ? fmtNum(v.liquidacion.price, 6) : ""}" placeholder="0,000"><span>€/kg</span></div>
        </div>
      </div>
      <div class="igic-lines" id="iv-dtos">${(((v.liquidacion && v.liquidacion.discounts) || []).map((d) => dtoRowHtml(d.label, d.amount)).join(""))}</div>
      ${liqPartidasHtml(
        v.liquidacion && (v.liquidacion.partidas || []).length
          ? v.liquidacion
          : v.liquidacionRead || v.liquidacion
      )}
      <p class="lines-sum" id="iv-liq-sum" hidden></p>
    </div>
    ${nominaFormHtml(v)}
    <div class="field span-2">
      <label>Estado</label>
      <div class="segmented" id="f-status-seg" data-value="${v.status === STATUS.PAID ? STATUS.PAID : STATUS.PENDING}">
        <button type="button" data-status="${STATUS.PENDING}" class="${v.status !== STATUS.PAID ? "active" : ""}">Pendiente</button>
        <button type="button" data-status="${STATUS.PAID}" class="${v.status === STATUS.PAID ? "active" : ""}">${directionOf(kind) === "INGRESO" ? "Cobrado" : "Pagado"}</button>
      </div>
      <div class="field" id="f-paid" style="margin-top:12px" ${v.status === STATUS.PAID ? "" : "hidden"}>
        <label for="f-paid-date">Fecha ${directionOf(kind) === "INGRESO" ? "del cobro" : "del pago"}</label>
        <input id="f-paid-date" type="date" value="${esc(v.paidDate || "")}">
        <span class="hint">No se encontró la fecha en el documento. Puedes indicarla aquí; si la dejas vacía, se guardará sin fecha.</span>
        <label for="f-paid-method" style="margin-top:10px">¿Cómo se ${directionOf(kind) === "INGRESO" ? "cobró" : "pagó"}?</label>
        <select id="f-paid-method">
          <option value="">Sin decir</option>
          <option value="CAJA" ${v.payMethod === "CAJA" ? "selected" : ""}>En efectivo (caja) · cuenta 570</option>
          <option value="BANCO" ${v.payMethod === "BANCO" ? "selected" : ""}>Por el banco · cuenta 572</option>
          <option value="TARJETA" ${v.payMethod === "TARJETA" ? "selected" : ""}>Con tarjeta · cuenta 572</option>
        </select>
        <label for="f-paid-account" style="margin-top:10px">Cuenta corriente <span class="hint">(o el nombre de la caja)</span></label>
        <input id="f-paid-account" type="text" value="${esc(v.payAccount || "")}" placeholder="Caja general · ES91 2100 0418 4502 0005 1332">
        <span class="hint">Se guarda con el documento y se apunta en el asiento, junto a la cuenta del PGC.</span>
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
  const values = editing
    ? {
        id: invoice.id,
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
        payMethod: invoice.payMethod || "",
        payAccount: invoice.payAccount || "",
        kind: invoice.kind || "FACTURA",
        category: invoice.category || "",
        direction: invoice.direction || directionOf(invoice.kind || "FACTURA"),
        lines: invoice.lines || [],
        liquidacion: invoice.liquidacion || null,
        nomina: invoice.nomina || null,
      }
    : job
      ? { ...job.parsed }
      : {
          supplierName: "",
          supplierNif: "",
          number: "",
          issueDate: Number(todayISO().slice(0, 4)) === activeExerciseYear() ? todayISO() : "",
          dueDate: "",
          base: null,
          rate: getState().settings.defaultRate,
          igic: null,
          total: null,
          status: STATUS.PENDING,
          kind: "FACTURA",
          category: "",
          direction: "GASTO",
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
        values.liquidacionRead = { ...liq, discounts: liq.discounts || [] };
      }
      delete liq.notes;
      values.liquidacion = liq;
    }
  }

  const title = editing ? "Editar documento" : job ? "Revisa lo que he leído" : "Nuevo documento";
  const sub = editing
    ? "Cambia lo que haga falta y guarda."
    : job
      ? `${sourceLabel(job.source)} · ${esc(job.file.name)} · ${
          job.importador ? `leído con el importador de ${esc(job.importador.toLowerCase())}` : "leído con sus reglas"
        }`
      : "Escribe los datos de la factura.";

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
          const saved = await submitInvoice(wrap, { mode, invoice, job });
          if (saved) {
            finish(saved);
            closeModal();
          }
        });
        wrap.querySelectorAll("[data-modal-cancel]").forEach((b) =>
          b.addEventListener("click", () => {
            closeModal();
            finish(null);
          })
        );
      },
      onClose() {
        finish(null);
      },
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
    showWhy(
      d === "INGRESO"
        ? "Documento de entrada de dinero (fruta o subvención)."
        : "Documento de gasto: se resta del resultado."
    );
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
    const i = round2((b * r) / 100);
    setIfNotFocused(igic, i);
    setIfNotFocused(total, round2(b + i));
  }

  function recalcFromIgic() {
    const b = num(base);
    const i = num(igic);
    if (i == null) return;
    if (b != null) {
      setIfNotFocused(total, round2(b + i));
      if (b > 0) syncRate(round2((i / b) * 100));
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
      if (b > 0) syncRate(round2((i / b) * 100));
    }
  }

  function syncRate(value) {
    if (!Number.isFinite(value) || value < 0 || value > 60) return;
    const match = [...rate.options].find((o) => Math.abs(Number(o.value) - value) < 0.06);
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

  [base, igic, total].forEach((el) =>
    el.addEventListener("blur", () => {
      const v = parseAmount(el.value);
      if (v != null) el.value = fmtNum(v);
    })
  );

  const paidWrap = q("#f-paid");
  seg.querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => {
      seg.dataset.value = b.dataset.status;
      seg.querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
      // La fecha solo tiene sentido con el documento cobrado o pagado.
      if (paidWrap) {
        const paid = b.dataset.status === STATUS.PAID;
        paidWrap.hidden = !paid;
      }
    })
  );

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
      if (found && found.id !== initial?.id) {
        dup.hidden = false;
        dup.querySelector("div").innerHTML =
          `<div>Ya tienes una factura con el número <strong>${esc(number.value.trim())}</strong> de este proveedor (${fmtDate(found.issueDate)}, ${fmtEUR(found.total)}).</div>
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
    const i = round2(rows.reduce((a, l) => a + round2((l.base * l.rate) / 100), 0));
    return { rows, base: b, igic: i, total: round2(b + i) };
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
        liqSum.textContent =
          `${fmtNum(liq.kg)} kg × ${fmtNum(liq.price, 6)} €/kg = ${fmtEUR(gross)}` +
          (dto ? ` − ${fmtEUR(dto)} de descuentos` : "") +
          ` · líquido a percibir ${fmtEUR(net)}`;
      }
    }
    return { liq, net };
  }

  function recalcFromLiq() {
    const { net } = paintLiq();
    if (net == null) return;
    const r = Number(rate.value);
    const cuota = Number.isFinite(r) ? round2((net * r) / 100) : 0;
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
  bindNomina(wrap, {
    kindSel, base, igic, rate, total,
    taxFields: [...wrap.querySelectorAll(".invoice-tax-field")],
  });

  if (initial && initial.rate != null && kindSel.value !== "NOMINA") rate.value = String(initial.rate);

  // Al importar una liquidación, la base, el IGIC y el total salen del líquido
  // que dice el papel (no del importe que hubiera elegido el lector genérico).
  if (initial && initial.liquidacionRead && liqBox && !liqBox.hidden) recalcFromLiq();
}

function readIgicLines(wrap) {
  const box = wrap.querySelector("#iv-lines");
  if (!box) return [];
  return [...box.querySelectorAll(".igic-line")]
    .map((row) => {
      const baseInput = row.querySelector(".line-base");
      const rateSelect = row.querySelector(".line-rate");
      const base = parseAmount(baseInput ? baseInput.value : "");
      const rate = Number(rateSelect ? rateSelect.value : NaN);
      if (base == null || !Number.isFinite(rate)) return null;
      return { base, rate };
    })
    .filter(Boolean);
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
  const discounts = dtos
    ? [...dtos.querySelectorAll(".dto-line")]
        .map((row) => {
          const labelEl = row.querySelector(".dto-label");
          const amountEl = row.querySelector(".dto-amount");
          const label = (labelEl ? labelEl.value : "").trim();
          const amount = parseAmount(amountEl ? amountEl.value : "");
          if (!label && amount == null) return null;
          return { label, amount: amount == null ? 0 : amount };
        })
        .filter(Boolean)
    : [];
  const partidas = (() => {
    const raw = val("#l-partidas");
    if (!raw) return [];
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.slice(0, 40) : [];
    } catch {
      return [];
    }
  })();
  if (!product && !category && kg == null && price == null && !discounts.length && !partidas.length) return null;
  return { product, category, kg, price, discounts, partidas };
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
  const kind = (q("#f-kind") && q("#f-kind").value) || "FACTURA";
  const payroll = kind === "NOMINA";
  const nomina = payroll ? readNomina(wrap) : null;

  return {
    supplierName: q("#f-name").value.trim(),
    supplierNif: q("#f-nif").value.trim(),
    number: q("#f-number").value.trim(),
    issueDate: q("#f-issue").value || "",
    dueDate: q("#f-due").value || "",
    kind,
    category: (q("#f-cat") && q("#f-cat").value) || "",
    direction: directionOf(kind),
    base: payroll ? nomina?.bruto ?? null : base,
    rate: payroll
      ? 0
      : lines.length > 1 && base > 0 && igic != null
        ? round2((igic / base) * 100)
        : Number.isFinite(rate)
          ? rate
          : null,
    igic: payroll ? 0 : igic,
    total: payroll ? nomina?.neto ?? null : total,
    lines: payroll ? [] : lines,
    // Cada tipo guarda solo lo suyo: una nómina no se queda con kilos ni una
    // liquidación con el recibo de salarios.
    liquidacion: kind === "NOMINA" ? null : readLiquidacion(wrap),
    nomina: kind === "LIQUIDACION" ? null : payroll ? nomina : readNomina(wrap),
    status: status === STATUS.PAID ? STATUS.PAID : STATUS.PENDING,
    paidDate:
      status === STATUS.PAID
        ? String((q("#f-paid-date") && q("#f-paid-date").value) || "").slice(0, 10)
        : "",
    payMethod: status === STATUS.PAID ? (q("#f-paid-method") && q("#f-paid-method").value) || "" : "",
    payAccount:
      status === STATUS.PAID
        ? String((q("#f-paid-account") && q("#f-paid-account").value) || "").trim()
        : "",
  };
}

async function submitInvoice(wrap, { mode, invoice, job }) {
  const v = readForm(wrap);

  const dateChanged = mode !== "edit" || !invoice || v.issueDate !== String(invoice.issueDate || "");
  if (dateChanged) {
    const dateError = exerciseDateError(v.issueDate);
    if (dateError) {
      toast(dateError, "bad", 7000);
      wrap.querySelector("#f-issue").focus();
      return null;
    }
  }
  const nif = normaliseSpanishNif(v.supplierNif);
  if (v.supplierNif && !nif) {
    toast("El NIF, NIE o CIF no tiene un formato válido. Corrígelo o déjalo vacío.", "bad", 5200);
    wrap.querySelector("#f-nif").focus();
    return null;
  }
  v.supplierNif = nif;

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
    const updated = updateInvoice(invoice.id, {
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
      nomina: v.nomina,
      status: v.status,
      paidDate: v.paidDate,
      payMethod: v.payMethod,
      payAccount: v.payAccount,
      kind: v.kind,
      category: v.category,
      direction: v.direction,
    });
    if (!updated) {
      toast(exerciseDateError(v.issueDate) || "No se pudo actualizar el documento.", "bad", 6500);
      return null;
    }
    toast(created ? `Documento guardado y proveedor «${supplier.name}» creado.` : "Documento actualizado.");
    return { invoice };
  }

  const res = addInvoice({
    ...v,
    source: job ? job.source : "manual",
    fileName: job ? job.file.name : "",
    rawText: job ? job.parsed.rawText : "",
    supplierNifOcrOriginal: job ? job.parsed.supplierNifOcrOriginal : "",
    notes: job ? job.parsed.notes : [],
    confidence: job ? job.parsed.confidence : null,
  });
  if (res.error || !res.invoice) {
    toast(res.error || "No se pudo guardar el documento.", "bad", 6500);
    return null;
  }

  // El fichero del que salieron los datos (la foto, el PDF) se guarda tal cual,
  // aparte de los datos, para poder volver a mirarlo desde la ficha.
  if (job && job.file && Number(job.file.size) > 0) {
    const kept = await keepInvoiceOriginal(res.invoice.id, job.file);
    if (kept) res.invoice.original = kept;
    else toast("El documento se guardó, pero el fichero original no se pudo guardar.", "warn", 5200);
  }

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
    toast("Este navegador no puede abrir la cámara desde la página. Elige una foto o un PDF.", "bad", 6000);
    return;
  }

  let photos = [];
  try {
    photos = await openCamera();
  } catch (err) {
    toast((err && err.message) || "No he podido abrir la cámara.", "bad", 7000);
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
  const res = await openInvoiceModal({ mode: "review", job });
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
  openModal(
    `<div class="modal-head">
      <div>
        <h2>Pegar el texto de un documento</h2>
        <p>Si tienes el texto (por ejemplo copiado de un correo), lo leo igual que una foto y con el lector que le toque: factura, nómina, liquidación…</p>
      </div>
      <button class="icon-btn" data-modal-cancel aria-label="Cerrar">${icon("x")}</button>
    </div>
    <div class="modal-body">
      <div class="field">
        <label for="pasteArea">Texto del documento</label>
        <textarea id="pasteArea" rows="10" placeholder="Proveedor: ...&#10;NIF: ...&#10;Factura nº: ...&#10;Base imponible: ...&#10;IGIC 7%: ...&#10;Total: ...&#10;&#10;(o una nómina: Trabajador, periodo, bruto, líquido a percibir)"></textarea>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn primary" data-read>Leer los datos</button>
      <button class="btn ghost" data-modal-cancel>Cancelar</button>
    </div>`,
    {
      onMount(wrap) {
        wrap.querySelectorAll("[data-modal-cancel]").forEach((b) =>
          b.addEventListener("click", () => closeModal())
        );
        wrap.querySelector("[data-read]").addEventListener("click", async () => {
          const text = wrap.querySelector("#pasteArea").value.trim();
          if (text.length < 10) {
            toast("Pega un poco más de texto.", "bad");
            return;
          }
          // El importador que reconozca el texto: si es una nómina la lee el
          // lector de nóminas, si es una liquidación el de liquidaciones.
          const { lectura } = await leerTextoDocumento(text, "texto pegado");
          const parsed = lectura.doc;
          closeModal();
          openInvoiceModal({
            mode: "review",
            job: {
              file: { name: "Texto pegado" },
              source: "pasted",
              parsed: { ...parsed, rawText: text.slice(0, 6000) },
            },
          });
        });
      },
    }
  );
}

/* ------------------------------------------------------------------ */
/* Proveedor: alta y edición                                          */
/* ------------------------------------------------------------------ */

export function openSupplierModal(supplier = null) {
  const editing = !!supplier;
  openModal(
    `<div class="modal-head">
      <div>
        <h2>${editing ? "Editar proveedor o cliente" : "Nuevo proveedor o cliente"}</h2>
        <p>Lo normal es que se creen solos al subir una factura o una liquidación.</p>
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
        <div class="field span-2">
          <label for="s-role">¿Qué es para ti?</label>
          <select id="s-role">
            <option value="PROVEEDOR" ${!supplier || supplier.role === "PROVEEDOR" || !supplier.role ? "selected" : ""}>Proveedor · le compras</option>
            <option value="CLIENTE" ${supplier && supplier.role === "CLIENTE" ? "selected" : ""}>Cliente · le vendes</option>
            <option value="AMBOS" ${supplier && supplier.role === "AMBOS" ? "selected" : ""}>Las dos cosas</option>
          </select>
          <span class="hint">Decide en qué lista sale (proveedores o clientes). También se pone solo, mirando los documentos que tenga.</span>
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
    </div>`,
    {
      onMount(wrap) {
        wrap.querySelectorAll("[data-modal-cancel]").forEach((b) =>
          b.addEventListener("click", () => closeModal())
        );
        wrap.querySelector("[data-save]").addEventListener("click", () => {
          const name = wrap.querySelector("#s-name").value.trim();
          if (!name) {
            toast("El proveedor necesita un nombre.", "bad");
            return;
          }
          const rawNif = wrap.querySelector("#s-nif").value.trim();
          const nif = normaliseSpanishNif(rawNif);
          if (rawNif && !nif) {
            toast("El NIF, NIE o CIF no tiene un formato válido. Corrígelo o déjalo vacío.", "bad", 5200);
            wrap.querySelector("#s-nif").focus();
            return;
          }
          const data = {
            name,
            nif,
            role: (wrap.querySelector("#s-role") && wrap.querySelector("#s-role").value) || "PROVEEDOR",
            phone: wrap.querySelector("#s-phone").value.trim(),
            email: wrap.querySelector("#s-email").value.trim(),
            note: wrap.querySelector("#s-note").value.trim(),
          };
          if (editing) {
            updateSupplier(supplier.id, data);
            toast("Ficha actualizada.");
          } else {
            const res = ensureSupplier(data.name, data.nif, data.role);
            if (res.created) {
              updateSupplier(res.supplier.id, {
                role: data.role,
                phone: data.phone,
                email: data.email,
                note: data.note,
              });
              toast(`«${res.supplier.name}» creado.`);
            } else {
              toast("Ya estaba en tu lista.", "bad");
            }
          }
          closeModal();
          render();
        });
      },
    }
  );
}

/* ------------------------------------------------------------------ */
/* Ajustes                                                            */
/* ------------------------------------------------------------------ */

export function openSettings() {
  const s = getState().settings;
  const provider = aiProviderOf(s);
  openModal(
    `<div class="modal-head">
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
        La copia JSON no incluye la clave de IA; configúrala de nuevo si cambias de navegador.
      </p>
      <div class="row wrap">
        <button class="btn sm" data-action="export-json">${icon("download")} Descargar copia</button>
        <button class="btn sm" data-action="import-json">${icon("upload")} Restaurar copia</button>
        <button class="btn sm" data-action="export-complete">${icon("download")} Descargar copia completa</button>
        <button class="btn sm" data-action="import-complete">${icon("upload")} Restaurar copia completa</button>
        <div class="spacer"></div>
        <button class="btn sm danger" data-action="clear-all">${icon("trash")} Borrar todo</button>
      </div>

      <hr style="border:none;border-top:1px solid var(--line);margin:20px 0">

      <h3 style="font-size:14px;font-weight:650;margin-bottom:4px">Los originales</h3>
      <p style="font-size:13px;color:var(--ink-3);margin-bottom:8px">
        De cada documento se guarda también el fichero tal y como entró —la foto, el PDF o el correo— y se puede
        volver a ver o descargar desde su ficha. La copia de datos habitual y el fichero .sqlite no incluyen
        originales. Elige «Descargar copia completa» para llevarte también los PDF, fotos y correos originales.
        Se descarga un JSON completo (máximo 200 MB), sin claves ni configuración de IA.
        Guárdalo en un lugar seguro: contiene tus documentos y datos personales.
        Al restaurarlo se añaden los registros sin borrar ni sustituir los actuales; los ajustes de este navegador se conservan.
      </p>
      <p id="origUsage" style="font-size:12.5px;color:var(--ink-3)">Mirando cuánto ocupan los originales…</p>

      <hr style="border:none;border-top:1px solid var(--line);margin:20px 0">

      <h3 style="font-size:14px;font-weight:650;margin-bottom:4px">Cuentas de cobro y pago</h3>
      <p style="font-size:13px;color:var(--ink-3);margin-bottom:12px">
        Al marcar un documento como cobrado o pagado se pregunta si fue en efectivo (caja) o por el banco, y en qué
        cuenta. Aquí se guardan los nombres para elegirlos sin escribirlos cada vez. La caja entra en la cuenta 570
        del PGC y el banco en la 572.
      </p>
      <div class="form-grid">
        <div class="field span-2">
          <label for="set-cash">Nombre de la caja</label>
          <input id="set-cash" type="text" value="${esc(s.cashAccount || "Caja general")}" placeholder="Caja general">
        </div>
        <div class="field span-2">
          <label for="set-banks">Cuentas corrientes <span class="hint">(una por línea)</span></label>
          <textarea id="set-banks" rows="3" placeholder="La Caixa · ES91 2100 0418 4502 0005 1332">${esc((Array.isArray(s.bankAccounts) ? s.bankAccounts : []).join("\n"))}</textarea>
          <span class="hint">Puedes escribir el nombre, el número o las dos cosas.</span>
        </div>
      </div>

      <hr style="border:none;border-top:1px solid var(--line);margin:20px 0">

      <h3 style="font-size:14px;font-weight:650;margin-bottom:4px">Interpretación con IA <span class="tag">opcional</span></h3>
      <p style="font-size:13px;color:var(--ink-3);margin-bottom:12px">
        Con esto encendido, la IA lee el documento y saca sus datos: de qué tipo es, en qué concepto entra, el
        proveedor, la fecha y los importes y, si es una liquidación, los kilos, el precio por kilo y los
        descuentos. Las reglas del programa van primero y la IA corrige lo que ellas hayan podido ver mal: si la
        IA no contesta, se sigue con las reglas.
      </p>
      <label style="display:flex;align-items:center;gap:9px;font-size:13.5px;font-weight:600;margin-bottom:12px">
        <input type="checkbox" id="set-ai-on" ${s.aiEnabled ? "checked" : ""}> Usar una IA para leer los documentos
      </label>
      <label style="display:flex;align-items:flex-start;gap:9px;font-size:13.5px;margin-bottom:8px">
        <input type="checkbox" id="set-ai-doc" style="margin-top:3px" ${
          s.aiReadDocument == null || s.aiReadDocument ? "checked" : ""
        }>
        <span>
          <strong>Que la IA lea el papel tal cual</strong>, no solo el texto que saca el lector.<br>
          <span class="hint">Le mando la foto o las hojas del PDF —hasta 4— y la IA lo mira y lo lee ella misma.
          Es lo que mejor funciona con las tablas de importes, pero significa que el documento sale de este
          ordenador y va al servicio de IA. Si lo desmarcas, solo le llega el texto ya leído.</span>
        </span>
      </label>
      <p style="font-size:12.5px;color:var(--ink-3);margin-bottom:12px">
        En los dos casos se manda únicamente el documento del que se trata, y solo si tú escribes tu clave. Nada
        más de la empresa: ni proveedores, ni totales, ni el resto de facturas.
      </p>
      <div class="form-grid">
        <div class="field span-2">
          <label for="set-ai-provider">Servicio</label>
          <select id="set-ai-provider">
            ${AI_PROVIDERS.map(
              (p) => `<option value="${p.id}" ${provider.id === p.id ? "selected" : ""}>${p.label}</option>`
            ).join("")}
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
    </div>`,
    {
      onMount(wrap) {
        wrap.querySelectorAll("[data-modal-cancel]").forEach((b) =>
          b.addEventListener("click", () => closeModal())
        );

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

        // Cuánto ocupan los originales guardados (se cuenta al abrir Ajustes).
        originalsUsage()
          .then((u) => {
            const el = wrap.querySelector("#origUsage");
            if (!el) return;
            el.textContent = u.count
              ? `Guardados ${u.count} original${u.count === 1 ? "" : "es"} · ${originalSizeText(u.bytes)} en este navegador.`
              : "Todavía no hay ningún original guardado: se guardan al dar de alta un documento con foto, PDF o correo.";
          })
          .catch(() => {});

        wrap.querySelector("[data-save]").addEventListener("click", () => {
          updateSettings({
            defaultRate: Number(wrap.querySelector("#set-rate").value),
            businessName: wrap.querySelector("#set-name").value.trim(),
            cashAccount: wrap.querySelector("#set-cash").value.trim() || "Caja general",
            bankAccounts: wrap
              .querySelector("#set-banks")
              .value.split("\n")
              .map((t) => t.trim())
              .filter(Boolean)
              .slice(0, 12),
            aiEnabled: wrap.querySelector("#set-ai-on").checked,
            aiReadDocument: !!(wrap.querySelector("#set-ai-doc") || {}).checked,
            aiEndpoint: wrap.querySelector("#set-ai-endpoint").value.trim(),
            aiModel: wrap.querySelector("#set-ai-model").value.trim(),
            aiKey: wrap.querySelector("#set-ai-key").value.trim(),
          });
          toast("Ajustes guardados.");
          closeModal();
          render();
        });
      },
    }
  );
}

/* ------------------------------------------------------------------ */
/* Exportar                                                           */
/* ------------------------------------------------------------------ */

function csvCell(value) {
  const s = value == null ? "" : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

export function exportCsv() {
  const list = sortedInvoices(filteredInvoices());
  if (!list.length) {
    toast("No hay facturas que exportar.", "bad");
    return;
  }
  const headers = [
    "Proveedor", "NIF", "Nº factura", "Fecha", "Vencimiento",
    "Base imponible", "Tipo IGIC (%)", "Cuota IGIC", "Total",
    "Estado", "Fecha de pago", "Origen",
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
      sourceLabel(inv.source),
    ].map(csvCell).join(";");
  });

  const csv = "\ufeff" + [headers.map(csvCell).join(";"), ...rows].join("\r\n");
  downloadText(`facturas-${todayISO()}.csv`, csv);
  toast(`Exportadas ${list.length} facturas.`);
}

export function exportBackup() {
  downloadText(`copia-facturas-${todayISO()}.json`, exportJSON(), "application/json");
  toast("Copia descargada.");
}

async function downloadCompleteBackup(el) {
  if (el) el.disabled = true;
  toast("Preparando la copia completa y comprobando los originales…", "ok", 6000);
  try {
    downloadText(`copia-completa-agrosabina-${todayISO()}.json`, await exportCompleteBackup(), "application/json");
    toast("Copia completa descargada, con sus originales.");
  } catch (err) {
    toast(err.message || "No se pudo crear la copia completa.", "bad", 10000);
  } finally { if (el) el.disabled = false; }
}

function askImportCompleteBackup() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json,.json";
  input.addEventListener("change", async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error("La copia supera el límite de 200 MB.");
      toast("Comprobando la copia completa y la integridad de sus originales…", "ok", 6000);
      const text = await file.text();
      const { data, originals, bytes } = await unpackCompleteBackup(text);
      const ok = await confirmDialog({
        title: "Añadir una copia completa",
        message: `Copia validada: ${data.suppliers.length} proveedores/clientes, ${data.invoices.length} documentos, ${(data.messages || []).length} correos y ${originals.size} originales (${(bytes / 1024 / 1024).toFixed(2)} MB). Se añadirán sin borrar ni sustituir los datos actuales. Los ajustes y claves de este navegador no cambian. Si ya restauraste esta copia, se duplicarán los registros. ¿Continuar?`,
        confirm: "Añadir documentos y originales",
      });
      if (!ok) return;
      // Evitar cambios desde otra pantalla mientras se confirma el guardado.
      const previousInert = document.body.inert;
      let result;
      document.body.inert = true;
      try {
        result = await importCompleteBackup(text);
      } finally { document.body.inert = previousInert; }
      closeModal();
      render();
      toast(`Restaurados ${result.invoices} documentos y ${result.originals} originales.`, "ok", 7000);
    } catch (err) {
      toast(err.message || "No se pudo restaurar la copia completa.", "bad", 10000);
    }
  });
  input.click();
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
        danger: true,
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
        preset: { kind: "LIQUIDACION", direction: "INGRESO" },
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
        toast(
          isIncome
            ? "Vuelve a estar por cobrar: se ha borrado la fecha de cobro."
            : "Vuelve a estar pendiente: se ha borrado la fecha de pago."
        );
        render();
        return;
      }
      askPaidDate(inv, isIncome, (day, pay) => {
        setInvoiceStatus(id, STATUS.PAID, day, pay);
        rememberPayAccount(pay && pay.method, pay && pay.account);
        const como =
          pay && pay.method === "CAJA"
            ? " en efectivo (caja)"
            : pay && pay.method === "BANCO"
              ? " por el banco"
              : pay && pay.method === "TARJETA"
                ? " con tarjeta"
              : "";
        toast(
          isIncome
            ? `Cobrado el ${fmtDate(day)}${como}.`
            : `Pagado el ${fmtDate(day)}${como}.`
        );
        render();
      });
      return;
    }
    case "doc-open": {
      const insp = getState().invoices.find((i) => i.id === id);
      if (insp) docPreviewModal(insp);
      return;
    }
    case "doc-dir":
      ui.docs.dir = el.dataset.value || "all";
      render();
      return;
    case "doc-status":
      ui.docs.status = el.dataset.value || "all";
      render();
      return;
    case "docs-reset":
      ui.docs = { q: "", kind: "all", dir: "all", status: "all", supplier: "", range: "all", from: "", to: "", sort: "recent" };
      render();
      return;
    case "docs-export":
      exportDocsCsv();
      return;
    case "edit-invoice": {
      const inv = getState().invoices.find((i) => i.id === id);
      if (inv) openInvoiceModal({ mode: "edit", invoice: inv });
      return;
    }
    case "delete-invoice": {
      const inv = getState().invoices.find((i) => i.id === id);
      if (!inv) return;
      const ok = await confirmDialog({
        title: "Borrar la factura",
        message: `Se borrará la factura ${inv.number || "sin número"} de ${supplierName(inv.supplierId)} (${fmtEUR(inv.total)}). El proveedor se queda en la lista.`,
        confirm: "Sí, borrarla",
        danger: true,
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
        message: n
          ? `Se borrará «${s.name}» y sus ${n} facturas. Esto no se puede deshacer.`
          : `Se borrará «${s.name}». No tiene facturas.`,
        confirm: "Sí, borrarlo",
        danger: true,
      });
      if (!ok) return;
      deleteSupplier(id);
      toast("Proveedor borrado.");
      render();
      return;
    }
    case "supplier-role": {
      const rol = (el && el.dataset && el.dataset.role) || "PROVEEDOR";
      ui.supplierRole = rol;
      render();
      return;
    }
    case "filter-supplier": {
      ui.filters.supplier = id;
      ui.filters.status = "all";
      const ter = supplierById(id);
      const esCli = ter && String(ter.role || "").toUpperCase() === "CLIENTE";
      location.hash = esCli ? "#/ventas" : "#/compras";
      render();
      return;
    }
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
        danger: true,
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
    case "export-complete":
      await downloadCompleteBackup(el);
      return;
    case "import-complete":
      askImportCompleteBackup();
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
        danger: true,
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
        confirm: "Sí, cargar el ejemplo",
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
    case "bank-upload": {
      document.getElementById("bankStatementPicker")?.click();
      return;
    }
    case "bank-statement-confirm": {
      await confirmBankStatementImport();
      return;
    }
    case "bank-reconcile-all": {
      await reconcileHighConfidenceBankMatches();
      return;
    }
    case "bank-match-review": {
      openBankMatchReview(id);
      return;
    }
    case "bank-rail-review": {
      openBankRailReview(id);
      return;
    }
    case "bank-rail-save": {
      saveBankRail(id);
      return;
    }
    case "bank-match-save": {
      await saveBankMatch(id);
      return;
    }
    case "bank-manual-post": {
      openBankManualPost(id);
      return;
    }
    case "bank-manual-post-save": {
      saveBankManualPost(id);
      return;
    }
    case "bank-download": {
      await downloadBankOriginal(id);
      return;
    }
    case "bank-delete-batch": {
      await deleteBankBatch(id);
      return;
    }
    case "acc-all": {
      ui.conta.range = "all";
      ui.conta.from = "";
      ui.conta.to = "";
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
    case "acc-opening-carryforward": {
      trasladarCierreApertura();
      return;
    }
    case "acc-entry-new": {
      accEntryModal(null);
      return;
    }
    case "acc-entry-edit": {
      accEntryModal(accManuales().find((a) => String(a.id) === String(id)) || null);
      return;
    }
    case "acc-entry-del": {
      deleteAccEntry(String(id || ""));
      return;
    }
    case "acc-entry-save": {
      saveAccEntry();
      return;
    }
    case "acc-entry-row": {
      accEntryAddRow();
      return;
    }
    case "acc-pdf-balance": {
      accPdfBalance();
      return;
    }
    case "acc-pdf-resultados": {
      accPdfResultados();
      return;
    }
    case "acc-own-new": {
      accOwnModal(null);
      return;
    }
    case "acc-own-edit": {
      const plan = accPlan();
      const todas = plan.subcuentas.concat(plan.propias);
      const cual = String(id || "");
      accOwnModal(todas.find((c) => String(c.code) === cual) || { code: cual, name: pgcNombre(cual) || "" });
      return;
    }
    case "acc-own-save": {
      saveAccOwn();
      return;
    }
    case "acc-plan-fix": {
      const plan = accPlan();
      updateSettings({ subcuentas: plan.subcuentas });
      toast(`${plan.subcuentas.length} subcuentas guardadas.`, "ok");
      render();
      return;
    }
    case "export-acc-csv": {
      exportAccCsv();
      return;
    }
    case "prueba-open": {
      const input = document.getElementById("pruebaPicker");
      if (input) input.click();
      else toast("Vuelve a abrir la pantalla y prueba otra vez.", "warn");
      return;
    }
    case "prueba-leer-texto": {
      const caja = document.getElementById("pruebaTexto");
      await probarTextoPegado("texto pegado a mano", caja ? caja.value : "");
      return;
    }
    case "prueba-ejemplo": {
      const cual = el.dataset.ejemplo || "";
      const ej = EJEMPLOS_PRUEBA[cual];
      if (!ej) {
        toast("Ese ejemplo no está.", "warn");
        return;
      }
      const caja = document.getElementById("pruebaTexto");
      if (caja) caja.value = ej.texto;
      await probarTextoPegado(ej.nombre, ej.texto);
      return;
    }
    case "prueba-copy": {
      const texto = informePruebas();
      if (!texto) {
        toast("Todavía no hay nada que copiar.", "warn");
        return;
      }
      try {
        await navigator.clipboard.writeText(texto);
        toast("Informe copiado. Ya puedes pegarlo donde quieras.", "ok", 4000);
      } catch (_) {
        downloadText("prueba-lectura.txt", texto, "text/plain;charset=utf-8");
        toast("No he podido copiarlo: te lo dejo como archivo de texto.", "warn", 5000);
      }
      return;
    }
    case "prueba-export": {
      const texto = informePruebas();
      if (!texto) {
        toast("Todavía no hay nada que guardar.", "warn");
        return;
      }
      downloadText("prueba-lectura.txt", texto, "text/plain;charset=utf-8");
      toast("Guardado como prueba-lectura.txt.", "ok", 4000);
      return;
    }
    case "prueba-clear": {
      ui.pruebas.list = [];
      ui.pruebas.status = "";
      toast("Banco de pruebas vacío.", "ok");
      render();
      return;
    }
    default:
      return;
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
  if (target.id === "docSearch") {
    ui.docs.q = target.value;
    refreshDocResults();
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
      } catch (_) {
        /* nada */
      }
    }
  }
}

export function onChange(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  if (target.id === "pruebaPicker") {
    const files = target.files ? Array.from(target.files) : [];
    target.value = "";
    if (files.length) runPruebas(files);
    return;
  }
  if (target.id === "accIgicYear") {
      activateExercise(target.value);
      render();
      return;
    }
  if (target.id === "accExercise") {
    if (!activateExercise(target.value)) {
      toast("El ejercicio seleccionado no es válido.", "warn");
    }
    render();
    return;
  }
  if (target.id === "accFrom" || target.id === "accTo") {
    const year = activeExerciseYear();
    const err = exerciseDateError(target.value, year);
    if (err) {
      toast(`El periodo debe estar dentro del ejercicio ${year}.`, "warn");
      render();
      return;
    }
    const key = target.id === "accFrom" ? "from" : "to";
    const other = target.id === "accFrom" ? ui.conta.to : ui.conta.from;
    if (other && (key === "from" ? target.value > other : target.value < other)) {
      toast("La fecha inicial debe ser anterior a la final.", "warn");
      render();
      return;
    }
    ui.conta[key] = target.value;
    render();
    return;
  }
  if (target.id === "docKind") {
    ui.docs.kind = target.value;
    render();
    return;
  }
  if (target.id === "docSupplier") {
    ui.docs.supplier = target.value;
    render();
    return;
  }
  if (target.id === "docSort") {
    ui.docs.sort = target.value;
    refreshDocResults();
    return;
  }
  if (target.id === "docRange") {
    ui.docs.range = target.value;
    if (ui.docs.range === "custom") {
      if (!ui.docs.from) ui.docs.from = `${new Date().getFullYear()}-01-01`;
      if (!ui.docs.to) ui.docs.to = todayISO();
    }
    render();
    return;
  }
  if (target.id === "docFrom" || target.id === "docTo") {
    ui.docs[target.id === "docFrom" ? "from" : "to"] = target.value;
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
  ["resultados", "Pérdidas y ganancias"],
  ["igic", "IGIC"],
  ["tesoreria", "Caja y bancos"],
  ["conciliacion", "Conciliación"],
  ["vencimientos", "Vencimientos"],
  ["cuentas", "Cuentas"],
];

let pendingBankStatementFile = null;

export function startBankStatementImport(file) {
  if (!file) return;
  const extension = String(file.name || "").split(".").pop().toLowerCase();
  if (!["csv", "ofx", "qif", "txt"].includes(extension)) {
    toast("Ese formato no se puede leer. Sube un CSV, OFX o QIF.", "warn");
    return;
  }
  if (file.size > 15 * 1024 * 1024) {
    toast("El extracto supera 15 MB. Exporta un periodo más corto desde tu banco.", "warn");
    return;
  }
  pendingBankStatementFile = file;
  const accounts = getState().settings?.bankAccounts || [];
  const defaultAccount = accounts.length === 1 ? accounts[0] : "";
  openModal(
    `<div class="modal-head">
      <div><h2>Importar extracto bancario</h2><p>Los movimientos se guardan para revisar; aún no se marca ningún pago como realizado.</p></div>
      <button class="icon-btn" data-modal-cancel aria-label="Cerrar">${icon("x")}</button>
    </div>
    <div class="modal-body">
      <div class="notice info"><strong>${esc(file.name)}</strong><br>Se leerán las fechas, los conceptos y los importes. Este extracto debe corresponder al ejercicio ${activeExerciseYear()}; el original se conservará en este navegador.</div>
      <label class="field" style="margin-top:14px">
        <span>Nombre de la cuenta bancaria</span>
        <input id="bankStatementAccount" type="text" list="bankStatementAccounts" value="${esc(defaultAccount)}" placeholder="Por ejemplo, cuenta agrícola" maxlength="120" required>
        <datalist id="bankStatementAccounts">${accounts.map((name) => `<option value="${esc(name)}"></option>`).join("")}</datalist>
      </label>
      <p class="muted" style="margin-top:10px">Formatos admitidos: CSV/TXT delimitado, OFX y QIF. Si tu banco exporta a Excel, guárdalo como CSV. Los extractos PDF no se leen en esta versión; los justificantes PDF o foto siguen en Documentos.</p>
    </div>
    <div class="modal-foot">
      <button class="btn primary" data-action="bank-statement-confirm">${icon("upload")}<span>Leer extracto</span></button>
      <button class="btn ghost" data-modal-cancel>Cancelar</button>
    </div>`,
    {
      narrow: true,
      onMount: (wrap) => {
        wrap.querySelectorAll("[data-modal-cancel]").forEach((el) => el.addEventListener("click", () => {
          pendingBankStatementFile = null;
          closeModal();
        }));
      },
    }
  );
}

function exerciseYears() {
  const current = new Date().getFullYear();
  const years = new Set([activeExerciseYear()]);
  for (let year = current - 10; year <= current + 2; year += 1) years.add(year);
  const state = getState();
  for (const inv of state.invoices || []) {
    const year = Number(String(inv.issueDate || "").slice(0, 4));
    if (Number.isInteger(year) && year >= 1900 && year <= 2200) years.add(year);
  }
  for (const entry of Array.isArray(state.settings?.asientosManuales) ? state.settings.asientosManuales : []) {
    const year = Number(String(entry.date || "").slice(0, 4));
    if (Number.isInteger(year) && year >= 1900 && year <= 2200) years.add(year);
  }
  for (const yearText of Object.keys(state.settings?.aperturasPorEjercicio || {})) {
    const year = Number(yearText);
    if (Number.isInteger(year) && year >= 1900 && year <= 2200) years.add(year);
  }
  for (const batch of Array.isArray(state.settings?.bankStatements) ? state.settings.bankStatements : []) {
    for (const movement of Array.isArray(batch?.movements) ? batch.movements : []) {
      const year = Number(String(movement.date || "").slice(0, 4));
      if (Number.isInteger(year) && year >= 1900 && year <= 2200) years.add(year);
    }
  }
  return [...years].sort((a, b) => b - a);
}

function activateExercise(yearValue) {
  const year = Number(yearValue);
  if (!Number.isInteger(year) || year < 1900 || year > 2200) return false;
  updateSettings({ activeExerciseYear: year });
  ui.conta.exerciseYear = year;
  ui.conta.year = year;
  ui.conta.from = `${year}-01-01`;
  ui.conta.to = `${year}-12-31`;
  return true;
}

/** El periodo contable queda siempre dentro del ejercicio natural activo. */
function contaWindow() {
  const year = activeExerciseYear();
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;
  if (ui.conta.exerciseYear !== year) {
    ui.conta.exerciseYear = year;
    ui.conta.year = year;
    ui.conta.from = start;
    ui.conta.to = end;
  }
  let from = ui.conta.from || start;
  let to = ui.conta.to || end;
  if (exerciseDateError(from, year) || exerciseDateError(to, year) || from > to) {
    from = start;
    to = end;
    ui.conta.from = from;
    ui.conta.to = to;
  }
  return { from, to, label: `Ejercicio ${year}` };
}

/** Los documentos con el nombre de su proveedor o comprador, listos para contabilizar. */
function accDocs() {
  const state = getState();
  const names = new Map((state.suppliers || []).map((s) => [s.id, s.name]));
  return (state.invoices || []).map((inv) =>
    Object.assign({}, inv, { party: names.get(inv.supplierId) || "" })
  );
}

/** Apertura guardada para el ejercicio indicado, sea manual o trasladada. */
function accApertura(year = activeExerciseYear()) {
  const s = getState().settings || {};
  const saved = s.aperturasPorEjercicio?.[String(year)];
  if (saved && Array.isArray(saved.lines)) {
    return {
      lines: saved.lines,
      fecha: `${year}-01-01`,
      sourceYear: Number(saved.sourceYear) || null,
    };
  }

  const legacyDate = String(s.openingDate || "").slice(0, 10);
  const legacyYear = legacyDate ? Number(legacyDate.slice(0, 4)) : activeExerciseYear();
  if (legacyYear !== Number(year)) return null;
  const capital = Number(s.openingCapital) || 0;
  const tesoreria = Number(s.openingCash) || 0;
  if (!capital && !tesoreria) return null;
  return { capital, tesoreria, fecha: legacyDate || `${year}-01-01` };
}

/** Los asientos escritos a mano que hay guardados. */
function accManuales() {
  const s = getState().settings || {};
  const list = Array.isArray(s.asientosManuales) ? s.asientosManuales : [];
  return list.filter((a) => a && a.id && Array.isArray(a.lineas) && a.lineas.length);
}

/** Guarda la lista de asientos escritos a mano. */
function saveAccManuales(list) {
  updateSettings({ asientosManuales: Array.isArray(list) ? list : [] });
}

function bankStatementBatches() {
  const list = getState().settings?.bankStatements;
  return Array.isArray(list)
    ? list
        .filter((batch) => batch && typeof batch.id === "string" && Array.isArray(batch.movements))
        .map((batch) => ({
          ...batch,
          movements: batch.movements.filter((movement) => movement && typeof movement.id === "string" && Number.isFinite(Number(movement.amount))),
        }))
    : [];
}

function bankRailLabel(rail) {
  if (rail === "TARJETA") return "Tarjeta";
  if (rail === "TRANSFERENCIA") return "Transferencia";
  return "No identificado";
}

function bankMovementLocation(movementId, batches = bankStatementBatches()) {
  for (const batch of batches) {
    const movement = batch.movements.find((item) => item && item.id === movementId);
    if (movement) return { batch, movement };
  }
  return null;
}

/**
 * El plan de cuentas que se está usando: una subcuenta por cada cliente y cada
 * proveedor que aparece en los documentos (430001, 400001…), una por cada
 * trabajador en su 465 (465001, 465002…) y las cuentas que haya añadido la
 * persona. Se calcula siempre igual, en orden alfabético, para que los números
 * no cambien al añadir un documento nuevo.
 */
function accPlan() {
  const s = getState().settings || {};
  const propias = (Array.isArray(s.cuentasPropias) ? s.cuentasPropias : [])
    .map((c) => ({ code: String((c && c.code) || "").trim(), name: String((c && c.name) || "").trim() }))
    .filter((c) => /^\d{3,6}$/.test(c.code) && c.name);

  const guardadas = (Array.isArray(s.subcuentas) ? s.subcuentas : [])
    .map((c) => ({
      code: String((c && c.code) || "").trim(),
      name: String((c && c.name) || "").trim(),
      key: String((c && c.key) || ""),
      cuenta: String((c && c.cuenta) || String((c && c.code) || "").slice(0, 3)),
    }))
    .filter((c) => /^\d{6}$/.test(c.code) && c.name);

  const subcuentas = guardadas.slice();
  const abiertas = subcuentas.map((c) => c.code);
  const yaEsta = new Set(subcuentas.map((c) => `${c.cuenta}|${c.key}`));

  const terceros = new Map();
  for (const doc of accDocs()) {
    // Una nómina no es de un proveedor: su deuda es con el trabajador y va a
    // su subcuenta de 465, así que aquí no se le abre ninguna 400.
    if (esNomina(doc)) continue;
    const tipo = String(doc.kind || "").toUpperCase();
    const ingreso =
      String(doc.direction || "") === "INGRESO" ||
      ["LIQUIDACION", "SUBVENCION", "COBRO", "VENTA"].indexOf(tipo) >= 0;
    const madre = ingreso ? "430" : "400";
    const key = claveDeTercero({ party: doc.party, supplierId: doc.supplierId });
    if (!key || yaEsta.has(`${madre}|${key}`) || terceros.has(`${madre}|${key}`)) continue;
    terceros.set(`${madre}|${key}`, { madre, key, nombre: String(doc.party || "").trim() });
  }

  const orden = [...terceros.values()].sort((a, b) =>
    a.madre === b.madre ? a.key.localeCompare(b.key) : a.madre.localeCompare(b.madre)
  );
  for (const t of orden) {
    const code = siguienteSubcuenta(t.madre, abiertas);
    abiertas.push(code);
    const etiqueta = t.madre === "430" ? "Clientes" : "Proveedores";
    const nombre = `${etiqueta} · ${t.nombre || t.key}`;
    subcuentas.push({ code, cuenta: t.madre, key: t.key, name: nombre.slice(0, 70) });
  }

  // Cada trabajador tiene su propia subcuenta de 465 (465001, 465002…): así se
  // sabe cuánto se le debe a cada uno y el pago se descuenta de la suya, igual
  // que se hace con clientes y proveedores.
  const trabajadores = new Map();
  for (const doc of accDocs()) {
    if (!esNomina(doc)) continue;
    const key = claveDeTrabajador(doc);
    if (!key || yaEsta.has(`465|${key}`) || trabajadores.has(key)) continue;
    const nom = doc.nomina && typeof doc.nomina === "object" ? doc.nomina : {};
    const nombre = String(nom.trabajador || doc.party || "").trim() || key;
    trabajadores.set(key, { key, nombre });
  }
  for (const t of [...trabajadores.values()].sort((a, b) => a.key.localeCompare(b.key))) {
    const code = siguienteSubcuenta("465", abiertas);
    abiertas.push(code);
    subcuentas.push({ code, cuenta: "465", key: t.key, name: `Trabajadores · ${t.nombre}`.slice(0, 70) });
  }

  return { subcuentas, propias };
}

/** Los asientos del periodo elegido. */
function asientosContables(w) {
  const win = w || contaWindow();
  setPlanDeCuentas(accPlan());
  return asientosDe(accDocs(), {
    from: win.from,
    to: win.to,
    apertura: accApertura(),
    manuales: accManuales(),
  });
}

/** Un número escrito a mano: vale «1.234,56» y «1234.56». */
function accNum(value) {
  const txt = String(value == null ? "" : value).replace(/[€\s]/g, "");
  if (!txt) return 0;
  const last = Math.max(txt.lastIndexOf(","), txt.lastIndexOf("."));
  const clean =
    last > -1 && txt.length - last <= 3 && txt.indexOf(",", last + 1) === -1
      ? txt.slice(0, last).replace(/[.,]/g, "") + "." + txt.slice(last + 1)
      : txt.replace(/[.,]/g, "");
  const n = Number(clean);
  return Number.isFinite(n) ? round2(n) : 0;
}

function accRangeBar(w) {
  const year = activeExerciseYear();
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;
  return `
    <div class="filters">
      <label class="date-filter"><span>Ejercicio</span><select id="accExercise" aria-label="Ejercicio contable">${exerciseYears().map((item) => `<option value="${item}"${item === year ? " selected" : ""}>${item}</option>`).join("")}</select></label>
      <label class="date-filter"><span>Desde</span><input id="accFrom" type="date" min="${start}" max="${end}" value="${esc(ui.conta.from || start)}" aria-label="Desde"></label>
      <label class="date-filter"><span>Hasta</span><input id="accTo" type="date" min="${start}" max="${end}" value="${esc(ui.conta.to || end)}" aria-label="Hasta"></label>
      <div class="spacer"></div>
      <button class="btn sm" data-action="acc-entry-new">${icon("plus")}<span>Nuevo asiento</span></button>
      <span class="tag kind">Contabilidad · versión 3</span>
      <span class="tag kind">${esc(w.label)} · año natural</span>
    </div>`;
}

function accTabBar() {
  return `<div class="acc-tabs" role="tablist">
    ${ACC_TABS.map(([id, label]) =>
      `<button class="acc-tab${ui.conta.tab === id ? " is-on" : ""}" data-action="acc-tab" data-id="${id}" role="tab" aria-selected="${ui.conta.tab === id}">${label}</button>`
    ).join("")}
  </div>`;
}

function accEmpty(text) {
  const docs = getState().invoices || [];
  const fuera = docs.length > 0 && ui.conta.range !== "all";
  const sinFecha = docs.filter((d) => !String(d.issueDate || d.createdAt || "").slice(0, 10)).length;
  let titulo = "Todavía no hay nada que contabilizar";
  let motivo =
    text ||
    "Los asientos salen solos de lo que ya tienes guardado: facturas, liquidaciones, subvenciones y nóminas. En cuanto haya un documento con fecha e importe, aparece aquí.";
  if (fuera) {
    titulo = "Ningún asiento en estas fechas";
    motivo = `Tienes ${docs.length} ${docs.length === 1 ? "documento guardado" : "documentos guardados"}, pero ninguno con fecha dentro de «${contaWindow().label}».`;
  } else if (sinFecha) {
    titulo = "Faltan fechas";
    motivo = `Hay ${sinFecha} ${sinFecha === 1 ? "documento" : "documentos"} sin fecha. En cuanto les pongas la fecha, aparecen aquí como asientos.`;
  }
  return `<section class="card"><div class="empty">
    <div class="e-icon">${icon("file")}</div>
    <h3>${titulo}</h3>
    <p>${esc(motivo)}</p>
    <div class="e-actions">
      ${fuera ? `<button class="btn primary" data-action="acc-all">${icon("arrow")} Ver todo lo registrado</button>` : ""}
      <a class="btn${fuera ? "" : " primary"}" href="#/compras">${icon("plus")} Ir a compras</a>
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
          ${i === 0 && e.manual ? `<div class="acc-row-tools">
            <span class="tag kind">A mano</span>
            <button class="btn xs ghost" data-action="acc-entry-edit" data-id="${esc(String(e.id))}">${icon("edit")}<span>Editar</span></button>
            <button class="btn xs ghost" data-action="acc-entry-del" data-id="${esc(String(e.id))}">${icon("trash")}<span>Borrar</span></button>
          </div>` : ""}
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
            <td class="num">${r.deudor ? fmtEUR(r.deudor) : '<span class="muted">—</span>'}</td>
            <td class="num">${r.acreedor ? fmtEUR(r.acreedor) : '<span class="muted">—</span>'}</td>
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
    const shown = total ? fmtEUR(r.value) : r.value ? fmtEUR(r.value) : '<span class="muted">—</span>';
    return `<tr class="acc-row acc-${r.kind}">
      <td class="acc-label">${esc(r.label)}</td>
      <td class="num">${shown}</td>
    </tr>`;
  });
  const aviso = bal.cuadra
    ? ""
    : `<div class="acc-warn">
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
      <button class="btn sm" data-action="acc-pdf-balance">${icon("download")}<span>Descargar PDF</span></button>
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
    const shown = l.total ? fmtEUR(l.value) : l.value ? fmtEUR(l.value) : '<span class="muted">—</span>';
    return `<tr class="acc-row ${l.total ? "acc-total" : ""}">
      <td class="acc-label">${esc(l.label)}</td>
      <td class="num">${shown}</td>
    </tr>`;
  });
  const aviso = pyg.sinClasificar
    ? `<div class="acc-warn">Hay ${fmtEUR(Math.abs(pyg.sinClasificar))} en cuentas de gasto o ingreso que no he sabido colocar en ninguna línea del modelo. Revisa el concepto de esos documentos.</div>`
    : "";
  return `
  <section class="card">
    <div class="card-head">
      <div>
        <h2>Cuenta de pérdidas y ganancias</h2>
        <p>Modelo oficial del Plan General de Contabilidad · los gastos van en negativo</p>
      </div>
      <div class="spacer"></div>
      <button class="btn sm" data-action="acc-pdf-resultados">${icon("download")}<span>Descargar PDF</span></button>
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

/* ------------------------------------------------------------------ */
/* Informes de gestión: IGIC, caja y bancos, vencimientos              */
/* ------------------------------------------------------------------ */

/** Un recuadro con un número grande y su nombre, para leer de un vistazo. */
function accKpi(label, value, hint) {
  return `<div class="acc-kpi">
    <span class="k-label">${esc(label)}</span>
    <strong class="k-value">${esc(value)}</strong>
    ${hint ? `<span class="k-hint">${esc(hint)}</span>` : ""}
  </div>`;
}

/** La tira de cuatro números que resume la empresa, arriba de Contabilidad. */
function accKpiStrip() {
  try {
    const docs = accDocs();
    const s = getState().settings || {};
    const hoy = todayISO();
    const tes = tesoreriaPorCuenta(docs, { cashName: s.cashAccount || "Caja general" });
    const venc = vencimientos(docs, { today: hoy });
    const igic = igicPorTrimestre(docs, { year: ui.conta.year });
    const mes = Number(hoy.slice(5, 7)) || 1;
    const trimestre = igic.rows[Math.min(3, Math.floor((mes - 1) / 3))] || igic.rows[0];
    const partida = Number(s.openingCash) || 0;
    const saldo = round2(tes.totales.saldo + partida);
    return `<section class="card acc-kpis-card">
      <div class="acc-kpis">
        ${accKpi("En caja y bancos", fmtEUR(saldo), partida ? "incluye el dinero de partida" : "cobrado menos pagado")}
        ${accKpi("Pendiente de cobro", fmtEUR(venc.cobros.total), venc.cobros.vencido ? `${fmtEUR(venc.cobros.vencido)} ya vencido` : "nada vencido")}
        ${accKpi("Pendiente de pago", fmtEUR(venc.pagos.total), venc.pagos.vencido ? `${fmtEUR(venc.pagos.vencido)} ya vencido` : "nada vencido")}
        ${accKpi(`IGIC ${trimestre.label} ${igic.year}`, fmtEUR(trimestre.diferencia), trimestre.diferencia >= 0 ? "sale a ingresar" : "sale a compensar")}
      </div>
    </section>`;
  } catch (err) {
    console.error("Resumen de contabilidad:", err);
    return "";
  }
}

/** IGIC: el año trimestre a trimestre, y el cuadre con el libro mayor. */
function accIgicHtml() {
  const year = Number(ui.conta.year) || new Date().getFullYear();
  const inf = igicPorTrimestre(accDocs(), { year });

  const actual = new Date().getFullYear();
  const anios = [];
  for (let y = actual; y >= actual - 5; y -= 1) anios.push(y);
  if (anios.indexOf(year) === -1) anios.push(year);
  anios.sort((a, b) => b - a);

  // Lo que dicen las cuentas 477 y 472 del libro mayor del mismo año.
  let mayorRep = null;
  let mayorSop = null;
  try {
    const mayor = libroMayor(asientosContables({ from: `${year}-01-01`, to: `${year}-12-31` }));
    const fila = (code) => mayor.find((r) => String(r.code) === code);
    const rep = fila("477");
    const sop = fila("472");
    mayorRep = rep ? round2(rep.credit - rep.debit) : 0;
    mayorSop = sop ? round2(sop.debit - sop.credit) : 0;
  } catch (err) {
    console.error("Cuadre del IGIC:", err);
  }

  const repercutido = inf.totals.cuotaRep;
  const soportado = inf.totals.cuotaSop;
  const cuadra = (a, b) => a == null || Math.abs(a - b) < 0.01;

  return `
  <div class="acc-toolbar-note">
    <span class="tag kind">Año</span>
    <select id="accIgicYear" aria-label="Elegir el año del IGIC">
      ${anios.map((y) => `<option value="${y}" ${y === year ? "selected" : ""}>${y}</option>`).join("")}
    </select>
    <div class="spacer"></div>
    <button class="btn sm ghost" data-action="export-acc-csv">${icon("download")}<span>Exportar CSV</span></button>
  </div>

  <section class="card">
    <div class="card-head">
      <div>
        <h2>IGIC del año ${esc(String(year))}</h2>
        <p>Lo que has repercutido en tus liquidaciones y subvenciones, menos lo que has soportado en tus gastos. Si el resultado es positivo, es lo que sale a ingresar; si es negativo, lo que queda a compensar en el trimestre siguiente.</p>
      </div>
    </div>
    <div class="table-wrap">
      <table class="data acc-table">
        <thead><tr>
          <th>Trimestre</th>
          <th class="num">Base repercutida</th>
          <th class="num">IGIC repercutido</th>
          <th class="num">Base soportada</th>
          <th class="num">IGIC soportado</th>
          <th class="num">Resultado</th>
        </tr></thead>
        <tbody>
          ${inf.rows
            .map(
              (r) => `<tr class="acc-row">
            <td><strong>${esc(r.label)}</strong> <span class="muted">${r.docs} ${r.docs === 1 ? "documento" : "documentos"}</span></td>
            <td class="num">${fmtEUR(r.baseRep)}</td>
            <td class="num">${fmtEUR(r.cuotaRep)}</td>
            <td class="num">${fmtEUR(r.baseSop)}</td>
            <td class="num">${fmtEUR(r.cuotaSop)}</td>
            <td class="num"><strong>${fmtEUR(r.diferencia)}</strong></td>
          </tr>`
            )
            .join("")}
        </tbody>
        <tfoot><tr>
          <td>Total del año</td>
          <td class="num">${fmtEUR(inf.totals.baseRep)}</td>
          <td class="num">${fmtEUR(repercutido)}</td>
          <td class="num">${fmtEUR(inf.totals.baseSop)}</td>
          <td class="num">${fmtEUR(soportado)}</td>
          <td class="num">${fmtEUR(inf.totals.diferencia)}</td>
        </tr></tfoot>
      </table>
    </div>
    <p class="acc-note">${
      inf.totals.sinTipo
        ? `${inf.totals.sinTipo} ${inf.totals.sinTipo === 1 ? "documento no lleva" : "documentos no llevan"} cuota de IGIC (tipo cero o exento). `
        : ""
    }Los cobros y los pagos sueltos no se cuentan aquí: su IGIC ya está en la liquidación o en la factura que los originó.</p>
  </section>

  <section class="card">
    <div class="card-head">
      <div>
        <h2>¿Cuadra con la contabilidad?</h2>
        <p>Lo mismo, sacado de las cuentas 477 (IGIC repercutido) y 472 (IGIC soportado) del libro mayor.</p>
      </div>
    </div>
    <div class="table-wrap">
      <table class="data acc-table">
        <thead><tr><th>Cuenta</th><th>Concepto</th><th class="num">En los libros</th><th class="num">En este informe</th><th>Estado</th></tr></thead>
        <tbody>
          <tr class="acc-row">
            <td>477</td><td>IGIC repercutido</td>
            <td class="num">${mayorRep == null ? "—" : fmtEUR(mayorRep)}</td>
            <td class="num">${fmtEUR(repercutido)}</td>
            <td>${cuadra(mayorRep, repercutido) ? "cuadra" : "hay asientos a mano"}</td>
          </tr>
          <tr class="acc-row">
            <td>472</td><td>IGIC soportado</td>
            <td class="num">${mayorSop == null ? "—" : fmtEUR(mayorSop)}</td>
            <td class="num">${fmtEUR(soportado)}</td>
            <td>${cuadra(mayorSop, soportado) ? "cuadra" : "hay asientos a mano"}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="acc-note">Este cuadro es un resumen de gestión, no la declaración: el modelo 420 se presenta en la sede de la Agencia Tributaria Canaria.</p>
  </section>`;
}

/** Caja y bancos: el dinero que entra y sale por cada sitio del periodo. */
function accTesoreriaHtml() {
  const w = contaWindow();
  const s = getState().settings || {};
  const inf = tesoreriaPorCuenta(accDocs(), {
    cashName: s.cashAccount || "Caja general",
    from: w.from,
    to: w.to,
  });
  const partida = Number(s.openingCash) || 0;
  const conPartida = round2(inf.totales.saldo + partida);
  const sinMedio = inf.cuentas.filter((c) => !c.method);
  const movimientosSinMedio = sinMedio.reduce((n, c) => n + c.movimientos.length, 0);

  return `
  <div class="acc-toolbar-note">
    <span class="tag kind">${inf.cuentas.length} ${inf.cuentas.length === 1 ? "cuenta de tesorería" : "cuentas de tesorería"}</span>
    <div class="spacer"></div>
    <button class="btn sm ghost" data-action="export-acc-csv">${icon("download")}<span>Exportar CSV</span></button>
  </div>

  <section class="card">
    <div class="card-head">
      <div>
        <h2>Caja y bancos</h2>
        <p>El dinero que ha entrado y ha salido por cada sitio, y lo que queda. Se decide al marcar cada documento como cobrado o pagado: en efectivo (caja, cuenta 570) o por el banco (cuenta 572).</p>
      </div>
    </div>
    <div class="acc-kpis">
      ${accKpi("Entradas", fmtEUR(inf.totales.entradas), "cobros del periodo")}
      ${accKpi("Salidas", fmtEUR(inf.totales.salidas), "pagos del periodo")}
      ${accKpi("Saldo del periodo", fmtEUR(inf.totales.saldo), "entradas menos salidas")}
      ${accKpi("Con el dinero de partida", fmtEUR(conPartida), partida ? `partida de ${fmtEUR(partida)}` : "sin datos de partida")}
    </div>
    ${
      inf.cuentas.length
        ? `<div class="table-wrap">
      <table class="data acc-table">
        <thead><tr><th>Cuenta</th><th class="num">Entradas</th><th class="num">Salidas</th><th class="num">Saldo</th></tr></thead>
        <tbody>
          ${inf.cuentas
            .map(
              (c) => `<tr class="acc-row">
            <td><strong>${esc(c.name)}</strong> <span class="muted">${
                c.method === "CAJA" ? "caja · 570" : c.method === "TARJETA" ? "tarjeta · 572" : c.method === "BANCO" ? "banco · 572" : "sin medio de pago"
              }</span></td>
            <td class="num">${fmtEUR(c.entradas)}</td>
            <td class="num">${fmtEUR(c.salidas)}</td>
            <td class="num"><strong>${fmtEUR(c.saldo)}</strong></td>
          </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>`
        : `<div class="empty"><p>Todavía no hay ningún cobro ni ningún pago en este periodo. Marca un documento como cobrado o pagado y aquí verás por dónde salió el dinero.</p></div>`
    }
  </section>

  ${inf.cuentas
    .filter((c) => c.movimientos.length)
    .map(
      (c) => `<section class="card">
    <div class="card-head">
      <div>
        <h2>${esc(c.name)}</h2>
        <p>${c.movimientos.length} ${c.movimientos.length === 1 ? "movimiento" : "movimientos"} · queda ${fmtEUR(c.saldo)}</p>
      </div>
    </div>
    <div class="table-wrap">
      <table class="data acc-table">
        <thead><tr><th>Fecha</th><th>Documento</th><th>Tercero</th><th class="num">Importe</th><th class="num">Saldo</th></tr></thead>
        <tbody>
          ${c.movimientos
            .map(
              (m) => `<tr class="acc-row">
            <td class="num">${fmtDate(m.date)}</td>
            <td>${esc(m.number || m.concept || "—")}</td>
            <td>${esc(m.party || "—")}</td>
            <td class="num">${fmtEUR(m.amount)}</td>
            <td class="num"><strong>${fmtEUR(m.running)}</strong></td>
          </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>
  </section>`
    )
    .join("")}

  ${
    movimientosSinMedio
      ? `<p class="acc-note">Hay ${movimientosSinMedio} ${movimientosSinMedio === 1 ? "cobro o pago antiguo" : "cobros o pagos antiguos"} sin medio de pago apuntado. Salen en su propio grupo para que las cuentas no se descuadren; si quieres asignarles caja o banco, ábrelos y vuelve a marcarlos como cobrados o pagados.</p>`
      : ""
  }
  ${
    inf.sinFecha.count
      ? `<p class="acc-note">${inf.sinFecha.count} ${inf.sinFecha.count === 1 ? "documento está" : "documentos están"} cobrado o pagado sin fecha (${fmtEUR(inf.sinFecha.amount)}), así que no se pueden colocar en un día.</p>`
      : ""
  }`;
}

function accConciliacionHtml() {
  const batches = bankStatementBatches();
  const w = contaWindow();
  const movements = batches.flatMap((batch) =>
    batch.movements.map((movement) => ({ ...movement, batchId: batch.id, batchName: batch.name, account: batch.account }))
  ).filter((movement) => (!w.from || movement.date >= w.from) && (!w.to || movement.date <= w.to));
  const suggestions = suggestBankMatches(movements, getState().invoices, getState().suppliers);
  const suggestionsById = new Map(suggestions.map((row) => [row.movement.id, row.suggestion]));
  const pending = movements.filter((movement) => movement.status === "PENDIENTE");
  const reconciled = movements.filter((movement) => movement.status === "CONCILIADO");
  const posted = movements.filter((movement) => movement.status === "CONTABILIZADO");
  const highCandidates = [];
  const usedInvoices = new Set();
  for (const row of suggestions) {
    if (!row.suggestion?.highConfidence || usedInvoices.has(row.suggestion.invoiceId)) continue;
    usedInvoices.add(row.suggestion.invoiceId);
    highCandidates.push(row);
  }
  const batchesHtml = batches.length
    ? `<div class="bank-batches">${batches.map((batch) => `
        <div class="bank-batch">
          <div class="bank-batch-copy">
            <strong>${esc(batch.name)}</strong>
            <span>${esc(batch.account)} · ${batch.movements.length} movimientos · importado ${fmtDate(batch.importedAt?.slice(0, 10))}${batch.duplicatesIgnored ? ` · ${batch.duplicatesIgnored} duplicados ignorados` : ""}${batch.skippedRows ? ` · ${batch.skippedRows} filas no leídas` : ""}</span>
          </div>
          <div class="bank-batch-actions">
            <button class="btn sm ghost" data-action="bank-download" data-id="${esc(batch.id)}" aria-label="Descargar ${esc(batch.name)}">${icon("download")}<span>Original</span></button>
            ${batch.movements.every((movement) => movement.status === "PENDIENTE") ? `<button class="btn sm ghost" data-action="bank-delete-batch" data-id="${esc(batch.id)}">${icon("trash")}<span>Eliminar</span></button>` : ""}
          </div>
        </div>`).join("")}</div>`
    : `<div class="empty">
        <div class="e-icon">${icon("upload")}</div>
        <h3>Aún no has importado ningún extracto</h3>
        <p>Sube un CSV/TXT delimitado, OFX o QIF. Los extractos PDF no se leen en esta versión. La conciliación propone pagos y cobros por importe, fecha y referencia.</p>
        <button class="btn primary" data-action="bank-upload">${icon("upload")}<span>Subir extracto</span></button>
      </div>`;

  return `
  <div class="stack">
    <div class="acc-toolbar-note bank-toolbar">
      <span class="tag kind">${batches.length} ${batches.length === 1 ? "extracto" : "extractos"}</span>
      <span class="muted">${w.label} · los pagos se confirman antes de contabilizarse</span>
      <div class="spacer"></div>
      <button class="btn sm" data-action="bank-upload">${icon("upload")}<span>Subir extracto</span></button>
      <button class="btn sm primary" data-action="bank-reconcile-all" ${highCandidates.length ? "" : "disabled"}>${icon("check")}<span>Conciliar ${highCandidates.length} coincidencias seguras</span></button>
    </div>
    <section class="acc-kpis">
      ${accKpi("Movimientos", String(movements.length), "en el periodo")}
      ${accKpi("Sin conciliar", String(pending.length), "requieren revisión")}
      ${accKpi("Conciliados", String(reconciled.length), "pagos enlazados a documentos")}
      ${accKpi("Contabilizados", String(posted.length), "movimientos sin documento")}
    </section>
    <section class="card">
      <div class="card-head">
        <div><h2>Extractos importados</h2><p>Los movimientos coincidentes usan el asiento del documento para evitar duplicar el banco.</p></div>
      </div>
      ${batchesHtml}
    </section>
    ${movements.length ? `<section class="card">
      <div class="card-head">
        <div><h2>Movimientos del banco</h2><p>Transferencias, pagos con tarjeta y otros cargos o abonos del extracto.</p></div>
      </div>
      <div class="table-wrap">
        <table class="data acc-table bank-table">
          <thead><tr><th>Fecha</th><th>Concepto</th><th>Medio</th><th class="num">Importe</th><th>Coincidencia</th><th></th></tr></thead>
          <tbody>
            ${movements.map((movement) => {
              const suggestion = suggestionsById.get(movement.id);
              const matchedInvoice = movement.status === "CONCILIADO"
                ? getState().invoices.find((invoice) => invoice.id === movement.matchedInvoiceId)
                : null;
              const statusLabel = movement.status === "CONCILIADO"
                ? `Conciliado · ${esc(matchedInvoice?.number || "documento")}`
                : movement.status === "CONTABILIZADO"
                  ? `Contabilizado en ${esc(movement.accountCode || "la cuenta elegida")}`
                  : suggestion
                    ? suggestion.confidence === "AMBIGUA" ? "Varias facturas posibles" : suggestion.label
                    : "Sin documento relacionado";
              const action = movement.status === "CONCILIADO"
                ? `<button class="btn sm ghost" data-action="edit-invoice" data-id="${esc(movement.matchedInvoiceId)}">Ver documento</button>`
                : movement.status === "CONTABILIZADO"
                  ? `<span class="tag kind">Incluido en el diario</span>`
                  : suggestion
                    ? `<button class="btn sm" data-action="bank-match-review" data-id="${esc(movement.id)}">${suggestion.confidence === "AMBIGUA" ? "Elegir factura" : "Revisar y conciliar"}</button>`
                    : `<button class="btn sm" data-action="bank-manual-post" data-id="${esc(movement.id)}">Clasificar y contabilizar</button>`;
              return `<tr>
                <td class="num">${fmtDate(movement.date)}</td>
                <td><div class="cell-main"><span class="name">${esc(movement.description)}</span><span class="sub">${esc(movement.batchName)} · ${esc(movement.reference || "sin referencia")}</span></div></td>
                <td>${bankRailLabel(movement.rail)}</td>
                <td class="num strong ${movement.amount < 0 ? "is-expense" : "is-income"}">${fmtEUR(movement.amount)}</td>
                <td><span class="bank-match-state ${movement.status === "PENDIENTE" ? "is-pending" : ""}">${statusLabel}</span></td>
                <td class="num"><div class="bank-row-actions">${movement.status === "PENDIENTE" && movement.rail === "OTRO" ? `<button class="btn sm ghost" data-action="bank-rail-review" data-id="${esc(movement.id)}">Indicar medio</button>` : ""}${action}</div></td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
    </section>` : ""}
    <p class="acc-note">Solo se concilian automáticamente importes exactos y documentos pendientes. Las coincidencias se revisan antes de marcar una factura como pagada o una liquidación como cobrada. Los cargos sin documento necesitan una cuenta contable elegida por ti.</p>
  </div>`;
}

function copyBankStatements() {
  return JSON.parse(JSON.stringify(bankStatementBatches()));
}

async function confirmBankStatementImport() {
  const file = pendingBankStatementFile;
  const accountInput = document.getElementById("bankStatementAccount");
  const account = String(accountInput?.value || "").trim().slice(0, 120);
  if (!file || !account) {
    toast("Indica la cuenta bancaria antes de importar.", "warn");
    return;
  }
  let parsed;
  try {
    parsed = parseBankStatement(await file.text(), file.name);
  } catch (err) {
    toast(err?.message || "No he podido leer el extracto.", "warn", 6000);
    return;
  }
  const year = activeExerciseYear();
  const outsideExercise = parsed.filter((movement) => !String(movement.date || "").startsWith(`${year}-`));
  if (outsideExercise.length) {
    const years = [...new Set(outsideExercise.map((movement) => String(movement.date || "").slice(0, 4)))].join(", ");
    toast(`El extracto contiene ${outsideExercise.length} movimientos fuera del ejercicio ${year} (${years}). No se ha importado ninguno; cierra este aviso, cambia el ejercicio en Contabilidad y vuelve a subirlo.`, "bad", 8000);
    return;
  }

  const batches = bankStatementBatches();
  const known = new Set(
    batches.flatMap((batch) => batch.movements.map((movement) => movement.fingerprint || statementFingerprint({ ...movement, account: batch.account })))
  );
  let duplicatesIgnored = 0;
  const movements = [];
  for (const item of parsed) {
    const fingerprint = statementFingerprint({ ...item, account });
    if (known.has(fingerprint)) {
      duplicatesIgnored += 1;
      continue;
    }
    known.add(fingerprint);
    movements.push({
      id: uid("bankmove"),
      date: item.date,
      amount: item.amount,
      description: item.description,
      reference: item.reference,
      rail: item.rail,
      fingerprint,
      status: "PENDIENTE",
    });
  }
  if (!movements.length) {
    toast(`No hay movimientos nuevos: se ignoraron ${duplicatesIgnored} duplicados.`, "info", 5000);
    pendingBankStatementFile = null;
    closeModal();
    return;
  }

  const batch = {
    id: uid("bankstatement"),
    name: String(file.name || "extracto").slice(0, 180),
    account,
    exerciseYear: year,
    importedAt: new Date().toISOString(),
    duplicatesIgnored,
    skippedRows: Number(parsed.skippedRows) || 0,
    movements,
  };
  let originalError = "";
  try {
    await keepOriginal(batch.id, file);
  } catch (err) {
    originalError = err?.message || "No se pudo guardar el original.";
  }

  const previousAccounts = [...(getState().settings?.bankAccounts || [])];
  const accounts = [...new Set([...previousAccounts, account])].slice(0, 12);
  updateSettings({ bankStatements: [...batches, batch], bankAccounts: accounts });
  if (!saveWorked()) {
    await dropOriginal(batch.id).catch(() => {});
    updateSettings({ bankStatements: batches, bankAccounts: previousAccounts });
    toast("No he podido guardar los movimientos en la base de datos. Comprueba el espacio disponible y vuelve a intentarlo.", "bad", 7000);
    return;
  }
  pendingBankStatementFile = null;
  closeModal();
  const duplicateText = duplicatesIgnored ? ` · ${duplicatesIgnored} duplicados ignorados` : "";
  const skippedText = batch.skippedRows ? ` · ${batch.skippedRows} filas sin datos válidos` : "";
  const originalText = originalError ? " El original no se pudo conservar en este navegador." : "";
  toast(`${movements.length} movimientos importados${duplicateText}${skippedText}.${originalText}`, originalError || batch.skippedRows ? "warn" : "ok", 6500);
  ui.conta.tab = "conciliacion";
  render();
}

function openBankMatchReview(movementId) {
  const location = bankMovementLocation(movementId);
  if (!location || location.movement.status !== "PENDIENTE") {
    toast("Ese movimiento ya no está pendiente de conciliar.", "warn");
    return;
  }
  const { batch, movement } = location;
  const result = suggestBankMatches([movement], getState().invoices, getState().suppliers)[0];
  const choices = result?.suggestion?.alternatives || [];
  if (!choices.length) {
    toast("No hay una factura pendiente del mismo importe y sentido. Puedes crear un asiento manual.", "info");
    return;
  }
  openModal(
    `<div class="modal-head">
      <div><h2>Revisar coincidencia</h2><p>${esc(movement.description)}</p></div>
      <button class="icon-btn" data-modal-cancel aria-label="Cerrar">${icon("x")}</button>
    </div>
    <div class="modal-body">
      <div class="bank-review-summary">
        <span>${fmtDate(movement.date)} · ${bankRailLabel(movement.rail)}</span>
        <strong>${fmtEUR(movement.amount)}</strong>
        <small>Cuenta: ${esc(batch.account)} · Extracto: ${esc(batch.name)}</small>
      </div>
      <label class="field" style="margin-top:14px">
        <span>Documento relacionado</span>
        <select id="bankMatchInvoice">
          ${choices.map((choice) => `<option value="${esc(choice.invoiceId)}">${esc(choice.label)}</option>`).join("")}
        </select>
      </label>
      <p class="muted" style="margin-top:10px">Al confirmar, el documento quedará pagado o cobrado en la fecha del extracto y el asiento usará la cuenta bancaria 572.</p>
    </div>
    <div class="modal-foot">
      <button class="btn primary" data-action="bank-match-save" data-id="${esc(movement.id)}">${icon("check")}<span>Conciliar y actualizar el documento</span></button>
      <button class="btn ghost" data-modal-cancel>Cancelar</button>
    </div>`,
    { narrow: true, onMount: (wrap) => wrap.querySelectorAll("[data-modal-cancel]").forEach((el) => el.addEventListener("click", () => closeModal())) }
  );
}

function openBankRailReview(movementId) {
  const location = bankMovementLocation(movementId);
  if (!location || location.movement.status !== "PENDIENTE") {
    toast("Solo puedes cambiar el medio de un movimiento pendiente.", "warn");
    return;
  }
  const { movement } = location;
  openModal(
    `<div class="modal-head">
      <div><h2>Indicar el medio de pago</h2><p>${esc(movement.description)}</p></div>
      <button class="icon-btn" data-modal-cancel aria-label="Cerrar">${icon("x")}</button>
    </div>
    <div class="modal-body">
      <div class="bank-review-summary"><span>${fmtDate(movement.date)} · ${fmtEUR(movement.amount)}</span><small>El extracto no identifica si fue tarjeta o transferencia.</small></div>
      <label class="field" style="margin-top:14px">
        <span>Medio</span>
        <select id="bankRailChoice" required>
          <option value="TRANSFERENCIA">Transferencia</option>
          <option value="TARJETA">Tarjeta</option>
        </select>
      </label>
    </div>
    <div class="modal-foot">
      <button class="btn primary" data-action="bank-rail-save" data-id="${esc(movement.id)}">${icon("check")}<span>Guardar medio</span></button>
      <button class="btn ghost" data-modal-cancel>Cancelar</button>
    </div>`,
    { narrow: true, onMount: (wrap) => wrap.querySelectorAll("[data-modal-cancel]").forEach((el) => el.addEventListener("click", () => closeModal())) }
  );
}

function saveBankRail(movementId) {
  const rail = String(document.getElementById("bankRailChoice")?.value || "");
  if (!["TARJETA", "TRANSFERENCIA"].includes(rail)) return;
  const statements = copyBankStatements();
  const movement = bankMovementLocation(movementId, statements)?.movement;
  if (!movement || movement.status !== "PENDIENTE") {
    toast("El movimiento ya no está pendiente.", "warn");
    return;
  }
  movement.rail = rail;
  updateSettings({ bankStatements: statements });
  closeModal();
  toast(`Medio actualizado: ${bankRailLabel(rail).toLowerCase()}.`, "ok");
  render();
}

async function saveBankMatch(movementId) {
  const location = bankMovementLocation(movementId);
  const select = document.getElementById("bankMatchInvoice");
  const invoiceId = String(select?.value || "");
  if (!location || !invoiceId) return;
  const { batch, movement } = location;
  const choices = suggestBankMatches([movement], getState().invoices, getState().suppliers)[0]?.suggestion?.alternatives || [];
  if (!choices.some((choice) => choice.invoiceId === invoiceId)) {
    toast("El documento ya no coincide con este movimiento.", "warn");
    return;
  }
  const invoice = getState().invoices.find((item) => item.id === invoiceId);
  if (!invoice || invoice.status === STATUS.PAID) {
    toast("Ese documento ya está pagado o cobrado.", "warn");
    return;
  }
  const isIncome = invoiceDirection(invoice) === "INGRESO";
  const ok = await confirmDialog({
    title: isIncome ? "Confirmar el cobro" : "Confirmar el pago",
    message: `El documento ${invoice.number || "sin número"} (${fmtEUR(invoice.total)}) pasará a ${isIncome ? "cobrado" : "pagado"} el ${fmtDate(movement.date)}. El asiento se generará desde el documento.`,
    confirm: isIncome ? "Sí, conciliar cobro" : "Sí, conciliar pago",
  });
  if (!ok) return;
  const statements = copyBankStatements();
  const applied = applyBankReconciliation(statements, [{
    movementId: movement.id,
    invoiceId,
    amount: movement.amount,
    date: movement.date,
    method: movement.rail === "TARJETA" ? "TARJETA" : "BANCO",
    account: batch.account,
  }]);
  if (!applied.length) {
    toast("No se ha conciliado: el movimiento o documento cambió mientras lo revisabas.", "warn");
    return;
  }
  closeModal();
  toast(isIncome ? "Cobro conciliado y contabilizado." : "Pago conciliado y contabilizado.", "ok");
  render();
}

async function reconcileHighConfidenceBankMatches() {
  const window = contaWindow();
  const batches = bankStatementBatches();
  const rows = batches.flatMap((batch) => batch.movements
    .filter((movement) => movement.status === "PENDIENTE" && (!window.from || movement.date >= window.from) && (!window.to || movement.date <= window.to))
    .map((movement) => ({ ...movement, batchId: batch.id, account: batch.account })));
  const candidates = suggestBankMatches(rows, getState().invoices, getState().suppliers);
  const selected = [];
  const usedInvoices = new Set();
  for (const row of candidates) {
    if (!row.suggestion?.highConfidence || usedInvoices.has(row.suggestion.invoiceId)) continue;
    usedInvoices.add(row.suggestion.invoiceId);
    selected.push(row);
  }
  if (!selected.length) {
    toast("No hay coincidencias seguras pendientes. Revisa las sugerencias una a una.", "info");
    return;
  }
  const amount = round2(selected.reduce((sum, row) => sum + Math.abs(Number(row.movement.amount) || 0), 0));
  const ok = await confirmDialog({
    title: `Conciliar ${selected.length} movimientos`,
    message: `Se enlazarán movimientos por ${fmtEUR(amount)} con facturas o liquidaciones de importe exacto. Los documentos pasarán a pagados o cobrados usando la fecha del extracto.`,
    confirm: "Sí, conciliar",
  });
  if (!ok) return;
  const statements = copyBankStatements();
  const matches = selected.map(({ movement }) => {
    const location = bankMovementLocation(movement.id, batches);
    return {
      movementId: movement.id,
      invoiceId: suggestBankMatches([movement], getState().invoices, getState().suppliers)[0]?.suggestion?.invoiceId,
      amount: movement.amount,
      date: movement.date,
      method: movement.rail === "TARJETA" ? "TARJETA" : "BANCO",
      account: location?.batch.account || movement.account,
    };
  }).filter((match) => match.invoiceId);
  const applied = applyBankReconciliation(statements, matches);
  toast(`${applied.length} movimientos conciliados y contabilizados.`, applied.length ? "ok" : "warn");
  render();
}

function openBankManualPost(movementId) {
  const location = bankMovementLocation(movementId);
  if (!location || location.movement.status !== "PENDIENTE") {
    toast("Ese movimiento ya está clasificado.", "warn");
    return;
  }
  const { batch, movement } = location;
  const isInflow = Number(movement.amount) > 0;
  const codes = ["400", "410", "430", "440", "465", "472", "475", "476", "600", "602", "621", "622", "623", "624", "625", "626", "627", "628", "629", "640", "642", "662", "700", "705", "740", "778"];
  const defaultCode = isInflow ? "700" : "629";
  openModal(
    `<div class="modal-head">
      <div><h2>Contabilizar movimiento sin documento</h2><p>Elige la cuenta que explica este cobro o pago.</p></div>
      <button class="icon-btn" data-modal-cancel aria-label="Cerrar">${icon("x")}</button>
    </div>
    <div class="modal-body">
      <div class="bank-review-summary">
        <span>${fmtDate(movement.date)} · ${esc(bankRailLabel(movement.rail))} · ${esc(batch.account)}</span>
        <strong>${fmtEUR(movement.amount)}</strong>
        <small>${esc(movement.description)}</small>
      </div>
      <label class="field" style="margin-top:14px">
        <span>Cuenta de contrapartida</span>
        <select id="bankPostAccount">
          ${codes.map((code) => `<option value="${code}" ${code === defaultCode ? "selected" : ""}>${code} · ${esc(pgcNombre(code) || `Cuenta ${code}`)}</option>`).join("")}
        </select>
      </label>
      <p class="muted" style="margin-top:10px">Se creará un asiento equilibrado contra bancos (572). Revisa que la cuenta elegida corresponda al movimiento.</p>
    </div>
    <div class="modal-foot">
      <button class="btn primary" data-action="bank-manual-post-save" data-id="${esc(movement.id)}">${icon("check")}<span>Guardar asiento</span></button>
      <button class="btn ghost" data-modal-cancel>Cancelar</button>
    </div>`,
    { narrow: true, onMount: (wrap) => wrap.querySelectorAll("[data-modal-cancel]").forEach((el) => el.addEventListener("click", () => closeModal())) }
  );
}

function saveBankManualPost(movementId) {
  const location = bankMovementLocation(movementId);
  const accountInput = document.getElementById("bankPostAccount");
  const counterAccount = String(accountInput?.value || "");
  if (!location || location.movement.status !== "PENDIENTE" || !/^\d{3,6}$/.test(counterAccount) || counterAccount === "572") {
    toast("No se puede contabilizar este movimiento. Vuelve a revisarlo.", "warn");
    return;
  }
  const { movement } = location;
  const amount = round2(Math.abs(Number(movement.amount) || 0));
  if (!amount) {
    toast("El importe del movimiento no es válido.", "warn");
    return;
  }
  const id = `bank-${movement.id}`;
  const isInflow = Number(movement.amount) > 0;
  const entry = {
    id,
    date: movement.date,
    concept: `Extracto bancario · ${String(movement.description || "").slice(0, 160)}`,
    ref: String(movement.reference || "").slice(0, 120),
    lineas: isInflow
      ? [{ cuenta: "572", debe: amount, haber: 0 }, { cuenta: counterAccount, debe: 0, haber: amount }]
      : [{ cuenta: counterAccount, debe: amount, haber: 0 }, { cuenta: "572", debe: 0, haber: amount }],
  };
  const statements = copyBankStatements();
  const savedMovement = bankMovementLocation(movementId, statements)?.movement;
  if (!savedMovement || savedMovement.status !== "PENDIENTE") return;
  savedMovement.status = "CONTABILIZADO";
  savedMovement.accountCode = counterAccount;
  savedMovement.postedEntryId = id;
  savedMovement.postedAt = new Date().toISOString();
  const entries = accManuales().filter((item) => item.id !== id);
  entries.push(entry);
  updateSettings({ asientosManuales: entries, bankStatements: statements });
  closeModal();
  toast("Movimiento contabilizado en el diario.", "ok");
  render();
}

async function downloadBankOriginal(batchId) {
  try {
    const original = await originalOf(batchId);
    if (!original?.blob) {
      toast("No se guardó una copia del extracto en este navegador.", "warn");
      return;
    }
    const url = URL.createObjectURL(original.blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = original.name || "extracto";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) {
    toast(err?.message || "No he podido recuperar el archivo original.", "warn");
  }
}

async function deleteBankBatch(batchId) {
  const batch = bankStatementBatches().find((item) => item.id === batchId);
  if (!batch) return;
  if (batch.movements.some((movement) => movement.status !== "PENDIENTE")) {
    toast("Primero deshaz la conciliación o el asiento de sus movimientos.", "warn");
    return;
  }
  const ok = await confirmDialog({
    title: "Eliminar este extracto",
    message: `Se eliminarán ${batch.movements.length} movimientos pendientes y el archivo original guardado en este navegador.`,
    confirm: "Eliminar extracto",
  });
  if (!ok) return;
  const statements = copyBankStatements().filter((item) => item.id !== batchId);
  updateSettings({ bankStatements: statements });
  if (!saveWorked()) {
    toast("No se pudo guardar el cambio. El extracto sigue en la aplicación.", "bad");
    return;
  }
  await dropOriginal(batchId).catch(() => {});
  toast("Extracto eliminado.", "ok");
  render();
}

/** Vencimientos: lo que te deben y lo que debes, con los días de retraso. */
function accVencimientosHtml() {
  const inf = vencimientos(accDocs(), { today: todayISO() });

  const diasTexto = (dias) => {
    if (dias == null) return "sin fecha";
    if (dias > 0) return `${dias} ${dias === 1 ? "día vencido" : "días vencido"}`;
    if (dias === 0) return "vence hoy";
    const falta = -dias;
    return `faltan ${falta} ${falta === 1 ? "día" : "días"}`;
  };

  const bloque = (cesta, titulo, nota) => `
  <section class="card">
    <div class="card-head">
      <div><h2>${titulo}</h2><p>${nota}</p></div>
    </div>
    <div class="acc-kpis">
      ${accKpi("Vencido", fmtEUR(cesta.vencido), "para reclamar ya")}
      ${accKpi("Vence hoy", fmtEUR(cesta.hoy), "cuenta del día")}
      ${accKpi("Esta semana", fmtEUR(cesta.semana), "próximos 7 días")}
      ${accKpi("Este mes", fmtEUR(cesta.mes), "próximos 30 días")}
    </div>
    ${
      cesta.items.length
        ? `<div class="table-wrap">
      <table class="data acc-table">
        <thead><tr><th>Vence</th><th>Tercero</th><th>Documento</th><th class="num">Importe</th><th>Cuánto lleva</th><th></th></tr></thead>
        <tbody>
          ${cesta.items
            .map(
              (i) => `<tr class="acc-row">
            <td class="num">${i.due ? fmtDate(i.due) : "—"}${i.estimada ? " *" : ""}</td>
            <td>${esc(i.party || "—")}</td>
            <td>${esc(i.number || i.concept || "—")}</td>
            <td class="num">${fmtEUR(i.amount)}</td>
            <td>${esc(diasTexto(i.dias))}</td>
            <td class="num"><button class="btn sm ghost" data-action="edit-invoice" data-id="${esc(i.id)}">Abrir</button></td>
          </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>`
        : `<div class="empty"><p>Nada pendiente: todo está cobrado o pagado.</p></div>`
    }
  </section>`;

  return `
  <div class="acc-toolbar-note">
    <span class="tag kind">Hoy es ${fmtDate(inf.hoy)}</span>
    <span class="muted">Total pendiente: ${fmtEUR(inf.cobros.total)} por cobrar y ${fmtEUR(inf.pagos.total)} por pagar (${fmtEUR(inf.neto)} a favor).</span>
    <div class="spacer"></div>
    <button class="btn sm ghost" data-action="export-acc-csv">${icon("download")}<span>Exportar CSV</span></button>
  </div>
  ${bloque(inf.cobros, "Pendiente de cobro", "Lo que te deben, de lo más atrasado a lo que vence más tarde.")}
  ${bloque(inf.pagos, "Pendiente de pago", "Lo que debes tú, en el mismo orden.")}
  <p class="acc-note">La fecha que manda es la de vencimiento del documento. Los que llevan un asterisco no la tienen apuntada y se usa la del propio documento, así que su plazo es aproximado.</p>`;
}

function accBody() {
  try {
    const entries = asientosContables();
    const mayor = libroMayor(entries);
    if (ui.conta.tab === "igic") return accIgicHtml();
    if (ui.conta.tab === "tesoreria") return accTesoreriaHtml();
    if (ui.conta.tab === "conciliacion") return accConciliacionHtml();
    if (ui.conta.tab === "vencimientos") return accVencimientosHtml();
    if (ui.conta.tab === "cuentas") return accCuentasHtml(accPlan(), mayor);
    if (ui.conta.tab === "mayor") return accMayorHtml(mayor);
    if (ui.conta.tab === "sumas") return accSumasHtml(balanceSumasYSaldos(mayor));
    if (ui.conta.tab === "balance") {
      const pyg = cuentaResultados(mayor);
      return accBalanceHtml(balanceSituacion(mayor, pyg.resultado), pyg.resultado);
    }
    if (ui.conta.tab === "resultados") return accResultadosHtml(cuentaResultados(mayor));
    return accDiarioHtml(entries);
  } catch (err) {
    // Mejor decir qué pasa que dejar el hueco en blanco.
    console.error("Contabilidad:", err);
    const msg = err && err.message ? err.message : String(err);
    return `
    <section class="card">
      <div class="card-head">
        <div>
          <h2>No he podido calcular la contabilidad</h2>
          <p>${esc(msg)}</p>
        </div>
      </div>
    </section>`;
  }
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
    ${accKpiStrip()}
    <div id="accBody">${accBody()}</div>
  </div>`;
}

/** Los datos de partida y el traslado opcional desde el cierre anterior. */
function accAperturaModal() {
  const s = getState().settings || {};
  const year = activeExerciseYear();
  const apertura = accApertura(year);
  const esTrasladada = Array.isArray(apertura?.lines);
  const esManual = !!apertura && !esTrasladada;
  openModal(
    `<div class="modal-head">
       <div>
         <h2>Apertura del ejercicio ${year}</h2>
         <p>La apertura se fecha el primer día del ejercicio y no repite ingresos ni gastos.</p>
       </div>
       <button class="icon-btn" data-modal-cancel aria-label="Cerrar">${icon("x")}</button>
     </div>
     <div class="modal-body">
        <div class="notice info">
          ${esTrasladada
            ? `Esta apertura contiene ${apertura.lines.length} ${apertura.lines.length === 1 ? "saldo" : "saldos"} por cuenta${apertura.sourceYear ? ` trasladados desde el cierre de ${apertura.sourceYear}` : ""}. Si vuelves a traer los saldos, se sustituirá.`
            : "Puedes traer los saldos de cierre del ejercicio anterior. La acción sustituirá cualquier apertura guardada para este ejercicio."}
        </div>
        <p><button class="btn" data-action="acc-opening-carryforward">${icon("download")}<span>Traer saldos de ${year - 1}</span></button></p>
       <div class="form-grid">
         <label class="field">
           <span>Capital social (€)</span>
           <input id="accCapital" type="text" inputmode="decimal" value="${esManual && apertura.capital ? esc(String(apertura.capital)) : ""}" placeholder="3.000,00">
         </label>
         <label class="field">
           <span>Dinero en el banco y en caja (€)</span>
           <input id="accCash" type="text" inputmode="decimal" value="${esManual && apertura.tesoreria ? esc(String(apertura.tesoreria)) : ""}" placeholder="12.000,00">
         </label>
         <label class="field">
           <span>Fecha de apertura</span>
           <input id="accDate" type="date" value="${esc(apertura?.fecha || `${year}-01-01`)}">
         </label>
       </div>
        <p class="muted">La apertura manual solo permite indicar capital y tesorería. Para copiar el cierre completo, usa «Traer saldos»; al guardar los campos manuales se sustituirá el traslado de este ejercicio.</p>
     </div>
     <div class="modal-foot">
       <button class="btn primary" data-action="acc-save-apertura">${icon("check")}<span>Guardar</span></button>
       <button class="btn ghost" data-modal-cancel>Cancelar</button>
     </div>`,
    {
      narrow: true,
      onMount: (wrap) => {
        wrap.querySelectorAll("[data-modal-cancel]").forEach((el) => {
          el.addEventListener("click", () => closeModal());
        });
      },
    }
  );
}

/** Guarda los datos de partida y vuelve a pintar. */
function saveApertura() {
  const cap = document.getElementById("accCapital");
  const cash = document.getElementById("accCash");
  const day = document.getElementById("accDate");
  const capital = accNum(cap ? cap.value : "");
  const tesoreria = accNum(cash ? cash.value : "");
  const year = activeExerciseYear();
  const fecha = String((day && day.value) || "").slice(0, 10) || `${year}-01-01`;
  const settings = getState().settings || {};
  const aperturasPorEjercicio = { ...(settings.aperturasPorEjercicio || {}) };
  delete aperturasPorEjercicio[String(year)];
  updateSettings({
    openingCapital: capital,
    openingCash: tesoreria,
    openingDate: fecha,
    aperturasPorEjercicio,
  });
  closeModal();
  toast(
    capital || tesoreria
      ? `Datos de partida guardados: ${fmtEUR(capital)} de capital y ${fmtEUR(tesoreria)} en bancos.`
      : "Datos de partida borrados.",
    "ok"
  );
  render();
}

/** Genera la apertura actual con los saldos de cierre del año anterior. */
function trasladarCierreApertura() {
  const year = activeExerciseYear();
  const sourceYear = year - 1;
  setPlanDeCuentas(accPlan());
  const entries = asientosDe(accDocs(), {
    from: `${sourceYear}-01-01`,
    to: `${sourceYear}-12-31`,
    apertura: accApertura(sourceYear),
    manuales: accManuales(),
  });
  const lines = aperturaDesdeCierre(entries);
  if (!lines.length) {
    toast(`No hay saldos que trasladar desde el ejercicio ${sourceYear}.`, "warn");
    return;
  }

  const settings = getState().settings || {};
  const aperturasPorEjercicio = { ...(settings.aperturasPorEjercicio || {}) };
  aperturasPorEjercicio[String(year)] = {
    sourceYear,
    lines,
  };
  updateSettings({ aperturasPorEjercicio });
  closeModal();
  toast(`Apertura de ${year} creada con los saldos de cierre de ${sourceYear}.`, "ok");
  render();
}

/** Descarga en CSV lo que se está viendo. */
function exportAccCsv() {
  const w = contaWindow();
  const tab = ui.conta.tab;
  if (tab === "conciliacion") {
    const movements = bankStatementBatches().flatMap((batch) =>
      batch.movements
        .filter((movement) => (!w.from || movement.date >= w.from) && (!w.to || movement.date <= w.to))
        .map((movement) => [
          movement.date,
          batch.account,
          batch.name,
          movement.description,
          movement.reference,
          bankRailLabel(movement.rail),
          fmtNum(movement.amount),
          movement.status,
          movement.matchedInvoiceId || "",
          movement.accountCode || "",
        ])
    );
    if (!movements.length) {
      toast("No hay movimientos del extracto que exportar en este periodo.", "warn");
      return;
    }
    const headers = ["Fecha", "Cuenta", "Extracto", "Concepto", "Referencia", "Medio", "Importe", "Estado", "Documento relacionado", "Cuenta contable"];
    downloadText(`conciliacion-bancaria-${todayISO()}.csv`, "\ufeff" + [headers, ...movements].map((row) => row.map(csvCell).join(";")).join("\r\n"));
    toast("Conciliación bancaria exportada.", "ok");
    return;
  }
  // IGIC, caja y vencimientos salen de los documentos, no de los asientos.
  const gestion = tab === "igic" || tab === "tesoreria" || tab === "vencimientos";
  const entries = gestion ? [] : asientosContables(w);
  if (!gestion && !entries.length) {
    toast("No hay asientos en ese periodo.", "warn");
    return;
  }
  const mayor = libroMayor(entries);
  let headers = [];
  let rows = [];
  if (tab === "mayor") {
    headers = ["Cuenta", "Nombre", "Fecha", "Asiento", "Concepto", "Debe", "Haber", "Saldo"];
    for (const r of mayor) {
      for (const m of r.moves) {
        rows.push([r.code, r.name, m.date, m.number, m.concept, fmtNum(m.debit), fmtNum(m.credit), fmtNum(m.running)]);
      }
    }
  } else if (tab === "sumas") {
    const sumas = balanceSumasYSaldos(mayor);
    headers = ["Cuenta", "Nombre", "Suma debe", "Suma haber", "Saldo deudor", "Saldo acreedor"];
    rows = sumas.rows.map((r) => [r.code, r.name, fmtNum(r.debit), fmtNum(r.credit), fmtNum(r.deudor), fmtNum(r.acreedor)]);
    rows.push(["", "TOTALES", fmtNum(sumas.totals.debit), fmtNum(sumas.totals.credit), fmtNum(sumas.totals.deudor), fmtNum(sumas.totals.acreedor)]);
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
  } else if (tab === "igic") {
    const inf = igicPorTrimestre(accDocs(), { year: Number(ui.conta.year) || new Date().getFullYear() });
    headers = ["Trimestre", "Base repercutida", "IGIC repercutido", "Base soportada", "IGIC soportado", "Resultado"];
    rows = inf.rows.map((r) => [r.label, fmtNum(r.baseRep), fmtNum(r.cuotaRep), fmtNum(r.baseSop), fmtNum(r.cuotaSop), fmtNum(r.diferencia)]);
    rows.push([
      "Total del año",
      fmtNum(inf.totals.baseRep),
      fmtNum(inf.totals.cuotaRep),
      fmtNum(inf.totals.baseSop),
      fmtNum(inf.totals.cuotaSop),
      fmtNum(inf.totals.diferencia),
    ]);
  } else if (tab === "tesoreria") {
    const ajustes = getState().settings || {};
    const inf = tesoreriaPorCuenta(accDocs(), {
      cashName: ajustes.cashAccount || "Caja general",
      from: w.from,
      to: w.to,
    });
    headers = ["Cuenta", "Medio", "Fecha", "Documento", "Tercero", "Importe", "Saldo"];
    for (const c of inf.cuentas) {
      const medio = c.method === "CAJA" ? "Caja (570)" : c.method === "TARJETA" ? "Tarjeta (572)" : c.method === "BANCO" ? "Banco (572)" : "Sin medio de pago";
      for (const m of c.movimientos) {
        rows.push([c.name, medio, m.date, m.number, m.party, fmtNum(m.amount), fmtNum(m.running)]);
      }
      rows.push([c.name, medio, "", "", "TOTAL de la cuenta", fmtNum(round2(c.entradas - c.salidas)), fmtNum(c.saldo)]);
    }
    rows.push(["", "", "", "", "Entradas del periodo", fmtNum(inf.totales.entradas), ""]);
    rows.push(["", "", "", "", "Salidas del periodo", fmtNum(inf.totales.salidas), ""]);
    rows.push(["", "", "", "", "Saldo del periodo", fmtNum(inf.totales.saldo), ""]);
  } else if (tab === "vencimientos") {
    const inf = vencimientos(accDocs(), { today: todayISO() });
    const situacion = (dias) =>
      dias == null ? "sin fecha" : dias > 0 ? "vencido" : dias === 0 ? "vence hoy" : "por vencer";
    headers = ["Sentido", "Vence", "Tercero", "Documento", "Concepto", "Importe", "Días de retraso", "Situación"];
    for (const i of inf.cobros.items) {
      rows.push(["Cobro", i.due, i.party, i.number, i.concept, fmtNum(i.amount), i.dias == null ? "" : String(i.dias), situacion(i.dias)]);
    }
    for (const i of inf.pagos.items) {
      rows.push(["Pago", i.due, i.party, i.number, i.concept, fmtNum(i.amount), i.dias == null ? "" : String(i.dias), situacion(i.dias)]);
    }
    rows.push(["", "", "", "", "Total por cobrar", fmtNum(inf.cobros.total), "", ""]);
    rows.push(["", "", "", "", "Total por pagar", fmtNum(inf.pagos.total), "", ""]);
    rows.push(["", "", "", "", "Diferencia a favor", fmtNum(inf.neto), "", ""]);
  } else {
    headers = ["Fecha", "Asiento", "Cuenta", "Nombre", "Concepto", "Debe", "Haber"];
    for (const e of entries) {
      for (const l of e.lines) {
        rows.push([e.date, e.number, l.account, l.name, e.concept, fmtNum(l.debit), fmtNum(l.credit)]);
      }
    }
  }
  const csv = "\ufeff" + [headers.map(csvCell).join(";"), ...rows.map((r) => r.map(csvCell).join(";"))].join("\r\n");
  downloadText(`contabilidad-${tab}-${w.from || "todo"}-${todayISO()}.csv`, csv);
  const nombres = {
    sumas: "balance de sumas y saldos",
    igic: "resumen del IGIC",
    tesoreria: "caja y bancos",
    vencimientos: "vencimientos",
  };
  toast(`Descargado el ${nombres[tab] || tab}.`);
}

/* ------------------------------------------------------------------ */
/* Contabilidad: asientos a mano, plan de cuentas e informes en PDF    */
/* ------------------------------------------------------------------ */

/** El asiento que se está escribiendo en la ventana (vacío si es uno nuevo). */
let accEditing = "";
/** El código que se está editando en la ventana de cuentas. */
let accOwnEditing = "";

/** Una fila del asiento: cuenta, debe y haber. */
function accEntryRow(line, i) {
  const l = line || {};
  return `<div class="acc-line" data-acc-row>
    <input class="mono" data-acc-code type="text" inputmode="numeric" maxlength="6" value="${esc(String(l.cuenta || ""))}" placeholder="430001" list="accCuentas" aria-label="Cuenta de la línea ${i + 1}">
    <input data-acc-debe type="text" inputmode="decimal" value="${l.debe ? esc(String(l.debe)) : ""}" placeholder="0,00" aria-label="Debe de la línea ${i + 1}">
    <input data-acc-haber type="text" inputmode="decimal" value="${l.haber ? esc(String(l.haber)) : ""}" placeholder="0,00" aria-label="Haber de la línea ${i + 1}">
  </div>`;
}

/** Suma el debe y el haber de lo que hay escrito en la ventana. */
function accEntrySum() {
  const box = document.getElementById("accLines");
  const out = document.getElementById("accEntrySum");
  if (!box || !out) return;
  let debe = 0;
  let haber = 0;
  box.querySelectorAll("[data-acc-row]").forEach((row) => {
    const d = row.querySelector("[data-acc-debe]");
    const h = row.querySelector("[data-acc-haber]");
    debe = round2(debe + accNum(d ? d.value : ""));
    haber = round2(haber + accNum(h ? h.value : ""));
  });
  const diff = round2(debe - haber);
  const igual = Math.abs(diff) < 0.005;
  out.className = `acc-sum ${igual ? "is-ok" : "is-bad"}`;
  out.textContent = igual
    ? `Debe ${fmtEUR(debe)} · Haber ${fmtEUR(haber)} · cuadra`
    : `Debe ${fmtEUR(debe)} · Haber ${fmtEUR(haber)} · descuadra ${fmtEUR(Math.abs(diff))}`;
}

/** Añade una línea en blanco al asiento que se está escribiendo. */
function accEntryAddRow() {
  const box = document.getElementById("accLines");
  if (!box) return;
  const n = box.querySelectorAll("[data-acc-row]").length;
  box.insertAdjacentHTML("beforeend", accEntryRow(null, n));
  box.querySelectorAll("[data-acc-row]").forEach((row) => {
    row.querySelectorAll("input").forEach((el) => {
      el.removeEventListener("input", accEntrySum);
      el.addEventListener("input", accEntrySum);
    });
  });
  accEntrySum();
}

/** La ventana para escribir o corregir un asiento a mano. */
function accEntryModal(existing) {
  const e = existing || null;
  const exerciseYear = activeExerciseYear();
  const entryDate = String((e && e.date) || "").slice(0, 10);
  const dateBounds = !e || entryDate.startsWith(`${exerciseYear}-`)
    ? `min="${exerciseYear}-01-01" max="${exerciseYear}-12-31"`
    : "";
  accEditing = e ? String(e.id) : "";
  const lineas = e && Array.isArray(e.lineas) ? e.lineas : [];
  const filas = [];
  const n = Math.max(4, lineas.length + 2);
  for (let i = 0; i < n; i += 1) filas.push(accEntryRow(lineas[i] || null, i));

  // Las cuentas que se pueden escribir, con su nombre, para no sabérselas de memoria.
  const plan = accPlan();
  const opciones = [];
  for (const c of plan.subcuentas) opciones.push(`<option value="${esc(c.code)}">${esc(c.name)}</option>`);
  for (const c of plan.propias) opciones.push(`<option value="${esc(c.code)}">${esc(c.name)}</option>`);
  for (const code of ["100", "113", "129", "400", "430", "472", "477", "570", "572", "600", "621", "628", "629", "700", "705", "740"]) {
    opciones.push(`<option value="${code}">${esc(pgcNombre(code) || `Cuenta ${code}`)}</option>`);
  }

  openModal(
    `<div class="modal-head">
       <div>
         <h2>${e ? "Corregir el asiento" : "Asiento a mano"}</h2>
         <p>Escribe la fecha, qué es y las cuentas. Lo que va al debe y lo que va al haber tiene que sumar lo mismo.</p>
       </div>
       <button class="icon-btn" data-modal-cancel aria-label="Cerrar">${icon("x")}</button>
     </div>
     <div class="modal-body acc-entry-form">
       <div class="form-grid">
         <label class="field">
           <span>Fecha</span>
           <input id="accEntryDate" type="date" ${dateBounds} value="${esc(entryDate || (Number(todayISO().slice(0, 4)) === exerciseYear ? todayISO() : ""))}" required>
           <span class="hint">Los asientos nuevos deben llevar una fecha del ejercicio ${exerciseYear}.</span>
         </label>
         <label class="field">
           <span>Número o referencia (si quieres)</span>
           <input id="accEntryRef" type="text" value="${esc(String((e && e.ref) || ""))}" placeholder="Factura 25/014">
         </label>
         <label class="field acc-wide">
           <span>Concepto</span>
           <input id="accEntryConcept" type="text" value="${esc(String((e && e.concept) || ""))}" placeholder="Amortización del invernadero">
         </label>
       </div>
       <div class="acc-lines" id="accLines">
         <div class="acc-line acc-line-head"><span>Cuenta</span><span>Debe</span><span>Haber</span></div>
         ${filas.join("")}
       </div>
       <div class="acc-lines-foot">
         <button class="btn sm ghost" data-action="acc-entry-row">${icon("plus")}<span>Añadir una línea</span></button>
         <div class="spacer"></div>
         <span class="acc-sum" id="accEntrySum"></span>
       </div>
       <datalist id="accCuentas">${opciones.join("")}</datalist>
       <p class="muted">Puedes escribir la cuenta con 3 cifras (430) o con 6 (430001), que es la subcuenta de un cliente. Las líneas que dejes en blanco no se guardan.</p>
     </div>
     <div class="modal-foot">
       <button class="btn primary" data-action="acc-entry-save">${icon("check")}<span>Guardar el asiento</span></button>
       <button class="btn ghost" data-modal-cancel>Cancelar</button>
     </div>`,
    {
      onMount: (wrap) => {
        wrap.querySelectorAll("[data-modal-cancel]").forEach((el) => {
          el.addEventListener("click", () => closeModal());
        });
        wrap.querySelectorAll("#accLines input").forEach((el) => el.addEventListener("input", accEntrySum));
        accEntrySum();
      },
    }
  );
}

/** Guarda el asiento que está abierto en la ventana. */
function saveAccEntry() {
  const day = document.getElementById("accEntryDate");
  const ref = document.getElementById("accEntryRef");
  const concept = document.getElementById("accEntryConcept");
  const box = document.getElementById("accLines");
  const dia = String((day && day.value) || "").slice(0, 10) || todayISO();
  const existing = accManuales().find((entry) => String(entry.id) === String(accEditing));
  if (!existing || dia !== String(existing.date || "").slice(0, 10)) {
    const dateError = exerciseDateError(dia);
    if (dateError) {
      toast(dateError, "bad", 6500);
      day?.focus();
      return;
    }
  }

  const lineas = [];
  if (box) {
    box.querySelectorAll("[data-acc-row]").forEach((row) => {
      const c = row.querySelector("[data-acc-code]");
      const d = row.querySelector("[data-acc-debe]");
      const h = row.querySelector("[data-acc-haber]");
      const code = String((c && c.value) || "").trim();
      const debe = accNum(d ? d.value : "");
      const haber = accNum(h ? h.value : "");
      if (!/^\d{3,6}$/.test(code)) return;
      if (!debe && !haber) return;
      lineas.push({ cuenta: code, debe, haber });
    });
  }

  if (lineas.length < 2) {
    toast("Un asiento necesita al menos dos líneas: una al debe y otra al haber.", "warn");
    return;
  }
  const debe = round2(lineas.reduce((s, l) => s + l.debe, 0));
  const haber = round2(lineas.reduce((s, l) => s + l.haber, 0));
  if (Math.abs(round2(debe - haber)) > 0.005) {
    toast(`El debe (${fmtEUR(debe)}) y el haber (${fmtEUR(haber)}) tienen que sumar lo mismo.`, "warn");
    return;
  }

  const asiento = {
    id: accEditing || `man-${Date.now().toString(36)}`,
    date: dia,
    concept: String((concept && concept.value) || "").trim() || "Asiento manual",
    ref: String((ref && ref.value) || "").trim(),
    lineas,
  };
  const lista = accManuales().filter((a) => String(a.id) !== String(asiento.id));
  lista.push(asiento);
  lista.sort((a, b) => (String(a.date) === String(b.date) ? 0 : String(a.date) < String(b.date) ? -1 : 1));
  saveAccManuales(lista);
  accEditing = "";
  closeModal();
  toast(`Asiento guardado: ${asiento.concept}.`, "ok");
  render();
}

/** Borra un asiento escrito a mano. */
async function deleteAccEntry(id) {
  const a = accManuales().find((x) => String(x.id) === String(id));
  if (!a) return;
  const ok = await confirmDialog({
    title: "Borrar el asiento",
    message: `Se borrará el asiento «${a.concept}» del ${fmtDate(a.date)}. Los documentos no se tocan.`,
    confirm: "Sí, borrar el asiento",
    danger: true,
  });
  if (!ok) return;
  const statements = copyBankStatements();
  for (const batch of statements) {
    for (const movement of batch.movements) {
      if (String(movement.postedEntryId || "") !== String(id)) continue;
      movement.status = "PENDIENTE";
      delete movement.accountCode;
      delete movement.postedEntryId;
      delete movement.postedAt;
    }
  }
  updateSettings({
    asientosManuales: accManuales().filter((x) => String(x.id) !== String(id)),
    bankStatements: statements,
  });
  toast("Asiento borrado.");
  render();
}

/** Descarga el balance de situación en PDF. */
function accPdfBalance() {
  try {
    const w = contaWindow();
    const mayor = libroMayor(asientosContables(w));
    const out = informeBalancePdf(mayor, { from: w.from, to: w.to });
    downloadBytes(out.filename, out.bytes, "application/pdf");
    toast(`Descargado ${out.filename}.`, "ok");
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    toast(`No he podido hacer el PDF: ${msg}`, "warn");
  }
}

/** Descarga la cuenta de pérdidas y ganancias en PDF. */
function accPdfResultados() {
  try {
    const w = contaWindow();
    const mayor = libroMayor(asientosContables(w));
    const out = informeResultadosPdf(mayor, { from: w.from, to: w.to });
    downloadBytes(out.filename, out.bytes, "application/pdf");
    toast(`Descargado ${out.filename}.`, "ok");
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    toast(`No he podido hacer el PDF: ${msg}`, "warn");
  }
}

/** Pestaña «Cuentas»: el plan con una subcuenta por cliente y proveedor. */
function accCuentasHtml(plan, mayor) {
  const saldo = new Map();
  const usadas = [];
  for (const r of mayor || []) {
    const debe = round2((r.moves || []).reduce((n, m) => n + m.debit, 0));
    const haber = round2((r.moves || []).reduce((n, m) => n + m.credit, 0));
    saldo.set(String(r.code), round2(debe - haber));
    if (r.code) usadas.push(r);
  }
  const s = getState().settings || {};
  const guardadas = Array.isArray(s.subcuentas) ? s.subcuentas.length : 0;
  const subCodes = new Set(plan.subcuentas.map((c) => c.code));

  const fila = (c) => {
    const v = saldo.get(String(c.code)) || 0;
    return `<tr>
      <td class="mono">${esc(c.code)}</td>
      <td>${esc(c.name)}</td>
      <td class="num">${v ? fmtEUR(Math.abs(v)) : '<span class="muted">—</span>'}</td>
      <td class="num">${v > 0 ? "deudor" : v < 0 ? "acreedor" : ""}</td>
      <td class="num"><button class="btn xs ghost" data-action="acc-own-edit" data-id="${esc(c.code)}">${icon("edit")}<span>Cambiar</span></button></td>
    </tr>`;
  };

  const deTerceros = plan.subcuentas.map(fila).join("");
  const otras = usadas.filter((r) => !subCodes.has(String(r.code))).map(fila).join("");

  return `
  <section class="card">
    <div class="card-head">
      <div>
        <h2>Plan de cuentas</h2>
        <p>${plan.subcuentas.length} ${plan.subcuentas.length === 1 ? "subcuenta" : "subcuentas"} de clientes, proveedores y trabajadores · se abren solas, con el primer número libre de su cuenta</p>
      </div>
      <div class="spacer"></div>
      ${guardadas < plan.subcuentas.length ? `<button class="btn sm ghost" data-action="acc-plan-fix">${icon("check")}<span>Guardar las ${plan.subcuentas.length} subcuentas</span></button>` : ""}
      <button class="btn sm" data-action="acc-own-new">${icon("plus")}<span>Nueva cuenta</span></button>
    </div>
    <div class="table-wrap">
      <table class="data acc-table">
        <thead><tr><th>Cuenta</th><th>Nombre</th><th class="num">Saldo</th><th class="num"></th><th class="num"></th></tr></thead>
        <tbody>${deTerceros || '<tr><td colspan="5" class="muted">Todavía no hay ningún cliente, proveedor ni trabajador con documentos.</td></tr>'}</tbody>
      </table>
    </div>
    <p class="muted acc-note">Cada cliente y cada proveedor tiene su propia subcuenta de 6 cifras (430001, 400002…) y cada trabajador la suya de 465 (465001, 465002…); el asiento usa la suya y solo la suya, y el balance y las cuentas anuales los suman en «Clientes», «Proveedores» y «Remuneraciones pendientes de pago».</p>
  </section>
  <section class="card">
    <div class="card-head">
      <div>
        <h2>Otras cuentas usadas</h2>
        <p>Las que salen en el mayor del periodo elegido</p>
      </div>
    </div>
    <div class="table-wrap">
      <table class="data acc-table">
        <thead><tr><th>Cuenta</th><th>Nombre</th><th class="num">Saldo</th><th class="num"></th><th class="num"></th></tr></thead>
        <tbody>${otras || '<tr><td colspan="5" class="muted">Ninguna todavía.</td></tr>'}</tbody>
      </table>
    </div>
  </section>`;
}

/** Ventana para abrir o renombrar una cuenta. */
function accOwnModal(existing) {
  const c = existing || null;
  accOwnEditing = c ? String(c.code) : "";
  const plan = accPlan();
  const sugerida = c ? c.code : siguienteSubcuenta("430", plan.subcuentas.map((x) => x.code));
  openModal(
    `<div class="modal-head">
       <div>
         <h2>${c ? "Cambiar la cuenta" : "Nueva cuenta"}</h2>
         <p>Tres cifras es una cuenta del PGC y seis es una subcuenta de un tercero (un cliente, un proveedor, un banco).</p>
       </div>
       <button class="icon-btn" data-modal-cancel aria-label="Cerrar">${icon("x")}</button>
     </div>
     <div class="modal-body">
       <div class="form-grid">
         <label class="field">
           <span>Número</span>
           <input id="accOwnCode" class="mono" type="text" inputmode="numeric" maxlength="6" value="${esc(sugerida)}">
         </label>
         <label class="field acc-wide">
           <span>Nombre</span>
           <input id="accOwnName" type="text" value="${esc(c ? c.name : "")}" placeholder="Clientes · Hermanos Pérez">
         </label>
       </div>
       <p class="muted">${c ? "Se cambia el nombre; los asientos no se tocan." : "El número que te propongo es el primero libre."}</p>
     </div>
     <div class="modal-foot">
       <button class="btn primary" data-action="acc-own-save">${icon("check")}<span>Guardar</span></button>
       <button class="btn ghost" data-modal-cancel>Cancelar</button>
     </div>`,
    {
      narrow: true,
      onMount: (wrap) => {
        wrap.querySelectorAll("[data-modal-cancel]").forEach((el) => {
          el.addEventListener("click", () => closeModal());
        });
      },
    }
  );
}

/** Guarda la cuenta de la ventana (y de paso fija las subcuentas que se abrieron solas). */
function saveAccOwn() {
  const code = String((document.getElementById("accOwnCode") || {}).value || "").trim();
  const name = String((document.getElementById("accOwnName") || {}).value || "").trim();
  if (!/^\d{3,6}$/.test(code)) {
    toast("El número de la cuenta tiene que tener de 3 a 6 cifras (por ejemplo 629 o 430002).", "warn");
    return;
  }
  if (!name) {
    toast("Ponle un nombre a la cuenta.", "warn");
    return;
  }
  const antes = accOwnEditing;
  const s = getState().settings || {};
  const propias = (Array.isArray(s.cuentasPropias) ? s.cuentasPropias : []).filter(
    (x) => String((x && x.code) || "") !== String(antes || code) && String((x && x.code) || "") !== code
  );
  const subcuentas = (Array.isArray(s.subcuentas) ? s.subcuentas : []).filter(
    (x) => String((x && x.code) || "") !== String(antes || code) && String((x && x.code) || "") !== code
  );
  if (code.length === 6) {
    // La clave es el nombre del tercero, sin el «Clientes ·» de delante, para que
    // el asiento de sus documentos encuentre esta subcuenta.
    const limpio = name.replace(/^(Clientes|Proveedores|Bancos|Deudores|Acreedores)\s*·\s*/i, "");
    subcuentas.push({ code, name, key: claveDeTercero({ party: limpio }), cuenta: code.slice(0, 3) });
  } else {
    propias.push({ code, name });
  }

  // Las subcuentas que se habían abierto solas se guardan también, para que no cambien.
  const plan = accPlan();
  const yaHay = new Set(subcuentas.map((x) => String(x.code)));
  for (const x of plan.subcuentas) {
    if (!yaHay.has(String(x.code))) subcuentas.push(x);
  }
  updateSettings({ cuentasPropias: propias, subcuentas });
  accOwnEditing = "";
  closeModal();
  toast(`Cuenta ${code} guardada: ${name}.`, "ok");
  render();
}


