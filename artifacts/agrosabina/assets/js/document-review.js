import { esc } from "./util.js";
import { importadoresDisponibles } from "./importers.js";
import { closeModal, openModal } from "./dom.js";
import { directionOf } from "./model.js";
import { documentPageImages } from "./read.js";

export const DOCUMENT_REVIEW_SPECS = Object.freeze({
  FACTURA: Object.freeze({
    title: "factura recibida",
    party: "Proveedor",
    number: "Número de factura",
    issueDate: "Fecha de factura",
    dueDate: "Vencimiento",
    total: "Total de la factura",
    description: "Revisa proveedor, fecha, desglose de IGIC e importe antes de guardar el gasto.",
  }),
  LIQUIDACION: Object.freeze({
    title: "liquidación de fruta",
    party: "Cliente o comprador",
    number: "Número de liquidación",
    issueDate: "Fecha de liquidación",
    dueDate: "Fecha prevista de cobro",
    total: "Líquido de la liquidación",
    description: "Es una venta e ingreso. Comprueba kilos, categorías, precio por kilo y descuentos.",
  }),
  SUBVENCION: Object.freeze({
    title: "subvención o ayuda",
    party: "Organismo concedente",
    number: "Referencia o expediente",
    issueDate: "Fecha de concesión",
    dueDate: "Fecha prevista de cobro",
    total: "Importe de la ayuda",
    description: "Es un ingreso. Comprueba el organismo, la referencia y el importe concedido.",
  }),
  COBRO: Object.freeze({
    title: "cobro o abono recibido",
    party: "Cliente o pagador",
    number: "Referencia del cobro",
    issueDate: "Fecha del cobro",
    dueDate: "Fecha del abono",
    total: "Importe cobrado",
    description: "Es un ingreso recibido. Comprueba quién paga, la fecha y el importe.",
  }),
  NOMINA: Object.freeze({
    title: "nómina",
    party: "Trabajador",
    number: "Referencia de la nómina",
    issueDate: "Fecha de la nómina",
    dueDate: "Fecha de pago",
    total: "Líquido a percibir",
    description: "Es un gasto laboral, no lleva IGIC. Revisa bruto, deducciones, líquido y trabajador.",
  }),
  OTRO: Object.freeze({
    title: "otro documento",
    party: "Emisor o tercero",
    number: "Número del documento",
    issueDate: "Fecha del documento",
    dueDate: "Vencimiento",
    total: "Importe total",
    description: "Tipo genérico: revisa el emisor, el concepto y el sentido antes de guardarlo.",
  }),
});

export function documentReviewSpec(kind) {
  const key = String(kind || "OTRO").toUpperCase();
  return DOCUMENT_REVIEW_SPECS[key] || DOCUMENT_REVIEW_SPECS.OTRO;
}

/** No data from another document's specialized block may reach storage. */
export function isolateDocumentKind(data, kind) {
  const result = { ...data, kind, direction: directionOf(kind) };
  if (kind !== "LIQUIDACION") {
    result.liquidacion = null;
    delete result.liquidacionRead;
  }
  if (kind !== "NOMINA") {
    result.nomina = null;
    delete result.nominaRead;
  } else {
    result.rate = 0;
    result.igic = 0;
    result.lines = [];
    result.category = "LABORALES";
  }
  if (kind === "SUBVENCION" || kind === "COBRO") {
    if (Number(data.igic) || data.lines?.some((line) => Number(line.rate))) {
      result.notes = [...(data.notes || []), "El documento elegido no es una factura: se ha descartado el IGIC detectado. Comprueba el tipo y el importe del original."];
    }
    result.base = data.total ?? data.base;
    result.igic = 0;
    result.rate = 0;
    result.lines = [];
  }
  return result;
}

export function originalPreviewHtml(job, url) {
  if (!url) return `<pre class="raw-text">${esc(job.text || job.preTexto || job.parsed?.rawText || "Original no disponible.")}</pre>`;
  const name = job.file?.name || "";
  const isImage = /^image\//.test(job.file?.type || "") || /\.(png|jpe?g|webp)$/i.test(name);
  return isImage
    ? `<img src="${esc(url)}" alt="Documento original: ${esc(name)}">`
    : `<div data-pdf-preview data-page="${Number(job.pages?.[0]) || 1}" aria-live="polite">Preparando la imagen del documento original…</div>`;
}

