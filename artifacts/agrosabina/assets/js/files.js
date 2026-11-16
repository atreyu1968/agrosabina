/**
 * Los originales de los documentos.
 *
 * De cada factura, liquidación o correo se guarda también el fichero tal y
 * como entró: la foto que se hizo con el móvil, el PDF que se descargó o el
 * .eml del correo. Así se puede volver a mirar para comprobar un dato sin
 * depender del papel ni de la bandeja de entrada.
 *
 * No se guardan dentro de SQLite ni en la copia en texto de localStorage: una
 * foto ocupa megas y el fichero de copia de seguridad crecería sin medida.
 * La copia local vive en IndexedDB. Cuando la cuenta compartida está activa,
 * cada original también se guarda en el servidor persistente con el mismo id.
 * En el registro solo queda el nombre, el tipo y el tamaño.
 */

const DB_NAME = "facturas.igic.ficheros";
const STORE = "originales";
let sharedFilesEnabled = false;

export function enableSharedFiles() {
  sharedFilesEnabled = true;
}

/** ¿Este navegador puede guardar ficheros? */
export function filesSupported() {
  return typeof window !== "undefined" && !!window.indexedDB;
}

/** Solicita que el navegador no elimine los datos locales al liberar espacio. */
export async function requestPersistentStorage() {
  const manager = typeof navigator !== "undefined" ? navigator.storage : null;
  if (!manager) return { supported: false, persistent: false };
  let supported = typeof manager.persist === "function";
  try {
    if (typeof manager.persisted === "function" && await manager.persisted()) {
      return { supported: true, persistent: true };
    }
  } catch (_) {
    // Se puede volver a intentar con persist() debajo.
  }
  if (!supported) return { supported: false, persistent: false };
  try {
    return { supported: true, persistent: !!(await manager.persist()) };
  } catch (_) {
    return { supported: true, persistent: false };
  }
}

/** Consulta el permiso de persistencia sin volver a solicitarlo. */
export async function persistentStorageStatus() {
  const manager = typeof navigator !== "undefined" ? navigator.storage : null;
  if (!manager || typeof manager.persisted !== "function") {
    return { supported: false, persistent: false };
  }
  try {
    return {
      supported: typeof manager.persist === "function",
      persistent: !!(await manager.persisted()),
    };
  } catch (_) {
    return { supported: typeof manager.persist === "function", persistent: false };
  }
}

function openDb() {
  if (!filesSupported()) {
    return Promise.reject(new Error("Este navegador no sabe guardar ficheros."));
  }
  // Cada operación cierra su conexión en finally: no reutilizar una ya cerrada.
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("No se pudo abrir el almacén de ficheros."));
    req.onblocked = () => reject(new Error("El almacén de ficheros está abierto en otra pestaña."));
  });
}

function sizeOf(value) {
  if (!value) return 0;
  if (Number.isFinite(value.size) && value.size > 0) return Number(value.size);
  if (value.blob && Number.isFinite(value.blob.size)) return Number(value.blob.size);
  return 0;
}

async function putLocalRecord(id, record) {
  if (!filesSupported()) return false;
  const d = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = d.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(record, String(id));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("No se pudo guardar el fichero original."));
      tx.onabort = () => reject(tx.error || new Error("Se canceló el guardado del original."));
    });
  } finally {
    d.close();
  }
  return true;
}

