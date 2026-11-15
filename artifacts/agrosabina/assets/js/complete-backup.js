import { validateBackup } from "./backup.js";

// JSON portable sin dependencias externas. Base64 añade aproximadamente un 33%.
export const MAX_BACKUP_BYTES = 200 * 1024 * 1024;
export const BACKUP_FORMAT = "agrosabina-completa";
const fail = (reason) => { throw new Error(`Copia completa no válida: ${reason}. No se han cambiado los datos.`); };

export function portableSettings(settings = {}) {
  // Lista permitida: ni claves, ni endpoints que puedan contener credenciales.
  return Object.fromEntries(
    ["defaultRate", "businessName", "bankAccounts", "cashAccount", "createdAt"]
      .filter((key) => Object.hasOwn(settings, key)).map((key) => [key, settings[key]])
  );
}

async function digest(bytes) {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

function encode(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 32768) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  }
  return btoa(binary);
}

export async function packCompleteBackup(data, originals) {
  validateBackup(data);
  const attachments = [];
  let encodedSize = 0;
  for (const inv of data.invoices) {
    const original = originals.get(inv.id);
    if (!original) {
      if (inv.original) throw new Error(`Falta el original de «${inv.number || inv.fileName || inv.id}». No se puede crear una copia completa.`);
      continue;
    }
    if (!(original.blob instanceof Blob) || !original.blob.size) {
      throw new Error("Hay un original ilegible. No se ha generado la copia.");
    }
    encodedSize += 4 * Math.ceil(original.blob.size / 3);
    if (encodedSize > MAX_BACKUP_BYTES - 1024 * 1024) {
      throw new Error("La copia supera el límite de 200 MB. Conserva los originales por separado.");
    }
    const bytes = new Uint8Array(await original.blob.arrayBuffer());
    const sha256 = await digest(bytes);
    attachments.push({
      invoiceId: inv.id, name: original.name, type: original.type,
      size: bytes.length, savedAt: original.savedAt,
      sha256, base64: encode(bytes),
    });
    inv.original = {
      name: original.name, type: original.type, size: bytes.length, savedAt: original.savedAt,
      sha256, segment: inv.original?.segment || "1",
    };
  }
  const archive = { format: BACKUP_FORMAT, version: 1, exportedAt: new Date().toISOString(),
    data: { ...data, settings: portableSettings(data.settings) }, attachments };
  const text = JSON.stringify(archive);
  if (new Blob([text]).size > MAX_BACKUP_BYTES) throw new Error("La copia supera el límite de 200 MB.");
  // No ofrecer una descarga que luego no pueda pasar nuestra propia validación.
  await unpackCompleteBackup(text);
  return text;
}

/** No abre almacenes ni escribe nada: toda la copia se comprueba primero. */
export async function unpackCompleteBackup(text) {
  if (typeof text !== "string" || new Blob([text]).size > MAX_BACKUP_BYTES) fail("supera el límite de 200 MB");
  const archive = JSON.parse(text);
  if (!archive || archive.format !== BACKUP_FORMAT || archive.version !== 1) fail("formato o versión incompatible");
  validateBackup(archive.data);
  if (!Array.isArray(archive.attachments)) fail("falta la lista de originales");
  const invoices = new Map(archive.data.invoices.map((inv) => [inv.id, inv]));
  const originals = new Map();
  for (const a of archive.attachments) {
    if (!a || !invoices.has(a.invoiceId) || originals.has(a.invoiceId)) fail("original repetido o sin documento");
    if (typeof a.name !== "string" || !a.name.trim() || a.name.length > 4096 ||
        typeof a.type !== "string" || a.type.length > 1024 ||
        !Number.isSafeInteger(a.size) || a.size <= 0 ||
        typeof a.savedAt !== "string" ||
        typeof a.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(a.sha256) ||
        typeof a.base64 !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(a.base64)) fail("metadatos o contenido incorrectos");
    const binary = atob(a.base64);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    if (bytes.length !== a.size || await digest(bytes) !== a.sha256) fail("un original está dañado");
    const meta = invoices.get(a.invoiceId).original;
    if (!meta || meta.name !== a.name || meta.type !== a.type || meta.size !== a.size ||
        meta.savedAt !== a.savedAt ||
        (meta.sha256 != null && meta.sha256 !== a.sha256) ||
        (meta.segment != null && (typeof meta.segment !== "string" || meta.segment.length > 100))) {
      fail("el original no coincide con su documento");
    }
    originals.set(a.invoiceId, { name: a.name, type: a.type, size: a.size,
      savedAt: a.savedAt, sha256: a.sha256, segment: meta.segment || "1",
      blob: new Blob([bytes], { type: a.type }) });
  }
  for (const inv of invoices.values()) {
    if (inv.original && !originals.has(inv.id)) fail("falta un original");
  }
  return { data: archive.data, originals, bytes: [...originals.values()].reduce((n, a) => n + a.size, 0) };
}
