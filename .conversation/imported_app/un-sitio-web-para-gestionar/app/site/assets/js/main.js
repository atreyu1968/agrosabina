/*
 * Arranque: enrutador por hash, eventos globales y avisos iniciales.
 */

import { flush, getState, initStore, save, storageInfo, subscribe } from "./store.js";
import { escapeKeyCloses, toast } from "./dom.js";
import * as views from "./views.js";

const ROUTES = [
  "resumen",
  "ventas",
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

  // Las escuchas van antes que la base de datos: así el menú y los botones responden
  // desde el primer segundo, aunque SQLite tarde en abrir.
  let dbReady = false;
  wireGlobalEvents();

  // Abrir la base de datos SQLite y traer los datos, pero sin dejar la pantalla
  // esperando para siempre: si en 9 segundos no ha contestado, se sigue con la copia
  // guardada en el navegador y se avisa. Nunca se queda el programa en «Abriendo…».
  try {
    await Promise.race([
      initStore().then(() => {
        dbReady = true;
      }),
      new Promise((resolve) => setTimeout(resolve, 9000)),
    ]);
  } catch (err) {
    console.error("No se pudo arrancar el almacén de datos:", err);
  }

  views.render();
  if (!dbReady) {
    setTimeout(
      () =>
        toast(
          "La base de datos está tardando en abrir. Sigo con la copia que hay guardada en este navegador.",
          "bad",
          9000
        ),
      900
    );
  }
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
    window.addEventListener("hashchange", () => {
      // El enlace «Saltar al contenido» usa #view: no es una sección, no se repinta.
      if (location.hash && !location.hash.startsWith("#/")) return;
      views.ui.route = routeFromHash();
      window.scrollTo(0, 0);
      if (!dbReady) {
        views.renderLoading();
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
      views.onFilterButton(filterBtn);
      return;
    }

    const dirBtn = ev.target.closest("[data-filter-direction]");
    if (dirBtn) {
      ev.preventDefault();
      views.onDirectionButton(dirBtn);
    }
  });

    document.addEventListener("input", views.onInput);
    document.addEventListener("change", views.onChange);
  }

  const filePicker = document.getElementById("filePicker");
  if (filePicker) {
    filePicker.addEventListener("change", () => {
      if (filePicker.files && filePicker.files.length) views.queueFiles(filePicker.files);
      filePicker.value = "";
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
