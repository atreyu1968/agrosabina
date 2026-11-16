const escapeHTML = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);

const icon = (name, className = "") => {
  const paths = {
    camera: '<path d="M4 7.5h3l1.4-2h7.2l1.4 2h3A1.5 1.5 0 0 1 21.5 9v9A1.5 1.5 0 0 1 20 19.5H4A1.5 1.5 0 0 1 2.5 18V9A1.5 1.5 0 0 1 4 7.5Z"/><circle cx="12" cy="13.5" r="3.5"/>',
    upload: '<path d="M12 15.5V3.8m-4.6 4.6L12 3.8l4.6 4.6"/><path d="M4 14.5v4a1.5 1.5 0 0 0 1.5 1.5h13a1.5 1.5 0 0 0 1.5-1.5v-4"/>',
    file: '<path d="M6 2.75h7l5 5V21H6a2 2 0 0 1-2-2V4.75a2 2 0 0 1 2-2Z"/><path d="M13 3v5h5M8 13h8M8 16.5h6"/>',
    arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
    logout: '<path d="M10 4H5.5A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20H10"/><path d="M14 8l4 4-4 4m4-4H9"/>',
    check: '<path d="m5 12.5 4.5 4L19 7"/>',
    receipt: '<path d="M6 3.5h12v17l-3-1.7-3 1.7-3-1.7-3 1.7v-17Z"/><path d="M9 8h6m-6 4h6m-6 4h3"/>',
  };
  return `<svg class="mobile-icon ${escapeHTML(className)}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.file}</svg>`;
};

const formatDate = (value) => {
  const raw = String(value ?? "");
  const parsed = /^\d{4}-\d{2}-\d{2}/.test(raw) ? new Date(`${raw.slice(0, 10)}T12:00:00`) : null;
  return parsed && !Number.isNaN(parsed.valueOf())
    ? new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", year: "numeric" }).format(parsed)
    : "Fecha no indicada";
};

const formatAmount = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(amount)
    : "Importe no indicado";
};

const formatSize = (value) => {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  return bytes < 1024 * 1024
    ? `${new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 }).format(bytes / 1024)} KB`
    : `${new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 }).format(bytes / (1024 * 1024))} MB`;
};

const formatSavedAt = (value) => {
  const date = new Date(String(value ?? ""));
  if (!value || Number.isNaN(date.valueOf())) return "";
  return new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short" }).format(date);
};

