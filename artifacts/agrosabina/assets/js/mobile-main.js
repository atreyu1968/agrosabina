import { startRegistration } from "@simplewebauthn/browser";
import { renderMobileScreen } from "./mobile-view.js";
import { mountAuthScreen } from "./auth-screen.js";
import { keepOriginal, originalOf, forgetOriginal } from "./files.js";
import { invoiceDirection } from "./model.js";
import { flush, getState, initStore, storageInfo, subscribe, updateSettings } from "./store.js";
import { STATUS, uid } from "./util.js";

const root = document.getElementById("mobile-app-root");
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const MAX_VISIBLE_UPLOADS = 8;

let currentUser = null;
let filter = "ALL";
let activeTab = "pending";
let busy = false;
let message = "";
let storageAlert = "";
let uploadSyncAlert = "";
let passkeyCount = 0;
let passkeySupported = false;
let passkeySetupOpen = false;
let passkeyBusy = false;

const PASSKEY_API = {
  list: "/api/auth/passkeys",
  registerOptions: "/api/auth/passkeys/register/options",
  registerVerify: "/api/auth/passkeys/register/verify",
};

function supportsPasskeys() {
  return Boolean(window.isSecureContext && window.PublicKeyCredential && navigator.credentials);
}

async function passkeyRequest(url, options = {}) {
  const response = await fetch(url, {
    credentials: "include",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  if (!response.ok) throw new Error(payload.error || payload.message || "No se pudo completar la operación.");
  return payload;
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function mobileInvoices() {
  const state = getState();
  const suppliers = Array.isArray(state.suppliers) ? state.suppliers : [];
  return (Array.isArray(state.invoices) ? state.invoices : [])
    .filter((invoice) => invoice.status !== STATUS.PAID)
    .filter((invoice) => ["FACTURA", "LIQUIDACION"].includes(String(invoice.kind || "FACTURA").toUpperCase()))
    .map((invoice) => ({
      id: invoice.id,
      party: invoice.supplierName || invoice.customerName || invoice.contactName ||
        suppliers.find((item) => item.id === invoice.supplierId)?.name || "Tercero sin indicar",
      direction: invoiceDirection(invoice),
      number: invoice.number || "",
      issueDate: invoice.issueDate || "",
      total: Number(invoice.total) || 0,
      year: /^\d{4}/.test(String(invoice.issueDate || "")) ? Number(String(invoice.issueDate).slice(0, 4)) : null,
    }))
    .filter((invoice) => filter === "ALL" ||
      (filter === "IN" && invoice.direction === "INGRESO") ||
      (filter === "OUT" && invoice.direction === "GASTO"))
    .sort((a, b) => String(a.issueDate || "9999").localeCompare(String(b.issueDate || "9999")));
}

function getStorageAlert() {
  const info = storageInfo();
  if (!info.shared) return "No se ha conectado con el almacenamiento compartido. Comprueba la conexión antes de subir documentos.";
  if (info.sharedConflict) return "Hay datos locales distintos pendientes de resolver en la aplicación principal. No subas documentos hasta elegir la versión correcta.";
  if (info.sharedStale) return "Otra persona guardó cambios. Recarga esta página antes de continuar.";
  if (info.sharedSaveError) return info.sharedSaveError;
  return uploadSyncAlert;
}

function render() {
  if (!root) return;
  const state = getState();
  const inbox = Array.isArray(state.settings?.mobileDocumentInbox) ? state.settings.mobileDocumentInbox : [];
  storageAlert = getStorageAlert();
  root.innerHTML = renderMobileScreen({
    user: currentUser,
    invoices: mobileInvoices(),
    filter,
    activeTab,
    inbox: [...inbox].sort((a, b) => String(b.savedAt || "").localeCompare(String(a.savedAt || ""))).slice(0, MAX_VISIBLE_UPLOADS),
    busy,
    message,
    storageAlert,
    passkeyCount,
    passkeySupported,
    passkeySetupOpen,
    passkeyBusy,
  });
}

async function registerPasskey(password) {
  if (passkeyBusy || !passkeySupported) return;
  passkeyBusy = true;
  message = "";
  render();
  try {
    const setup = await passkeyRequest(PASSKEY_API.registerOptions, {
      method: "POST",
      body: JSON.stringify({ password }),
    });
    const credential = await startRegistration({ optionsJSON: setup.options });
    const result = await passkeyRequest(PASSKEY_API.registerVerify, {
      method: "POST",
      body: JSON.stringify({ flowId: setup.flowId, credential }),
    });
    passkeyCount = Number(result.count) || passkeyCount + 1;
    message = "Acceso del móvil activado. La próxima vez podrás entrar con la huella o el desbloqueo del dispositivo.";
    passkeySetupOpen = false;
  } catch (error) {
    message = error instanceof DOMException && error.name === "NotAllowedError"
      ? "No se completó la configuración. Puedes volver a intentarlo cuando quieras."
      : error instanceof Error
        ? error.message
        : "No se pudo activar el acceso del móvil.";
    passkeySetupOpen = false;
  } finally {
    passkeyBusy = false;
    render();
  }
}

async function loadPasskeyCount() {
  try {
    const result = await passkeyRequest(PASSKEY_API.list);
    passkeyCount = Number(result.count) || 0;
  } catch {
    passkeyCount = 0;
  }
}

function sha256Hex(buffer) {
  return crypto.subtle.digest("SHA-256", buffer).then((digest) =>
    Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
  );
}

async function uploadSelectedFiles(fileList) {
  const selected = Array.from(fileList || []);
  if (!selected.length) return;
  if (busy) return;
  const info = storageInfo();
  if (!info.shared || info.sharedConflict || info.sharedStale || info.sharedSaveError) {
    message = "No se ha confirmado la sincronización. Recarga la página y vuelve a intentarlo.";
    render();
    return;
  }

  busy = true;
  message = `Preparando ${selected.length === 1 ? "el documento" : `${selected.length} documentos`}…`;
  render();
  let uploaded = 0;
  const notices = [];

  for (const file of selected) {
    if (file.size > MAX_FILE_SIZE) {
      notices.push(`${file.name}: supera el máximo de 50 MB.`);
      continue;
    }
    const supportedType = file.type.startsWith("image/") || file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    if (!supportedType) {
      notices.push(`${file.name}: solo se admiten imágenes o PDF.`);
      continue;
    }

    let id = "";
    try {
      const sha256 = await sha256Hex(await file.arrayBuffer());
      const state = getState();
      const queue = Array.isArray(state.settings?.mobileDocumentInbox) ? state.settings.mobileDocumentInbox : [];
      if (queue.some((item) => item.sha256 === sha256)) {
        notices.push(`${file.name}: ya se había subido; no se ha duplicado.`);
        continue;
      }

      id = uid("movil");
      const savedAt = new Date().toISOString();
      await keepOriginal(id, file, {
        name: file.name,
        type: file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/octet-stream"),
        sha256,
        segment: "bandeja-movil",
      });

      const latestQueue = Array.isArray(getState().settings?.mobileDocumentInbox)
        ? getState().settings.mobileDocumentInbox
        : [];
      const nextQueue = [{
        id,
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size,
        sha256,
        savedAt,
        status: "pendiente",
        source: "movil",
      }, ...latestQueue];
      if (!updateSettings({ mobileDocumentInbox: nextQueue })) {
        await forgetOriginal(id).catch(() => {});
        throw new Error("El documento no pudo añadirse a la bandeja compartida.");
      }
      const synchronized = await flush();
      uploaded += 1;
      if (!synchronized) {
        uploadSyncAlert = "El original se guardó, pero la bandeja no se pudo sincronizar. No lo vuelvas a subir; recarga y revisa Documentos.";
        notices.push(`${file.name}: guardado, pendiente de confirmar la sincronización.`);
      } else {
        uploadSyncAlert = "";
        notices.push(`${file.name}: guardado para revisar.`);
      }
    } catch (error) {
      if (id) await forgetOriginal(id).catch(() => {});
      notices.push(`${file.name}: ${error instanceof Error ? error.message : "no se pudo guardar."}`);
    }
  }

  busy = false;
  message = notices.length
    ? notices.join(" ")
    : uploaded
      ? `${uploaded} documento${uploaded === 1 ? "" : "s"} guardado${uploaded === 1 ? "" : "s"} para revisar.`
      : "";
  render();
}

async function openOriginalInNewTab(id) {
  const tab = window.open("about:blank", "_blank");
  if (tab) tab.opener = null;
  try {
    const original = await originalOf(id);
    if (!original?.blob) throw new Error("No se encontró el original en el almacén compartido.");
    const url = URL.createObjectURL(original.blob);
    if (tab) tab.location.replace(url);
    else {
      URL.revokeObjectURL(url);
      throw new Error("El navegador ha bloqueado la pestaña. Permite abrir ventanas para ver el documento.");
    }
    window.setTimeout(() => URL.revokeObjectURL(url), 10 * 60 * 1000);
  } catch (error) {
    if (tab && !tab.closed) tab.close();
    message = error instanceof Error ? error.message : "No se pudo abrir el original.";
    render();
  }
}

async function logout() {
  const button = root?.querySelector('[data-mobile-action="logout"]');
  if (button) button.disabled = true;
  try {
    const response = await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    if (!response.ok) throw new Error("No se pudo cerrar la sesión.");
    window.location.reload();
  } catch (error) {
    message = error instanceof Error ? error.message : "No se pudo cerrar la sesión.";
    render();
  }
}

function wireInteractions() {
  root?.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const tabButton = target?.closest("[data-mobile-tab]");
    if (tabButton) {
      const nextTab = tabButton.dataset.mobileTab || "pending";
      if (["pending", "upload", "review", "account"].includes(nextTab)) {
        activeTab = nextTab;
        render();
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
      return;
    }
    const filterButton = target?.closest("[data-mobile-filter]");
    if (filterButton) {
      filter = filterButton.dataset.mobileFilter || "ALL";
      render();
      return;
    }
    const actionButton = target?.closest("[data-mobile-action]");
    if (!actionButton) return;
    const action = actionButton.dataset.mobileAction;
    if (action === "logout") void logout();
    else if (action === "open-passkey-setup" && passkeySupported) {
      passkeySetupOpen = true;
      message = "";
      render();
      window.requestAnimationFrame(() => root.querySelector("#mobile-passkey-password")?.focus());
    }
    else if (action === "close-passkey-setup" && !passkeyBusy) {
      passkeySetupOpen = false;
      render();
    }
    else if (action === "take-photo") root.querySelector("#mobile-camera-file")?.click();
    else if (action === "pick-files") root.querySelector("#mobile-picker-file")?.click();
    else if (action === "open-original") void openOriginalInNewTab(actionButton.dataset.mobileId || "");
    else if (action === "reload") window.location.reload();
  });

  root?.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || form.dataset.mobileForm !== "passkey") return;
    event.preventDefault();
    if (!form.reportValidity()) return;
    const password = new FormData(form).get("password");
    void registerPasskey(typeof password === "string" ? password : "");
  });

  root?.addEventListener("change", (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !["mobile-camera-file", "mobile-picker-file"].includes(input.id)) return;
    const selected = Array.from(input.files || []);
    input.value = "";
    void uploadSelectedFiles(selected);
  });

  window.addEventListener("agrosabina:session-expired", () => window.location.reload());
  window.addEventListener("agrosabina:shared-stale", () => render());
  window.addEventListener("agrosabina:shared-conflict", () => render());
  window.addEventListener("agrosabina:shared-save-error", () => render());
  window.addEventListener("pagehide", () => { void flush(); });
}

