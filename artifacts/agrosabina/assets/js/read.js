/*
 * De un fichero (foto o PDF) a texto.
 * - PDF con texto incrustado: se lee directamente (rápido y exacto).
 * - PDF escaneado o foto: se dibuja en un lienzo y se pasa por OCR en español.
 * Las dos bibliotecas se cargan de un CDN la primera vez que hacen falta.
 */

import { parseInvoiceText } from "./parse.js";

const PDF_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.6.82/build/pdf.min.mjs";
const PDF_WORKER = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.6.82/build/pdf.worker.min.mjs";

const TESS_SCRIPT = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.0/dist/tesseract.min.js";
const TESS_CORE = "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.0.0";
const TESS_LANG = "https://tessdata.projectnaptha.com/4.0.0";

export const MAX_BYTES = 30 * 1024 * 1024;

let pdfjsPromise = null;
let tesseractPromise = null;
let workerPromise = null;

/* ------------------------------------------------------------------ */
/* Carga de las bibliotecas                                           */
/* ------------------------------------------------------------------ */

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-src="${src}"]`);
    if (existing) {
      if (existing.dataset.state === "ready") resolve();
      else if (existing.dataset.state === "error") reject(new Error("No se pudo cargar el lector."));
      else {
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", () => reject(new Error("No se pudo cargar el lector.")), { once: true });
      }
      return;
    }
    const el = document.createElement("script");
    el.src = src;
    el.async = true;
    el.dataset.src = src;
    el.addEventListener("load", () => {
      el.dataset.state = "ready";
      resolve();
    });
    el.addEventListener("error", () => {
      el.dataset.state = "error";
      reject(new Error("No se pudo cargar el lector."));
    });
    document.head.appendChild(el);
  });
}

async function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(/* @vite-ignore */ PDF_URL).then((mod) => {
      try {
        mod.GlobalWorkerOptions.workerSrc = PDF_WORKER;
      } catch (_) {
        /* sin worker también funciona, solo va más lento */
      }
      return mod;
    });
  }
  return pdfjsPromise;
}

async function getTesseract() {
  if (!tesseractPromise) {
    tesseractPromise = loadScriptOnce(TESS_SCRIPT).then(() => {
      if (!window.Tesseract) throw new Error("El lector de fotos no está disponible.");
      return window.Tesseract;
    });
  }
  return tesseractPromise;
}

/** Prepara (y reutiliza) el motor de OCR en español. */
async function getOcrWorker(onProgress) {
  const Tesseract = await getTesseract();
  if (!workerPromise) {
    workerPromise = Tesseract.createWorker("spa", 1, {
      workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.0/dist/worker.min.js",
      corePath: TESS_CORE,
      langPath: TESS_LANG,
      logger: (msg) => {
        if (window.__ocrListener && typeof msg === "object") {
          window.__ocrListener(msg.status || "", msg.progress || 0);
        }
      },
    }).catch((err) => {
      workerPromise = null;
      throw err;
    });
  }
  const worker = await workerPromise;
  window.__ocrListener = onProgress || null;
  try {
    await worker.setParameters({
      preserve_interword_spaces: "1",
      tessedit_pageseg_mode: "6",
    });
  } catch (_) {
    /* algunos parámetros no están en todas las versiones */
  }
  return worker;
}

export function disposeReader() {
  if (workerPromise) {
    workerPromise.then((w) => w.terminate()).catch(() => {});
    workerPromise = null;
  }
}

/* ------------------------------------------------------------------ */
/* PDF                                                                */
/* ------------------------------------------------------------------ */

export function itemsToLines(items) {
  const rows = [];
  // No redondear las coordenadas a casillas fijas: dos textos en la misma
  // línea pueden caer a ambos lados de una frontera y separar cifra y rótulo.
  for (const it of [...items].sort((a, b) => b.transform[5] - a.transform[5])) {
    const str = it.str;
    if (!str || !str.trim()) continue;
    const y = it.transform[5];
    let row = rows.find((candidate) => Math.abs(candidate.y - y) <= 2.5);
    if (!row) {
      row = { y, items: [] };
      rows.push(row);
    }
    row.items.push(it);
  }
  return rows.map((row) =>
    row.items
      .sort((a, b) => a.transform[4] - b.transform[4])
      .map((it) => it.str)
      .join(" ")
      .replace(/\s{2,}/g, " ")
      .trim()
  );
}

async function pdfTextLayer(file, onProgress) {
  const pdfjs = await getPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  const total = doc.numPages;
  // Antes se leían solo las 5 primeras páginas y lo que venía después se
  // perdía: en un recibo de varias hojas las deducciones y el líquido suelen
  // estar al final. Ahora se leen todas, con un tope alto por si alguien
  // suelta un libro entero.
  const MAX_PAGES = 40;
  const pages = Math.min(total, MAX_PAGES);
  const out = [];

  for (let p = 1; p <= pages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    out.push(itemsToLines(content.items).join("\n"));
    if (onProgress) onProgress("texto del PDF", Math.round((p / pages) * 100));
  }
  try {
    doc.destroy();
  } catch (_) {
    /* nada */
  }
  return { text: out.join("\n\n"), pages, total, textos: out };
}

async function pdfScanCanvases(file, maxPages = 12) {
  const pdfjs = await getPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  const total = doc.numPages;
  const pages = Math.min(total, maxPages);
  const out = [];
  for (let p = 1; p <= pages; p++) {
    const page = await doc.getPage(p);
    const base = page.getViewport({ scale: 1 });
    // Más resolución que antes: el texto pequeño de una factura sale más nítido.
    const targetWidth = 2100;
    const scale = Math.min(3.6, Math.max(1.2, targetWidth / base.width));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    out.push(canvas);
  }
  try {
    doc.destroy();
  } catch (_) {
    /* nada */
  }
  return { canvases: out, total };
}

/* ------------------------------------------------------------------ */
/* Imágenes                                                           */
/* ------------------------------------------------------------------ */

/** Escala, pasa a gris y estira el contraste: así el OCR acierta más. */
async function prepareImage(source) {
  const bitmap = await createImageBitmap(source);
  const maxSide = 2600;
  const minSide = 1600;
  const longest = Math.max(bitmap.width, bitmap.height);
  let scale = 1;
  if (longest > maxSide) scale = maxSide / longest;
  else if (longest < minSide) scale = Math.min(2.2, minSide / longest);

  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, w, h);
  if (bitmap.close) bitmap.close();

  const img = ctx.getImageData(0, 0, w, h);
  const px = img.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < px.length; i += 4) {
    const g = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0;
    px[i] = px[i + 1] = px[i + 2] = g;
    hist[g]++;
  }
  // Percentiles 2 % y 98 % para estirar el contraste sin quemar la tinta.
  const total = (w * h) || 1;
  let acc = 0;
  let lo = 0;
  let hi = 255;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc < total * 0.02) lo = v;
    if (acc < total * 0.98) hi = v;
  }
  if (hi - lo < 40) {
    lo = Math.max(0, lo - 20);
    hi = Math.min(255, hi + 20);
  }
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < px.length; i += 4) {
    let v = ((px[i] - lo) * 255) / span;
    v = v < 0 ? 0 : v > 255 ? 255 : v;
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/* ------------------------------------------------------------------ */
/* OCR                                                                */
/* ------------------------------------------------------------------ */

/*
 * Una sola pasada de OCR se equivoca a menudo con las facturas: importes en
 * dos columnas, fotos giradas, papel grisáceo. Así que se hacen varias
 * lecturas con ajustes distintos y nos quedamos con la que mejor pinta tiene,
 * medida por la confianza del lector y por cuántos datos de factura encuentra
 * el analizador (proveedor, número, fecha, base, total…).
 */

const PSM_BLOCK = "6"; // un bloque uniforme de texto: lo normal en una factura
const PSM_COLUMNS = "4"; // columnas de tamaño variable: importes a la derecha
const PSM_SPARSE = "11"; // rótulos y datos sueltos, útil para NIF pequeños en el encabezado
const GOOD_ENOUGH = 78; // puntuación a partir de la cual no merece la pena seguir
const MAX_ATTEMPTS = 4;

/** Puntúa un texto leído: confianza del lector + datos de factura encontrados. */
function scoreText(text, confidence) {
  const clean = String(text || "");
  if (clean.replace(/\s/g, "").length < 12) return -1;
  let score = Math.max(0, Math.min(100, Number(confidence) || 0)) * 0.6;
  try {
    const p = parseInvoiceText(clean);
    if (p.total != null) score += 14;
    if (p.supplierName) score += 8;
    if (p.base != null) score += 8;
    if (p.number) score += 7;
    if (p.supplierNif) score += 6;
    if (p.igic != null) score += 5;
    if (p.issueDate) score += 5;
    if (p.rate != null) score += 3;
    if (clean.replace(/\s/g, "").length > 200) score += 4;
  } catch (_) {
    /* si el analizador falla, queda solo la confianza */
  }
  return score;
}

function hasReliableSupplierNif(text) {
  try {
    return !!parseInvoiceText(String(text || "")).supplierNif;
  } catch (_) {
    return false;
  }
}

/** Gira un lienzo sobre fondo blanco (0, 90, 180, 270). */
function rotateCanvas(canvas, deg) {
  if (!deg) return canvas;
  const swap = deg % 180 !== 0;
  const w = swap ? canvas.height : canvas.width;
  const h = swap ? canvas.width : canvas.height;
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.translate(w / 2, h / 2);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  return out;
}

/** Copia en blanco y negro puro, con el umbral de Otsu. */
function binarize(canvas) {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, w, h);
  const px = img.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < px.length; i += 4) {
    const g = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0;
    hist[g]++;
  }
  const total = w * h || 1;
  let sum = 0;
  for (let v = 0; v < 256; v++) sum += v * hist[v];
  let sumB = 0;
  let wB = 0;
  let best = -1;
  let threshold = 128;
  for (let v = 0; v < 256; v++) {
    wB += hist[v];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += v * hist[v];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      threshold = v;
    }
  }
  const out = new Uint8ClampedArray(px.length);
  for (let i = 0; i < px.length; i += 4) {
    const g = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
    const v = g > threshold ? 255 : 0;
    out[i] = out[i + 1] = out[i + 2] = v;
    out[i + 3] = 255;
  }
  const copy = document.createElement("canvas");
  copy.width = w;
  copy.height = h;
  copy.getContext("2d").putImageData(new ImageData(out, w, h), 0, 0);
  return copy;
}

/** Arreglos suaves del texto del OCR, sin tocar los números. */
function tidyOcr(text) {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\u00a0/g, " ")
    .replace(/([|¦])[ \t]*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function ocrOnce(worker, canvas, psm) {
  try {
    await worker.setParameters({
      tessedit_pageseg_mode: psm,
      preserve_interword_spaces: "1",
      user_defined_dpi: "300",
      tessedit_do_invert: "0",
    });
  } catch (_) {
    /* si algún parámetro no existe, se lee con lo que haya */
  }
  const { data } = await worker.recognize(canvas);
  const text = tidyOcr((data && data.text) || "");
  const confidence = Number((data && data.confidence) || 0);
  return { text, confidence, score: scoreText(text, confidence) };
}

/**
 * Lee una imagen con varias pasadas y devuelve la mejor lectura.
 * onProgress(etapa, 0..100)
 */
async function ocrCanvas(canvas, onProgress = () => {}) {
  const worker = await getOcrWorker((stage, pct) => {
    onProgress(stage || "OCR", Math.round(10 + pct * 25));
  });

  let best = null;
  let attempt = 0;
  const plan = [];

  const run = async (image, psm, label) => {
    attempt += 1;
    onProgress(label, Math.min(88, 30 + attempt * 14));
    const result = await ocrOnce(worker, image, psm);
    if (!best || result.score > best.score) best = result;
    return result;
  };

  // 1) Lectura normal.
  await run(canvas, PSM_BLOCK, "leyendo la factura");
  if (best.score >= GOOD_ENOUGH && hasReliableSupplierNif(best.text)) {
    onProgress("leída", 100);
    return best.text;
  }

  // 2) Con distribución por columnas: muchas facturas llevan los importes aparte.
  await run(canvas, PSM_COLUMNS, "buscando columnas de importes");
  if (best.score >= GOOD_ENOUGH && hasReliableSupplierNif(best.text)) {
    onProgress("leída", 100);
    return best.text;
  }

  // 3) Blanco y negro puro: separa mejor la tinta del papel.
  plan.push(() => run(binarize(canvas), PSM_BLOCK, "acentuando el contraste"));
  // Si no se ha leído un NIF fiable, una pasada de texto disperso suele rescatar
  // los rótulos pequeños del encabezado sin dar por válida una cifra dudosa.
  if (!hasReliableSupplierNif(best.text)) {
    plan.push(() => run(binarize(canvas), PSM_SPARSE, "revisando el NIF del emisor"));
  }

  // 4) Si la confianza es baja, es probable que la foto esté girada.
  if (best.confidence < 62) {
    plan.push(() => run(rotateCanvas(canvas, 90), PSM_BLOCK, "probando girada 90°"));
    plan.push(() => run(rotateCanvas(canvas, 270), PSM_BLOCK, "probando girada 270°"));
    plan.push(() => run(rotateCanvas(canvas, 180), PSM_BLOCK, "probando del revés"));
  }

  for (const step of plan) {
    if (attempt >= MAX_ATTEMPTS + 2) break;
    await step();
    if (best.score >= GOOD_ENOUGH && hasReliableSupplierNif(best.text)) break;
  }

  onProgress("leída", 100);
  return best ? best.text : "";
}

/* ------------------------------------------------------------------ */
/* Interfaz principal                                                 */
/* ------------------------------------------------------------------ */

export function describeFile(file) {
  const type = String(file.type || "");
  if (type === "application/pdf" || /\.pdf$/i.test(file.name)) return "pdf";
  if (type.startsWith("image/") || /\.(jpe?g|png|webp|bmp|tiff?|heic|heif)$/i.test(file.name)) return "image";
  return "unknown";
}

/**
 * Saca el papel en imágenes, para que una IA que sepa ver pueda leerlo tal
 * cual: las hojas del PDF dibujadas o la foto reducida. Devuelve imágenes en
 * datos (data:image/jpeg;base64,…), que es lo que entienden esos servicios.
 *
 * Se limita el número de hojas y el tamaño: más grande no se lee mejor y la
 * petición pesa demasiado. Con `pages` se piden hojas concretas (1, 2, 3…),
 * que es lo que hace falta cuando un PDF trae varios papeles y este es solo
 * uno de ellos: se le manda a la IA únicamente su hoja.
 */
export async function documentPageImages(
  file,
  { maxPages = 4, maxSide = 1560, quality = 0.82, pages: pedidas = null } = {}
) {
  const kind = describeFile(file);

  if (kind === "pdf") {
    const pdfjs = await getPdfjs();
    const data = new Uint8Array(await file.arrayBuffer());
    const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
    const total = doc.numPages;
    const lista =
      Array.isArray(pedidas) && pedidas.length
        ? pedidas.map((n) => Math.round(n)).filter((n) => n >= 1 && n <= total).slice(0, maxPages)
        : null;
    const cuales = lista && lista.length ? lista : Array.from({ length: Math.min(total, maxPages) }, (_, i) => i + 1);
    const pages = cuales.length;
    const images = [];
    for (const p of cuales) {
      const page = await doc.getPage(p);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(2.6, Math.max(0.8, maxSide / Math.max(1, base.width)));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      images.push(canvas.toDataURL("image/jpeg", quality));
    }
    try {
      doc.destroy();
    } catch (_) {
      /* nada */
    }
    return { images, total, pages };
  }

  if (kind === "image") {
    const bitmap = await createImageBitmap(file);
    const longest = Math.max(bitmap.width, bitmap.height) || 1;
    const scale = longest > maxSide ? maxSide / longest : 1;
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, w, h);
    if (bitmap.close) bitmap.close();
    return { images: [canvas.toDataURL("image/jpeg", quality)], total: 1, pages: 1 };
  }

  return { images: [], total: 0, pages: 0 };
}

/**
 * Lee un fichero y devuelve su texto.
 * onProgress(etapa, 0..100)
 */
export async function readFile(file, onProgress = () => {}) {
  const kind = describeFile(file);
  if (kind === "unknown") {
    throw new Error("Solo puedo leer fotos (JPG, PNG…) y PDF.");
  }
  if (file.size > MAX_BYTES) {
    throw new Error("El fichero es demasiado grande (más de 30 MB).");
  }

  if (kind === "pdf") {
    onProgress("Abriendo el PDF", 5);
    let leido = null;
    try {
      leido = await pdfTextLayer(file, onProgress);
    } catch (err) {
      throw new Error(
        "No he podido abrir el PDF. Si es un escaneo, prueba a subirlo como foto o comprueba la conexión."
      );
    }

    const text = leido ? leido.text : "";
    const compact = text.replace(/\s/g, "");
    if (compact.length >= 120) {
      onProgress("Texto del PDF leído", 100);
      return {
        text,
        source: "pdf-text",
        pages: leido ? leido.pages : 1,
        total: leido ? leido.total : 1,
        textos: leido && leido.textos ? leido.textos : [text],
      };
    }

    // Escaneo dentro de un PDF: hay que mirarlo como imagen. Se leen TODAS las
    // páginas (hasta un tope: cada una cuesta unos segundos de lector). Antes
    // se leían dos y se paraba en cuanto una página nombraba el total, así que
    // en un papel de tres hojas la tercera no se miraba nunca.
    onProgress("Es un PDF escaneado: pasando al lector de imágenes", 15);
    const escaneo = await pdfScanCanvases(file, 12);
    const canvases = escaneo.canvases;
    const parts = [];
    for (let i = 0; i < canvases.length; i++) {
      const base = 20 + Math.round((i / canvases.length) * 60);
      const textoPagina = await ocrCanvas(canvases[i], (stage, pct) => {
        onProgress(`Página ${i + 1}: ${stage || "leyendo"}`, Math.min(96, base + Math.round(pct / 3)));
      });
      parts.push(textoPagina);
    }
    const entero = parts.slice();
    if (escaneo.total > canvases.length) {
      entero.push(
        `(El PDF tiene ${escaneo.total} páginas y he leído las ${canvases.length} primeras.)`
      );
    }
    return {
      text: entero.join("\n\n"),
      source: "pdf-ocr",
      pages: canvases.length,
      total: escaneo.total,
      textos: parts,
    };
  }

  onProgress("Preparando la foto", 8);
  const canvas = await prepareImage(file);
  const text = await ocrCanvas(canvas, (stage, pct) => {
    onProgress(`Leyendo la foto (${stage || "OCR"})`, 10 + Math.round(pct * 0.9));
  });
  return { text, source: "image-ocr", pages: 1, total: 1, textos: [text] };
}

export function sourceLabel(source) {
  if (source === "pdf-text") return "Texto del PDF";
  if (source === "pdf-ocr") return "Escaneo del PDF";
  if (source === "image-ocr") return "Foto leída con OCR";
  if (source === "manual") return "Escrita a mano";
  if (source === "pasted") return "Texto pegado";
  if (source === "email") return "Correo electrónico";
  return "Origen desconocido";
}
