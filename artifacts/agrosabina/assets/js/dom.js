/* Piezas pequeñas de interfaz: avisos, ventanas y botones. */

import { esc } from "./util.js";

export const ICON = {
  folder:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 7.2A1.7 1.7 0 0 1 5.2 5.5h3.9l1.9 2.4h7.8a1.7 1.7 0 0 1 1.7 1.7v8.7a1.7 1.7 0 0 1-1.7 1.7H5.2a1.7 1.7 0 0 1-1.7-1.7z"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="6.4"/><path d="m16 16 4 4"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4"/><path d="m7.5 8.5 4.5-4.5 4.5 4.5"/><path d="M4 16v3a1.6 1.6 0 0 0 1.6 1.6h12.8A1.6 1.6 0 0 0 20 19v-3"/></svg>',
  camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5h3l1.4-2h8.2l1.4 2h3v11h-17z"/><circle cx="12" cy="13.4" r="3.4"/></svg>',
  text: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 6h14"/><path d="M5 11h14"/><path d="M5 16h8"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4l10-10-4-4L4 16z"/><path d="m14.5 5.5 4 4"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M9 7V4.5h6V7"/><path d="M6.5 7 7.6 20h8.8L17.5 7"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.6 21 20H3z"/><path d="M12 9.5v4.6"/><path d="M12 17.2h.01"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><path d="M12 7.8h.01"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v12"/><path d="m7.5 11.5 4.5 4.5 4.5-4.5"/><path d="M4 20h16"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 3h7l4.5 4.4V21h-11.5z"/><path d="M13.5 3v4.5H18"/></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m5 18 5.5-5.5L15 17l2-2 2.5 2.5"/></svg>',
  wallet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7.5h13.5A2.5 2.5 0 0 1 20 10v7.5H6.5A2.5 2.5 0 0 1 4 15z"/><path d="M4 7.5 6 4h11v3.5"/><path d="M16 13h1.5"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 4v2M12 18v2M4.5 12h2M17.5 12h2M6.7 6.7l1.5 1.5M15.8 15.8l1.5 1.5M17.3 6.7l-1.5 1.5M8.2 15.8l-1.5 1.5"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h13"/><path d="m13 7 5 5-5 5"/></svg>',
  sparkle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5 13.7 9l5.5 1.7-5.5 1.7L12 18l-1.7-5.6L4.8 10.7 10.3 9z"/></svg>',
  store: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5V20h16V9.5"/><path d="M3 9.5 5.5 4h13L21 9.5z"/><path d="M9.5 20v-5.5h5V20"/></svg>',
  mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="m3.8 6.6 8.2 6 8.2-6"/></svg>',
  leaf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20 4c-9 0-14 4-14 10a6 6 0 0 0 6 6c6 0 8-6 8-16z"/><path d="M6 20c1.5-4 4-7 8-9"/></svg>',
  arrowDown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v13"/><path d="m6.5 12.5 5.5 5.5 5.5-5.5"/></svg>',
  arrowUp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V6"/><path d="m6.5 11.5 5.5-5.5 5.5 5.5"/></svg>',
};

export function icon(name, cls = "") {
  const svg = ICON[name] || "";
  return cls ? svg.replace("<svg ", `<svg class="${cls}" `) : svg;
}

/* ------------------------------------------------------------------ */
/* Avisos                                                             */
/* ------------------------------------------------------------------ */

export function toast(message, kind = "ok", ms = 3600) {
  const host = document.getElementById("toasts");
  if (!host) return;
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.innerHTML = `${icon(kind === "bad" ? "alert" : "check")}<span>${esc(message)}</span>`;
  host.appendChild(el);
  const kill = () => {
    el.classList.add("out");
    setTimeout(() => el.remove(), 260);
  };
  setTimeout(kill, ms);
  el.addEventListener("click", kill);
}

/* ------------------------------------------------------------------ */
/* Ventanas                                                           */
/* ------------------------------------------------------------------ */

let activeModal = null;

export function openModal(html, { narrow = false, onMount, onClose } = {}) {
  closeModal();
  const root = document.getElementById("modalRoot");
  const wrap = document.createElement("div");
  wrap.className = "modal";
  wrap.setAttribute("role", "dialog");
  wrap.setAttribute("aria-modal", "true");
  wrap.innerHTML = `<div class="modal-card${narrow ? " narrow" : ""}">${html}</div>`;

  wrap.addEventListener("mousedown", (ev) => {
    if (ev.target === wrap) {
      const cancel = wrap.querySelector("[data-modal-cancel]");
      if (cancel) cancel.click();
      else closeModal();
    }
  });

  root.appendChild(wrap);
  activeModal = { wrap, onClose };
  document.body.style.overflow = "hidden";

  const focusTarget = wrap.querySelector("[autofocus], input, select, textarea, button");
  if (focusTarget && typeof focusTarget.focus === "function") {
    setTimeout(() => focusTarget.focus({ preventScroll: true }), 40);
  }
  if (typeof onMount === "function") onMount(wrap);

  return wrap;
}

export function closeModal() {
  if (!activeModal) return;
  const { wrap, onClose } = activeModal;
  activeModal = null;
  document.body.style.overflow = "";
  wrap.remove();
  if (typeof onClose === "function") onClose();
}

export function modalIsOpen() {
  return !!activeModal;
}

/** Pregunta sí/no. Devuelve una promesa con true o false. */
export function confirmDialog({ title, message, confirm = "Sí, seguir", cancel = "Cancelar", danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    openModal(
      `<div class="modal-head">
         <div>
           <h2>${esc(title)}</h2>
           <p>${esc(message)}</p>
         </div>
         <button class="icon-btn" data-modal-cancel aria-label="Cerrar">${icon("x")}</button>
       </div>
       <div class="modal-foot">
         <button class="btn ${danger ? "danger" : "primary"}" data-confirm-yes>${esc(confirm)}</button>
         <button class="btn ghost" data-modal-cancel>${esc(cancel)}</button>
       </div>`,
      {
        narrow: true,
        onMount(wrap) {
          wrap.querySelector("[data-confirm-yes]").addEventListener("click", () => {
            answered = true;
            closeModal();
            resolve(true);
          });
          wrap.querySelectorAll("[data-modal-cancel]").forEach((b) =>
            b.addEventListener("click", () => {
              if (answered) return;
              answered = true;
              closeModal();
              resolve(false);
            })
          );
        },
        onClose() {
          if (!answered) resolve(false);
        },
      }
    );
  });
}

export function escapeKeyCloses() {
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape") return;
    if (!activeModal) return;
    const cancel = activeModal.wrap.querySelector("[data-modal-cancel]");
    if (cancel) cancel.click();
    else closeModal();
  });
}
