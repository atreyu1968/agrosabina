/*
 * Arranque: enrutador por hash, eventos globales y avisos iniciales.
 */

import { flush, getState, initStore, save, storageInfo, subscribe } from "./store.js";
import { escapeKeyCloses, toast } from "./dom.js";
import * as views from "./views.js";

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

// La sección se llamaba «facturas»: los enlaces antiguos (#/facturas) siguen valiendo.
const ROUTE_ALIASES = { facturas: "compras", archivo: "documentos", documentos: "documentos" };

function routeFromHash() {
  const raw = String(location.hash || "").replace(/^#\/?/, "").split("?")[0];
  const name = ROUTE_ALIASES[raw] || raw;
  return ROUTES.includes(name) ? name : "resumen";
}

function storageWorks() {
  try {
    const key = "__probe__";
    localStorage.setItem(key, "1");
    localStorage.removeItem(key);
    return true;
  } catch (_) {
    return false;
  }
}

async function boot() {
  window.__appBooted = true; // el aviso de «no arranca» de index.html ya no hace falta

  views.ui.route = routeFromHash();
  views.renderLoading(); // mientras se abre la base de datos

  // El menú puede cambiar de sección, pero ninguna edición se permite hasta
  // tener un estado consistente (SQLite o la copia local).
  let dbReady = false;
  let loadingMessage;
  wireGlobalEvents();

  // El plazo solo cambia el aviso: nunca libera la edición ni abandona una
  // inicialización que podría reemplazar los datos más tarde.
  const slowTimer = setTimeout(() => {
    loadingMessage = "La base de datos está tardando en abrir. Para proteger tus cambios, espera a que termine la carga.";
    views.renderLoading(loadingMessage);
  }, 9000);
  try {
    await initStore();
    dbReady = true;
  } catch (err) {
    console.error("No se pudo arrancar el almacén de datos:", err);
    loadingMessage = "No se han podido cargar tus datos. La edición sigue bloqueada para protegerlos. Recarga la página para reintentarlo.";
    views.renderLoading(loadingMessage);
    return;
  } finally {
    clearTimeout(slowTimer);
  }

  views.render();
  escapeKeyCloses();
  views.wireDropzone();

  const info = storageInfo();
  if (info.engine === "local") {
    setTimeout(
      () =>
        toast(
          "No he podido abrir la base de datos SQLite en este navegador, así que guardo los datos de la forma anterior. Todo funciona igual.",
          "bad",
          9000
        ),
      1200
    );
  }

  function wireGlobalEvents() {
    const sidebar = document.querySelector(".sidebar");
    const navToggle = document.getElementById("mobileNavToggle");
    const closeMobileNav = () => {
      sidebar?.classList.remove("nav-open");
      navToggle?.setAttribute("aria-expanded", "false");
    };

    navToggle?.addEventListener("click", () => {
      const isOpen = sidebar?.classList.toggle("nav-open") ?? false;
      navToggle.setAttribute("aria-expanded", String(isOpen));
    });

    document.getElementById("mainNavigation")?.addEventListener("click", (ev) => {
      if (ev.target instanceof Element && ev.target.closest("a[data-route]")) {
        closeMobileNav();
      }
    });

    window.addEventListener("hashchange", () => {
      // El enlace «Saltar al contenido» usa #view: no es una sección, no se repinta.
      if (location.hash && !location.hash.startsWith("#/")) return;
      closeMobileNav();
      views.ui.route = routeFromHash();
      window.scrollTo(0, 0);
      if (!dbReady) {
        views.renderLoading(loadingMessage);
        return;
      }
      views.render();
    });

  document.addEventListener("click", (ev) => {
    if (!(ev.target instanceof Element)) return;

    const actionEl = ev.target.closest("[data-action]");
    if (actionEl) {
      ev.preventDefault();
      if (!dbReady) {
        // Sin los datos cargados no se toca nada: se trabajaría sobre una lista vacía.
        toast("Un momento: estoy abriendo tus datos.", "info", 2500);
        return;
      }
      views.onAction(actionEl.dataset.action, actionEl);
      return;
    }

    const filterBtn = ev.target.closest("[data-filter-status]");
    if (filterBtn) {
      ev.preventDefault();
      if (!dbReady) return;
      views.onFilterButton(filterBtn);
      return;
    }

    const dirBtn = ev.target.closest("[data-filter-direction]");
    if (dirBtn) {
      ev.preventDefault();
      if (!dbReady) return;
      views.onDirectionButton(dirBtn);
    }
  });

    document.addEventListener("input", (ev) => {
      if (dbReady) views.onInput(ev);
    });
    document.addEventListener("change", (ev) => {
      if (dbReady) views.onChange(ev);
    });
  }

  const filePicker = document.getElementById("filePicker");
  if (filePicker) {
    filePicker.addEventListener("change", () => {
      if (filePicker.files && filePicker.files.length) views.queueFiles(filePicker.files);
      filePicker.value = "";
    });
  }

  const bankStatementPicker = document.getElementById("bankStatementPicker");
  if (bankStatementPicker) {
    bankStatementPicker.addEventListener("change", () => {
      const file = bankStatementPicker.files && bankStatementPicker.files[0];
      if (file) views.startBankStatementImport(file);
      bankStatementPicker.value = "";
    });
  }

  const cameraPicker = document.getElementById("cameraPicker");
  if (cameraPicker) {
    cameraPicker.addEventListener("change", () => {
      if (cameraPicker.files && cameraPicker.files.length) views.queueFiles(cameraPicker.files);
      cameraPicker.value = "";
    });
  }

  // Cualquier cambio en los datos vuelve a pintar la pantalla.
  subscribe(() => views.render());

  if (!storageWorks() && info.engine !== "sqlite") {
    setTimeout(
      () =>
        toast(
          "Este navegador no me deja guardar datos (¿ventana privada?). Puedes usarlo, pero al cerrar se perderá todo.",
          "bad",
          9000
        ),
      900
    );
  }

  const state = getState();
  if (dbReady && !state.invoices.length && !state.suppliers.length) {
    // Primer arranque de verdad (la base de datos abrió y está vacía): guardo los
    // ajustes por defecto. Si la base no abrió, no se guarda nada, para no pisar los datos.
    console.info("Listo. Sube un documento para empezar.");
    save();
  }

  // Al cerrar la pestaña, termina de escribir la base de datos.
  window.addEventListener("beforeunload", () => {
    flush().catch(() => {});
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
