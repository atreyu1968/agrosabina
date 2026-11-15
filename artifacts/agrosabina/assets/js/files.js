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
 * Viven en IndexedDB, que es el almacén del navegador pensado para datos
 * binarios. Cada original se apunta con el mismo id que su documento; en el
 * documento solo queda el nombre, el tipo y el tamaño.
 *
 * Nada de esto sale del ordenador: no hay servidor ni subida a ninguna parte.
 */

const DB_NAME = "facturas.igic.ficheros";
const STORE = "originales";

/** ¿Este navegador puede guardar ficheros? */
export function filesSupported() {
  return typeof window !== "undefined" && !!window.indexedDB;
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
  const record = { name, type, size, savedAt: new Date().toISOString(), blob };
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
  return { name, type, size, savedAt: record.savedAt };
}

/** El fichero guardado de un documento, o null si no hay ninguno. */
export async function originalOf(id) {
  if (!id || !filesSupported()) return null;
  const d = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const rq = d.transaction(STORE, "readonly").objectStore(STORE).get(String(id));
      rq.onsuccess = () => resolve(rq.result || null);
      rq.onerror = () => reject(rq.error || new Error("No se pudo leer el fichero original."));
    });
  } finally {
    d.close();
  }
}

/** Tira el fichero original de un documento (cuando se borra el documento). */
export async function dropOriginal(id) {
  if (!id || !filesSupported()) return false;
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
  return true;
}

/** Borra todos los originales (al vaciar el programa). */
export async function forgetAllOriginals() {
  if (!filesSupported()) return false;
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