async function registerPwa() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const base = new URL(import.meta.env.BASE_URL, document.baseURI);
    await navigator.serviceWorker.register(new URL("service-worker.js", base), {
      scope: base.pathname,
    });
  } catch (error) {
    console.warn("No se pudo preparar el modo instalable:", error);
  }
}

async function boot() {
  if (!root) return;
  wireInteractions();
  void registerPwa();

  const authRoot = document.createElement("div");
  authRoot.id = "agrosabina-auth-root";
  document.body.append(authRoot);
  passkeySupported = supportsPasskeys();
  currentUser = await new Promise((resolve) => mountAuthScreen(authRoot, resolve, { mobile: true }));
  authRoot.remove();
  window.agrosabinaAuthUser = currentUser || null;
  window.agrosabinaSharedStorage = true;

  try {
    await loadPasskeyCount();
    await initStore();
    render();
    subscribe(render);
    window.__appBooted = true;
  } catch (error) {
    root.innerHTML = `<main class="mobile-error" role="alert"><h1>No se pudieron cargar los datos</h1><p>${escapeHTML(error instanceof Error ? error.message : "Comprueba la conexión con el servidor y vuelve a intentarlo.")}</p><button type="button" data-mobile-action="reload">Volver a intentar</button></main>`;
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => { void boot(); }, { once: true });
} else {
  void boot();
}