/** Render locally as images: native PDF embeds can be blank in an iframe/PWA. */
export function mountOriginalPreview(host, job) {
  let active = true;
  let version = 0;
  const pdfHost = host.querySelector("[data-pdf-preview]");
  const sourceImage = host.querySelector("img");
  const ready = !pdfHost
    ? sourceImage
      ? new Promise((resolve) => {
          if (sourceImage.complete) return resolve(sourceImage.naturalWidth > 0);
          sourceImage.addEventListener("load", () => resolve(true), { once: true });
          sourceImage.addEventListener("error", () => {
            if (active) host.textContent = "No se puede mostrar esta imagen. Comprueba que el archivo no está dañado.";
            resolve(false);
          }, { once: true });
        })
      : Promise.resolve(true)
    : renderPage(Number(job.pages?.[0]) || 1);

  async function renderPage(page) {
    const request = ++version;
    pdfHost.innerHTML = `<p role="status">Mostrando la página ${page} del original…</p>`;
    try {
      const rendered = await documentPageImages(job.file, {
        maxPages: 1, pages: [page], maxSide: 1500, quality: 0.92,
      });
      if (!active || request !== version) return false;
      if (!rendered.images?.length) throw new Error("No se han podido dibujar las páginas.");
      const pageList = job.pages?.length
        ? job.pages.filter((value) => Number.isInteger(value) && value >= 1 && value <= rendered.total)
        : Array.from({ length: rendered.total }, (_, index) => index + 1);
      const index = pageList.indexOf(page);
      pdfHost.innerHTML = `
        <div class="original-page-tools">
          <button type="button" class="btn xs" data-page-prev ${index <= 0 ? "disabled" : ""} aria-label="Página anterior">Anterior</button>
          <span>Página ${page} de ${rendered.total}</span>
          <button type="button" class="btn xs" data-page-next ${index >= pageList.length - 1 ? "disabled" : ""} aria-label="Página siguiente">Siguiente</button>
          <label>Zoom <select data-page-zoom aria-label="Zoom del original"><option value="100">Ajustar</option><option value="150">150 %</option><option value="200">200 %</option></select></label>
        </div>
        <div class="original-page-scroll"><img class="original-page-image" src="${esc(rendered.images[0])}" alt="Original, página ${page}"></div>`;
      pdfHost.querySelector("[data-page-prev]").addEventListener("click", () => renderPage(pageList[index - 1]));
      pdfHost.querySelector("[data-page-next]").addEventListener("click", () => renderPage(pageList[index + 1]));
      pdfHost.querySelector("[data-page-zoom]").addEventListener("change", (event) => {
        const image = pdfHost.querySelector("img");
        image.style.width = `${event.target.value}%`;
        image.style.maxWidth = "none";
      });
      return true;
    } catch (error) {
      if (active && request === version) {
        pdfHost.textContent = `No se puede mostrar el PDF: ${error?.message || "error al abrirlo"}. Comprueba el archivo o abre el original en otra pestaña.`;
      }
      return false;
    }
  }

  return { ready, dispose() { active = false; version++; } };
}

/** The list comes from the importer registry, not from a second hardcoded list. */
export function chooseDocumentImporter(job) {
  const url = job.file instanceof Blob ? URL.createObjectURL(job.file) : "";
  return new Promise((resolve) => {
    let choice = null;
    let preview = null;
    openModal(`
      <div class="modal-head">
        <div><h2>Ver original y elegir tipo</h2><p>${esc(job.name || job.file?.name || "Documento")}${job.pages?.length ? ` · páginas ${job.pages.join(", ")}` : ""}</p></div>
        <button class="icon-btn" data-modal-cancel aria-label="Cerrar">${"×"}</button>
      </div>
      <div class="modal-body">
        <p>Primero comprueba el documento. No se extraerán ni guardarán datos hasta que elijas un importador.</p>
        <div class="import-choice-layout">
          <div class="import-original">${originalPreviewHtml(job, url)}</div>
          <div class="stack">
            <label for="import-kind-choice">¿Qué tipo de documento es?</label>
            <select id="import-kind-choice">
              <option value="">Selecciona un tipo…</option>
              ${importadoresDisponibles().flatMap((importer) => importer.tipos.map((kind) =>
                `<option value="${esc(kind)}">${esc(importer.label)}</option>`,
              )).join("")}
            </select>
            <p class="subtle" id="import-kind-description">La elección es obligatoria y no se cambia automáticamente.</p>
            ${url ? `<a class="btn" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Abrir original en otra pestaña</a>` : ""}
          </div>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn primary" data-import-continue disabled>Continuar con este importador</button>
        <button class="btn ghost" data-modal-cancel>Descartar</button>
      </div>`, {
      onMount(wrap) {
        const select = wrap.querySelector("#import-kind-choice");
        const next = wrap.querySelector("[data-import-continue]");
        let previewReady = false;
        preview = mountOriginalPreview(wrap.querySelector(".import-original"), job);
        preview.ready.then((visible) => {
          previewReady = visible;
          next.disabled = !select.value || !previewReady;
        });
        select.addEventListener("change", () => {
          next.disabled = !select.value || !previewReady;
          wrap.querySelector("#import-kind-description").textContent = documentReviewSpec(select.value).description;
        });
        next.addEventListener("click", () => {
          if (!select.value || !previewReady) return;
          choice = select.value;
          closeModal();
        });
        wrap.querySelectorAll("[data-modal-cancel]").forEach((button) =>
          button.addEventListener("click", closeModal),
        );
      },
      onClose() {
        preview?.dispose();
        if (url) URL.revokeObjectURL(url);
        resolve(choice);
      },
    });
  });
}