async function uploadSharedFile(id, record) {
  if (!sharedFilesEnabled) return;
  const { sharedRequest } = await import("./shared-api.js");
  await sharedRequest(`/files/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: record.blob,
    headers: {
      "Content-Type": "application/octet-stream",
      "X-File-Name": encodeURIComponent(record.name || "documento"),
      "X-File-Type": record.type || "application/octet-stream",
      ...(record.sha256 ? { "X-File-Sha256": record.sha256 } : {}),
      ...(record.segment ? { "X-File-Segment": encodeURIComponent(record.segment) } : {}),
    },
  });
}

/**
 * Guarda el fichero de un documento.
 * @param {string} id el mismo id del documento
 * @param {Blob|File} blob los bytes, tal cual
 * @param {{name?:string,type?:string}} info nombre y tipo para poder ofrecerlo luego
 * @returns {Promise<{name:string,type:string,size:number,savedAt:string}>}
 */
export async function keepOriginal(id, blob, info = {}) {
  if (!id) throw new Error("Falta el documento al que pertenece el fichero.");
  if (!blob) throw new Error("No hay fichero que guardar.");
  const name = String(info.name || blob.name || "documento");
  const type = String(info.type || blob.type || "");
  const size = sizeOf(blob);
  if (!size) throw new Error("El fichero original está vacío.");
  await requestPersistentStorage();
  const sha256 = String(info.sha256 || "").toLowerCase();
  const segment = String(info.segment || "1").slice(0, 100);
  const record = {
    name,
    type,
    size,
    savedAt: new Date().toISOString(),
    ...(/^[a-f0-9]{64}$/.test(sha256) ? { sha256 } : {}),
    ...(segment ? { segment } : {}),
    blob,
  };
  await putLocalRecord(id, record);
  await uploadSharedFile(id, record);
  return {
    name,
    type,
    size,
    savedAt: record.savedAt,
    ...(record.sha256 ? { sha256: record.sha256, segment: record.segment } : {}),
  };
}

export async function forgetOriginal(id) {
  if (!id) return;
  const key = String(id);
  if (filesSupported()) {
    const d = await openDb();
    try {
      await new Promise((resolve, reject) => {
        const tx = d.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () => reject(tx.error || new Error("No se pudo eliminar la copia local."));
      });
    } finally { d.close(); }
  }
  if (sharedFilesEnabled) {
    const { sharedRequest } = await import("./shared-api.js");
    await sharedRequest(`/files/${encodeURIComponent(key)}`, { method: "DELETE" });
  }
}

/** El fichero guardado de un documento, o null si no hay ninguno. */
export async function originalOf(id) {
  if (!id) return null;
  if (filesSupported()) {
    const d = await openDb();
    try {
      const local = await new Promise((resolve, reject) => {
        const rq = d.transaction(STORE, "readonly").objectStore(STORE).get(String(id));
        rq.onsuccess = () => resolve(rq.result || null);
        rq.onerror = () => reject(rq.error || new Error("No se pudo leer el fichero original."));
      });
      if (local) return local;
    } finally {
      d.close();
    }
  }
  if (!sharedFilesEnabled) return null;
  const { sharedFileRequest } = await import("./shared-api.js");
  let response;
  try {
    response = await sharedFileRequest(id);
  } catch (error) {
    if (error?.status === 404) return null;
    throw error;
  }
  const blob = await response.blob();
  const decodeHeader = (key, fallback = "") => {
    const value = response.headers.get(key);
    if (!value) return fallback;
    try { return decodeURIComponent(value); } catch { return value; }
  };
  return {
    name: decodeHeader("X-File-Name", "documento"),
    type: decodeHeader("X-File-Type", blob.type),
    size: blob.size,
    savedAt: decodeHeader("X-File-Saved-At", ""),
    sha256: decodeHeader("X-File-Sha256", ""),
    segment: decodeHeader("X-File-Segment", "1"),
    blob,
  };
}

/** Tira el fichero original de un documento (cuando se borra el documento). */
export async function dropOriginal(id) {
  if (!id) return false;
  if (sharedFilesEnabled) {
    const { sharedRequest } = await import("./shared-api.js");
    await sharedRequest(`/files/${encodeURIComponent(id)}`, { method: "DELETE" });
  }
  if (filesSupported()) {
    const d = await openDb();
    try {
      await new Promise((resolve, reject) => {
        const tx = d.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(String(id));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error("No se pudo borrar el fichero original."));
      });
    } finally {
      d.close();
    }
  }
  return true;
}

/** Borra todos los originales (al vaciar el programa). */
export async function forgetAllOriginals() {
  if (sharedFilesEnabled) {
    const { sharedRequest } = await import("./shared-api.js");
    await sharedRequest("/files", { method: "DELETE" });
  }
  if (!filesSupported()) return sharedFilesEnabled;
  const d = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = d.transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("No se pudieron borrar los originales."));
    });
  } finally {
    d.close();
  }
  return true;
}

/** Cuántos originales hay y cuánto ocupan: lo enseña Ajustes. */
export async function originalsUsed() {
  if (sharedFilesEnabled) {
    const { sharedRequest } = await import("./shared-api.js");
    return sharedRequest("/files/summary");
  }
  if (!filesSupported()) return { count: 0, bytes: 0 };
  const d = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const store = d.transaction(STORE, "readonly").objectStore(STORE);
      let count = 0;
      let bytes = 0;
      const rq = store.openCursor();
      rq.onsuccess = () => {
        const cursor = rq.result;
        if (!cursor) {
          resolve({ count, bytes });
          return;
        }
        count += 1;
        bytes += sizeOf(cursor.value);
        cursor.continue();
      };
      rq.onerror = () => reject(rq.error || new Error("No se pudo mirar el almacén de ficheros."));
    });
  } finally {
    d.close();
  }
}

/** Lee todos los originales en una única transacción consistente. */
async function snapshotLocalOriginals() {
  if (!filesSupported()) return new Map();
  const d = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const records = new Map();
      const tx = d.transaction(STORE, "readonly");
      const rq = tx.objectStore(STORE).openCursor();
      rq.onsuccess = () => {
        const cursor = rq.result;
        if (cursor) {
          records.set(String(cursor.key), cursor.value);
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve(records);
      tx.onerror = tx.onabort = () => reject(tx.error || new Error("No se pudieron leer los originales."));
    });
  } finally { d.close(); }
}

/** Sube originales locales que aún no existan en el almacén compartido. */
export async function uploadExistingOriginals() {
  if (!sharedFilesEnabled) return 0;
  const { sharedRequest } = await import("./shared-api.js");
  const { files: remoteFiles = [] } = await sharedRequest("/files");
  const remoteIds = new Set(remoteFiles.map((file) => String(file.id)));
  const localFiles = await snapshotLocalOriginals();
  let uploaded = 0;
  for (const [id, record] of localFiles) {
    if (remoteIds.has(String(id))) continue;
    await uploadSharedFile(id, record);
    uploaded += 1;
  }
  return uploaded;
}

/** Lee los originales compartidos y suma cualquier fichero local aún no enviado. */
export async function snapshotOriginals() {
  const records = await snapshotLocalOriginals();
  if (!sharedFilesEnabled) return records;
  const { sharedRequest, sharedFileRequest } = await import("./shared-api.js");
  const { files: remoteFiles = [] } = await sharedRequest("/files");
  for (const item of remoteFiles) {
    const response = await sharedFileRequest(item.id);
    const blob = await response.blob();
    records.set(String(item.id), {
      name: item.name,
      type: item.type,
      size: blob.size,
      savedAt: item.savedAt,
      sha256: item.sha256,
      segment: item.segment,
      blob,
    });
  }
  return records;
}

/** Solo añade: una colisión o falta de espacio aborta el lote entero. */
export async function addOriginals(records) {
  if (!records.size) return;
  if (filesSupported()) {
    const d = await openDb();
    try {
      await new Promise((resolve, reject) => {
        const tx = d.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        for (const [id, record] of records) store.add(record, id);
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () => reject(tx.error || new Error("No se pudieron añadir los originales (espacio insuficiente o identificador repetido)."));
      });
    } finally { d.close(); }
  }
  for (const [id, record] of records) await uploadSharedFile(id, record);
}