export function renderMobileScreen({
  user,
  invoices,
  filter,
  inbox,
  busy,
  message,
  storageAlert,
  passkeyCount = 0,
  passkeySupported = false,
  passkeySetupOpen = false,
  passkeyBusy = false,
} = {}) {
  const safeUser = user && typeof user === "object" ? user : {};
  const selectedFilter = ["ALL", "IN", "OUT"].includes(filter) ? filter : "ALL";
  const allInvoices = Array.isArray(invoices) ? invoices : [];
  const visibleInvoices = allInvoices.filter((invoice) =>
    selectedFilter === "ALL" ||
    (selectedFilter === "IN" && invoice?.direction === "INGRESO") ||
    (selectedFilter === "OUT" && invoice?.direction === "GASTO")
  );
  const pendingCount = allInvoices.length;
  const visibleInbox = Array.isArray(inbox) ? inbox : [];
  const isBusy = Boolean(busy);
  const filterButton = (key, label) =>
    `<button type="button" class="mobile-filter${selectedFilter === key ? " is-active" : ""}" data-mobile-filter="${key}" aria-pressed="${selectedFilter === key}">${label}</button>`;

  const invoiceMarkup = visibleInvoices.length
    ? `<ul class="mobile-invoice-list" aria-label="Facturas pendientes">${visibleInvoices.map((invoice) => {
      const incoming = invoice?.direction === "INGRESO";
      const party = escapeHTML(invoice?.party || "Tercero sin indicar");
      const number = escapeHTML(invoice?.number || "Sin número");
      const year = Number(invoice?.year);
      const yearLabel = Number.isInteger(year) && year > 0 ? year : "";
      return `<li class="mobile-invoice">
        <div class="mobile-invoice-mark${incoming ? " is-in" : " is-out"}">${icon("receipt")}</div>
        <div class="mobile-invoice-main">
          <p class="mobile-invoice-party">${party}</p>
          <p class="mobile-invoice-meta">${incoming ? "Ingreso pendiente" : "Gasto pendiente"} <span aria-hidden="true">·</span> ${number}</p>
          <p class="mobile-invoice-date">${escapeHTML(formatDate(invoice?.issueDate))}${yearLabel ? ` <span aria-hidden="true">·</span> Ejercicio ${escapeHTML(yearLabel)}` : ""}</p>
        </div>
        <p class="mobile-invoice-total">${escapeHTML(formatAmount(invoice?.total))}</p>
      </li>`;
    }).join("")}</ul>`
    : `<div class="mobile-empty" role="status">
        <span class="mobile-empty-mark">${icon("check")}</span>
        <h3>${pendingCount ? "No hay pendientes en este filtro" : "Todo al día"}</h3>
        <p>${pendingCount ? "Prueba con otro tipo para ver las facturas pendientes." : "Cuando haya facturas pendientes de cobro o pago, aparecerán aquí."}</p>
      </div>`;

  const inboxMarkup = visibleInbox.length
    ? `<ul class="mobile-file-list" aria-label="Documentos pendientes de revisión">${visibleInbox.map((file) => {
      const fileId = escapeHTML(file?.id ?? "");
      const fileName = escapeHTML(file?.name || "Documento sin nombre");
      const fileDetails = [formatSize(file?.size), formatSavedAt(file?.savedAt)].filter(Boolean).map(escapeHTML);
      const details = fileDetails.length ? fileDetails.join(" · ") : escapeHTML(file?.type || "Documento");
      return `<li class="mobile-file-row">
        <span class="mobile-file-icon">${icon("file")}</span>
        <span class="mobile-file-copy"><strong>${fileName}</strong><small>${details}</small></span>
        <button class="mobile-open-file" type="button" data-mobile-action="open-original" data-mobile-id="${fileId}" aria-label="Abrir ${fileName}">${icon("arrow")}</button>
      </li>`;
    }).join("")}</ul>`
    : `<div class="mobile-inbox-empty">
        <span class="mobile-empty-mark is-small">${icon("file")}</span>
        <p>Aún no hay documentos por revisar.</p>
        <small>Las fotos y archivos que añadas quedarán pendientes.</small>
      </div>`;

  const messageMarkup = message
    ? `<p class="mobile-message" role="status">${escapeHTML(message)}</p>`
    : "";
  const storageMarkup = storageAlert
    ? `<div class="mobile-storage-alert" role="alert"><strong>La sincronización necesita atención</strong><p>${escapeHTML(storageAlert)}</p></div>`
    : "";
  const displayName = safeUser.name || safeUser.email || "Cuenta Agrosabina";
  const registeredPasskeys = Number.isInteger(Number(passkeyCount)) ? Number(passkeyCount) : 0;
  const securityMarkup = passkeySupported
    ? `<section class="mobile-security" aria-labelledby="mobile-security-title">
        <div class="mobile-security-copy">
          <p class="mobile-section-kicker">Acceso rápido</p>
          <h2 id="mobile-security-title">Entra con tu móvil</h2>
          <p>Activa la huella, Face ID o el desbloqueo seguro del dispositivo. Tus datos biométricos permanecen en el teléfono.</p>
          ${registeredPasskeys ? `<small>${registeredPasskeys} acceso${registeredPasskeys === 1 ? "" : "s"} registrado${registeredPasskeys === 1 ? "" : "s"}</small>` : ""}
        </div>
        <button class="mobile-security-button" type="button" data-mobile-action="open-passkey-setup"${passkeyBusy ? " disabled" : ""}>
          ${passkeyBusy ? "Configurando…" : registeredPasskeys ? "Añadir otro dispositivo" : "Activar acceso biométrico"}
        </button>
      </section>`
    : `<section class="mobile-security is-unavailable" aria-label="Acceso biométrico">
        <strong>Acceso biométrico</strong>
        <p>Para activarlo, abre la aplicación desde HTTPS en un móvil compatible.</p>
      </section>`;
  const passkeyDialog = passkeySetupOpen
    ? `<dialog class="mobile-passkey-dialog" open aria-labelledby="mobile-passkey-dialog-title" aria-modal="true">
        <section class="mobile-passkey-panel">
          <p class="mobile-section-kicker">Confirmación de seguridad</p>
          <h2 id="mobile-passkey-dialog-title">Activa el acceso del móvil</h2>
          <p>Confirma tu contraseña para vincular este dispositivo. Después podrás entrar con la huella, Face ID o el desbloqueo seguro configurado.</p>
          <form data-mobile-form="passkey">
            <label for="mobile-passkey-password">Contraseña actual</label>
            <input id="mobile-passkey-password" name="password" type="password" autocomplete="current-password" required>
            <div class="mobile-passkey-actions">
              <button type="button" class="mobile-passkey-cancel" data-mobile-action="close-passkey-setup"${passkeyBusy ? " disabled" : ""}>Cancelar</button>
              <button type="submit" class="mobile-security-button"${passkeyBusy ? " disabled" : ""}>${passkeyBusy ? "Preparando…" : "Continuar"}</button>
            </div>
          </form>
        </section>
      </dialog>`
    : "";

  return `<div class="mobile-screen">
    <header class="mobile-header">
      <a class="mobile-brand" href="./" aria-label="Abrir Agrosabina completa">
        <img src="assets/img/agrosabina.png" width="429" height="179" alt="Agrosabina">
      </a>
      <div class="mobile-account">
        <span class="mobile-account-name">${escapeHTML(displayName)}</span>
        <button class="mobile-logout" type="button" data-mobile-action="logout" aria-label="Cerrar sesión">${icon("logout")}<span>Salir</span></button>
      </div>
    </header>

    <main class="mobile-content">
      <section class="mobile-intro" aria-labelledby="mobile-title">
        <p class="mobile-eyebrow"><span class="mobile-live-dot"></span> Vista de campo</p>
        <h1 id="mobile-title">Lo pendiente,<br><em>de un vistazo.</em></h1>
        <p class="mobile-intro-copy">Consulta facturas abiertas y guarda los documentos para revisarlos más tarde.</p>
      </section>

      ${securityMarkup}
      ${storageMarkup}
      ${messageMarkup}

      <section class="mobile-invoices" aria-labelledby="pending-title">
        <div class="mobile-section-heading">
          <div><p class="mobile-section-kicker">Seguimiento</p><h2 id="pending-title">Facturas pendientes</h2></div>
          <span class="mobile-count" aria-label="${pendingCount} facturas pendientes">${pendingCount}</span>
        </div>
        <div class="mobile-filters" role="group" aria-label="Filtrar facturas pendientes">
          ${filterButton("ALL", "Todas")}
          ${filterButton("IN", "Por cobrar")}
          ${filterButton("OUT", "Por pagar")}
        </div>
        ${invoiceMarkup}
      </section>

      <section class="mobile-capture" aria-labelledby="capture-title">
        <div class="mobile-section-heading capture-heading">
          <div><p class="mobile-section-kicker">Añadir documento</p><h2 id="capture-title">Guárdalo para revisarlo</h2></div>
          <span class="mobile-capture-stamp">Sin clasificar</span>
        </div>
        <p class="mobile-capture-copy">El archivo quedará pendiente de revisión. No se contabiliza automáticamente.</p>
        <div class="mobile-action-grid">
          <button class="mobile-action-button is-primary" type="button" data-mobile-action="take-photo"${isBusy ? " disabled" : ""}>
            <span class="mobile-action-icon">${icon("camera")}</span>
            <span><strong>Hacer una foto</strong><small>Usar la cámara</small></span>
            ${icon("arrow", "mobile-action-arrow")}
          </button>
          <button class="mobile-action-button" type="button" data-mobile-action="pick-files"${isBusy ? " disabled" : ""}>
            <span class="mobile-action-icon">${icon("upload")}</span>
            <span><strong>Elegir un archivo</strong><small>Imagen o PDF</small></span>
            ${icon("arrow", "mobile-action-arrow")}
          </button>
        </div>
        <input class="mobile-file-input" id="mobile-camera-file" type="file" accept="image/*" capture="environment" aria-label="Hacer una foto del documento"${isBusy ? " disabled" : ""}>
        <input class="mobile-file-input" id="mobile-picker-file" type="file" accept="image/*,application/pdf,.pdf" multiple aria-label="Elegir imágenes o archivos PDF"${isBusy ? " disabled" : ""}>
        ${isBusy ? '<p class="mobile-busy-note" role="status">Guardando el documento…</p>' : ""}
      </section>

      <section class="mobile-inbox" aria-labelledby="inbox-title">
        <div class="mobile-section-heading">
          <div><p class="mobile-section-kicker">Bandeja</p><h2 id="inbox-title">Por revisar</h2></div>
          <span class="mobile-inbox-count">${visibleInbox.length} ${visibleInbox.length === 1 ? "archivo" : "archivos"}</span>
        </div>
        ${inboxMarkup}
        <p class="mobile-review-note">Los documentos se conservan tal cual los añades. La revisión se hace después.</p>
      </section>
    </main>
    <footer class="mobile-footer"><span class="mobile-footer-mark"></span><span>Agrosabina · Compañera de campo</span></footer>
    ${passkeyDialog}
  </div>`;
}
