/*
 * La base de datos: SQLite de verdad, dentro del navegador.
 *
 * Se usa sql.js, que es SQLite compilado a WebAssembly. La base de datos vive
 * en memoria mientras la página está abierta y, en cada cambio, se guarda
 * entera (sus bytes) en IndexedDB, que es el almacén del navegador pensado
 * para datos binarios y de más tamaño que localStorage.
 *
 * Ventajas: los datos están en tablas SQL (proveedores, facturas, ajustes),
 * se pueden consultar con SQL y se pueden descargar como fichero .sqlite para
 * abrirlo con cualquier programa de bases de datos.
 *
 * Si el navegador no deja cargar sql.js (sin conexión la primera vez, o un
 * navegador muy antiguo), el programa sigue funcionando: store.js cae en el
 * guardado anterior en localStorage y lo dice en Ajustes.
 */

const SQLJS_VERSIONS = ["1.13.0", "1.10.3"];
const IDB_NAME = "facturas.igic";
const IDB_STORE = "sqlite";
const IDB_KEY = "facturas.igic.sqlite";

let SQL = null; // el módulo sql.js ya cargado
let db = null; // la base de datos abierta (objeto de sql.js)
let available = false;
let failReason = "";
let lastPersist = 0;

/* ------------------------------------------------------------------ */
/* Carga de sql.js                                                    */
/* ------------------------------------------------------------------ */

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    const prev = document.querySelector(`script[data-sqljs="${src}"]`);
    if (prev) {
      if (prev.dataset.state === "ready") return resolve();
      if (prev.dataset.state === "error") return reject(new Error("No se pudo cargar SQLite."));
      prev.addEventListener("load", () => resolve(), { once: true });
      prev.addEventListener("error", () => reject(new Error("No se pudo cargar SQLite.")), {
        once: true,
      });
      return;
    }
    const el = document.createElement("script");
    el.src = src;
    el.async = true;
    el.dataset.sqljs = src;
    el.addEventListener("load", () => {
      el.dataset.state = "ready";
      resolve();
    });
    el.addEventListener("error", () => {
      el.dataset.state = "error";
      reject(new Error("No se pudo cargar SQLite."));
    });
    document.head.appendChild(el);
  });
}

async function loadSqlJs() {
  let lastError = null;
  for (const version of SQLJS_VERSIONS) {
    const base = `https://cdn.jsdelivr.net/npm/sql.js@${version}/dist/`;
    try {
      await loadScriptOnce(`${base}sql-wasm.js`);
      if (typeof window.initSqlJs !== "function") throw new Error("sql.js no se ha inicializado.");
      return await window.initSqlJs({ locateFile: (file) => base + file });
    } catch (err) {
      lastError = err;
      console.warn(`SQLite ${version} no ha cargado:`, err);
    }
  }
  throw lastError || new Error("No se pudo cargar SQLite.");
}

/* ------------------------------------------------------------------ */
/* IndexedDB: donde se guardan los bytes de la base de datos          */
/* ------------------------------------------------------------------ */

function openIdb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error("Este navegador no tiene IndexedDB."));
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(IDB_STORE)) d.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("No se pudo abrir IndexedDB."));
  });
}

async function idbRead() {
  const d = await openIdb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = d.transaction(IDB_STORE, "readonly");
      const rq = tx.objectStore(IDB_STORE).get(IDB_KEY);
      rq.onsuccess = () => resolve(rq.result || null);
      rq.onerror = () => reject(rq.error || new Error("No se pudo leer de IndexedDB."));
    });
  } finally {
    d.close();
  }
}

async function idbWrite(bytes) {
  const d = await openIdb();
  try {
    await new Promise((resolve, reject) => {
      const tx = d.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(bytes, IDB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("No se pudo guardar en IndexedDB."));
      tx.onabort = () => reject(tx.error || new Error("Se canceló el guardado."));
    });
  } finally {
    d.close();
  }
}

/* ------------------------------------------------------------------ */
/* Esquema                                                            */
/* ------------------------------------------------------------------ */

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ajustes (
  clave TEXT PRIMARY KEY,
  valor TEXT
);

CREATE TABLE IF NOT EXISTS proveedores (
  id         TEXT PRIMARY KEY,
  nombre     TEXT NOT NULL,
  nif        TEXT DEFAULT '',
  email      TEXT DEFAULT '',
  telefono   TEXT DEFAULT '',
  nota       TEXT DEFAULT '',
  rol        TEXT DEFAULT 'PROVEEDOR',
  creado_en  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS facturas (
  id             TEXT PRIMARY KEY,
  proveedor_id   TEXT REFERENCES proveedores(id) ON DELETE CASCADE,
  numero         TEXT DEFAULT '',
  fecha          TEXT DEFAULT '',
  vencimiento    TEXT DEFAULT '',
  base           REAL,
  tipo_igic      REAL,
  cuota_igic     REAL,
  total          REAL,
  estado         TEXT NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PAGADO','PENDIENTE')),
  fecha_pago     TEXT DEFAULT '',
  tipo           TEXT DEFAULT 'FACTURA',
  categoria      TEXT DEFAULT '',
  sentido        TEXT DEFAULT 'GASTO',
  lineas         TEXT DEFAULT '',
  liquidacion    TEXT DEFAULT '',
  nomina         TEXT DEFAULT '',
  origen         TEXT DEFAULT 'manual',
  fichero        TEXT DEFAULT '',
  original       TEXT DEFAULT '',
  medio_pago     TEXT DEFAULT '',
  cuenta_corriente TEXT DEFAULT '',
  texto          TEXT DEFAULT '',
  notas          TEXT DEFAULT '',
  confianza      REAL,
  creado_en      TEXT NOT NULL,
  actualizado_en TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_facturas_proveedor ON facturas(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_facturas_estado    ON facturas(estado);
CREATE INDEX IF NOT EXISTS idx_facturas_fecha     ON facturas(fecha);

CREATE VIEW IF NOT EXISTS igic_por_proveedor AS
  SELECT p.id AS proveedor_id,
         p.nombre AS proveedor,
         f.estado AS estado,
         COUNT(*) AS facturas,
         ROUND(SUM(f.base), 2) AS base,
         ROUND(SUM(f.cuota_igic), 2) AS igic,
         ROUND(SUM(f.total), 2) AS total
  FROM facturas f
  JOIN proveedores p ON p.id = f.proveedor_id
  GROUP BY p.id, f.estado;

CREATE TABLE IF NOT EXISTS correos (
  id          TEXT PRIMARY KEY,
  de          TEXT DEFAULT '',
  asunto      TEXT NOT NULL,
  fecha       TEXT DEFAULT '',
  texto       TEXT DEFAULT '',
  adjuntos    TEXT DEFAULT '',
  importado_en TEXT NOT NULL,
  usado_en    TEXT DEFAULT ''
);

PRAGMA user_version = 7;
`;

function exec(sql, params) {
  if (!db) throw new Error("La base de datos no está abierta.");
  if (params && params.length) db.run(sql, params);
  else db.run(sql);
}

function rows(sql, params) {
  const stmt = db.prepare(sql);
  const out = [];
  try {
    if (params && params.length) stmt.bind(params);
    while (stmt.step()) out.push(stmt.getAsObject());
  } finally {
    stmt.free();
  }
  return out;
}

/**
 * Una base de datos creada con la versión anterior no tiene las columnas del
 * tipo de documento. Se añaden a mano, sin tocar los datos que ya hay.
 */
function addMissingColumns() {
  const have = new Set(rows("PRAGMA table_info(facturas)").map((r) => String(r.name)));
  if (!have.has("tipo")) exec("ALTER TABLE facturas ADD COLUMN tipo TEXT DEFAULT 'FACTURA'");
  if (!have.has("categoria")) exec("ALTER TABLE facturas ADD COLUMN categoria TEXT DEFAULT ''");
  if (!have.has("sentido")) exec("ALTER TABLE facturas ADD COLUMN sentido TEXT DEFAULT 'GASTO'");
  if (!have.has("lineas")) exec("ALTER TABLE facturas ADD COLUMN lineas TEXT DEFAULT ''");
  if (!have.has("liquidacion")) exec("ALTER TABLE facturas ADD COLUMN liquidacion TEXT DEFAULT ''");
  // Los datos de una nómina (bruto, Seguridad Social, IRPF y líquido).
  if (!have.has("nomina")) exec("ALTER TABLE facturas ADD COLUMN nomina TEXT DEFAULT ''");
  // El fichero original del documento (nombre, tipo y tamaño; los bytes van aparte).
  if (!have.has("original")) exec("ALTER TABLE facturas ADD COLUMN original TEXT DEFAULT ''");
  // Con qué se cobró o se pagó: caja o banco, y en qué cuenta corriente.
  if (!have.has("medio_pago")) exec("ALTER TABLE facturas ADD COLUMN medio_pago TEXT DEFAULT ''");
  if (!have.has("cuenta_corriente")) {
    exec("ALTER TABLE facturas ADD COLUMN cuenta_corriente TEXT DEFAULT ''");
  }
  // Un tercero es proveedor, cliente o las dos cosas.
  const haveSup = new Set(rows("PRAGMA table_info(proveedores)").map((r) => String(r.name)));
  if (!haveSup.has("rol")) exec("ALTER TABLE proveedores ADD COLUMN rol TEXT DEFAULT 'PROVEEDOR'");

  exec("DROP VIEW IF EXISTS igic_por_proveedor");
  exec(`CREATE VIEW igic_por_proveedor AS
    SELECT p.id AS proveedor_id,
           p.nombre AS proveedor,
           f.estado AS estado,
           COUNT(*) AS facturas,
           ROUND(SUM(f.base), 2) AS base,
           ROUND(SUM(f.cuota_igic), 2) AS igic,
           ROUND(SUM(f.total), 2) AS total
      FROM facturas f
      JOIN proveedores p ON p.id = f.proveedor_id
     WHERE UPPER(COALESCE(f.tipo, '')) <> 'NOMINA'
     GROUP BY p.id, f.estado`);
}

/* ------------------------------------------------------------------ */
/* Abrir / cerrar                                                     */
/* ------------------------------------------------------------------ */

/** Abre la base de datos (o la crea). Devuelve true si SQLite está disponible. */
export async function init() {
  if (db) return true;
  try {
    SQL = await loadSqlJs();
    const saved = await idbRead().catch(() => null);
    db = saved && saved.byteLength ? new SQL.Database(new Uint8Array(saved)) : new SQL.Database();
    db.run(SCHEMA);
    addMissingColumns();
    available = true;
    failReason = "";
    return true;
  } catch (err) {
    available = false;
    failReason = (err && err.message) || String(err);
    console.warn("SQLite no está disponible; se guardará como antes:", err);
    return false;
  }
}

export function isAvailable() {
  return available && !!db;
}

export function why() {
  return failReason;
}

/* ------------------------------------------------------------------ */
/* Leer y escribir los datos                                          */
/* ------------------------------------------------------------------ */

function settingsFromDb() {
  const out = {};
  for (const row of rows("SELECT clave, valor FROM ajustes")) {
    try {
      out[row.clave] = JSON.parse(row.valor);
    } catch (_) {
      out[row.clave] = row.valor;
    }
  }
  return out;
}

/**
 * Devuelve los datos como { settings, suppliers, invoices }, o null si la base
 * de datos está recién creada y todavía no tiene nada.
 */
export function readState() {
  if (!isAvailable()) return null;

  const settings = settingsFromDb();
  const suppliers = rows(
    "SELECT id, nombre, nif, email, telefono, nota, rol, creado_en FROM proveedores ORDER BY creado_en"
  ).map((r) => ({
    id: r.id,
    name: r.nombre,
    nif: r.nif || "",
    email: r.email || "",
    phone: r.telefono || "",
    note: r.nota || "",
    role: r.rol || "",
    createdAt: r.creado_en,
  }));

  const invoices = rows(
    `SELECT id, proveedor_id, numero, fecha, vencimiento, base, tipo_igic, cuota_igic, total,
            estado, fecha_pago, tipo, categoria, sentido, lineas, liquidacion, nomina, origen, fichero, original,
            medio_pago, cuenta_corriente,
            texto, notas, confianza, creado_en, actualizado_en
       FROM facturas ORDER BY creado_en DESC`
  ).map((r) => {
    let notes = [];
    try {
      notes = r.notas ? JSON.parse(r.notas) : [];
    } catch (_) {
      notes = [];
    }
    let lines = [];
    try {
      lines = r.lineas ? JSON.parse(r.lineas) : [];
    } catch (_) {
      lines = [];
    }
    let liquidacion = null;
    try {
      liquidacion = r.liquidacion ? JSON.parse(r.liquidacion) : null;
    } catch (_) {
      liquidacion = null;
    }
    let original = null;
    try {
      original = r.original ? JSON.parse(r.original) : null;
    } catch (_) {
      original = null;
    }
    let nomina = null;
    try {
      nomina = r.nomina ? JSON.parse(r.nomina) : null;
    } catch (_) {
      nomina = null;
    }
    return {
      id: r.id,
      supplierId: r.proveedor_id || null,
      number: r.numero || "",
      issueDate: r.fecha || "",
      dueDate: r.vencimiento || "",
      base: r.base,
      rate: r.tipo_igic,
      igic: r.cuota_igic,
      total: r.total,
      status: r.estado === "PAGADO" ? "PAGADO" : "PENDIENTE",
      paidDate: r.fecha_pago || "",
      payMethod: r.medio_pago === "CAJA" ? "CAJA" : ["BANCO", "TARJETA"].includes(r.medio_pago) ? r.medio_pago : "",
      payAccount: r.cuenta_corriente || "",
      kind: r.tipo || "FACTURA",
      category: r.categoria || "",
      direction: r.sentido === "INGRESO" ? "INGRESO" : "GASTO",
      lines: Array.isArray(lines) ? lines : [],
      liquidacion: liquidacion && typeof liquidacion === "object" ? liquidacion : null,
      nomina: nomina && typeof nomina === "object" ? nomina : null,
      source: r.origen || "manual",
      fileName: r.fichero || "",
      original: original && typeof original === "object" ? original : null,
      rawText: r.texto || "",
      notes: Array.isArray(notes) ? notes : [],
      confidence: r.confianza == null ? null : Number(r.confianza),
      createdAt: r.creado_en,
      updatedAt: r.actualizado_en,
    };
  });

  let messages = [];
  try {
    messages = rows(
      "SELECT id, de, asunto, fecha, texto, adjuntos, importado_en, usado_en FROM correos ORDER BY importado_en DESC"
    ).map((r) => {
      let adjuntos = [];
      try {
        adjuntos = r.adjuntos ? JSON.parse(r.adjuntos) : [];
      } catch (_) {
        adjuntos = [];
      }
      return {
        id: r.id,
        from: r.de || "",
        subject: r.asunto || "",
        date: r.fecha || "",
        text: r.texto || "",
        attachments: Array.isArray(adjuntos) ? adjuntos : [],
        importedAt: r.importado_en,
        usedAt: r.usado_en || "",
      };
    });
  } catch (err) {
    console.warn("No se pudo leer el correo guardado:", err);
  }

  if (!suppliers.length && !invoices.length && !messages.length && !Object.keys(settings).length) return null;
  return { settings, suppliers, invoices, messages };
}

/** Escribe todos los datos en las tablas (en una sola transacción). */
export function writeState(state) {
  if (!isAvailable() || !state) return false;
  const settings = state.settings || {};
  const suppliers = state.suppliers || [];
  const invoices = state.invoices || [];
  const messages = state.messages || [];

  try {
    exec("BEGIN");
    exec("DELETE FROM facturas");
    exec("DELETE FROM proveedores");
    exec("DELETE FROM ajustes");
    exec("DELETE FROM correos");

    for (const [key, value] of Object.entries(settings)) {
      exec("INSERT INTO ajustes (clave, valor) VALUES (?, ?)", [key, JSON.stringify(value)]);
    }

    for (const s of suppliers) {
      exec(
        `INSERT INTO proveedores (id, nombre, nif, email, telefono, nota, rol, creado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          s.id,
          s.name || "(sin nombre)",
          s.nif || "",
          s.email || "",
          s.phone || "",
          s.note || "",
          s.role === "CLIENTE" ? "CLIENTE" : s.role === "AMBOS" ? "AMBOS" : "PROVEEDOR",
          s.createdAt || new Date().toISOString(),
        ]
      );
    }

    for (const inv of invoices) {
      exec(
        `INSERT INTO facturas (id, proveedor_id, numero, fecha, vencimiento, base, tipo_igic,
                               cuota_igic, total, estado, fecha_pago, tipo, categoria, sentido,
                               lineas, liquidacion, nomina, origen, fichero, original,
                               medio_pago, cuenta_corriente, texto, notas, confianza,
                               creado_en, actualizado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          inv.id,
          inv.supplierId || null,
          inv.number || "",
          inv.issueDate || "",
          inv.dueDate || "",
          num(inv.base),
          num(inv.rate),
          num(inv.igic),
          num(inv.total),
          inv.status === "PAGADO" ? "PAGADO" : "PENDIENTE",
          inv.paidDate || "",
          inv.kind || "FACTURA",
          inv.category || "",
          inv.direction === "INGRESO" ? "INGRESO" : "GASTO",
          JSON.stringify(Array.isArray(inv.lines) ? inv.lines : []),
          JSON.stringify(inv.liquidacion || null),
          JSON.stringify(inv.nomina || null),
          inv.source || "manual",
          inv.fileName || "",
          JSON.stringify(inv.original || null),
          inv.payMethod === "CAJA" ? "CAJA" : ["BANCO", "TARJETA"].includes(inv.payMethod) ? inv.payMethod : "",
          String(inv.payAccount || "").slice(0, 120),
          String(inv.rawText || "").slice(0, 8000),
          JSON.stringify(inv.notes || []),
          num(inv.confidence),
          inv.createdAt || new Date().toISOString(),
          inv.updatedAt || inv.createdAt || new Date().toISOString(),
        ]
      );
    }

    for (const m of messages) {
      exec(
        `INSERT INTO correos (id, de, asunto, fecha, texto, adjuntos, importado_en, usado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          m.id,
          m.from || "",
          m.subject || "(sin asunto)",
          m.date || "",
          String(m.text || "").slice(0, 20000),
          JSON.stringify(m.attachments || []),
          m.importedAt || new Date().toISOString(),
          m.usedAt || "",
        ]
      );
    }

    exec("COMMIT");
    return true;
  } catch (err) {
    console.error("No se pudo escribir en SQLite:", err);
    try {
      exec("ROLLBACK");
    } catch (_) {
      /* nada */
    }
    return false;
  }
}

function num(v) {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Guarda los bytes de la base de datos en IndexedDB. */
export async function persist() {
  if (!isAvailable()) return false;
  try {
    const bytes = db.export();
    await idbWrite(bytes);
    lastPersist = Date.now();
    return true;
  } catch (err) {
    console.warn("No se pudo guardar la base de datos:", err);
    return false;
  }
}

export function lastPersistAt() {
  return lastPersist;
}

/** El fichero .sqlite tal cual, para descargarlo. */
export function exportBytes() {
  if (!isAvailable()) return null;
  try {
    return db.export();
  } catch (err) {
    console.warn("No se pudo exportar la base de datos:", err);
    return null;
  }
}

/** Cuántas filas hay de cada cosa: para enseñarlo en Ajustes. */
export function counts() {
  if (!isAvailable()) return null;
  try {
    const one = (sql) => {
      const r = rows(sql);
      return r.length ? Number(Object.values(r[0])[0]) || 0 : 0;
    };
    return {
      suppliers: one("SELECT COUNT(*) FROM proveedores"),
      invoices: one("SELECT COUNT(*) FROM facturas"),
      messages: one("SELECT COUNT(*) FROM correos"),
      paid: one("SELECT COUNT(*) FROM facturas WHERE estado = 'PAGADO'"),
      pending: one("SELECT COUNT(*) FROM facturas WHERE estado = 'PENDIENTE'"),
      bytes: (db.export() || []).length,
      version: rows("SELECT sqlite_version() AS v")[0]?.v || "",
    };
  } catch (err) {
    console.warn("No se pudieron contar las filas:", err);
    return null;
  }
}

/**
 * Resumen del IGIC por proveedor, calculado por SQLite (usa la vista
 * igic_por_proveedor). Sirve para comprobar que las tablas están bien.
 */
export function igicSummary() {
  if (!isAvailable()) return [];
  try {
    return rows(
      `SELECT proveedor, estado, facturas, base, igic, total
         FROM igic_por_proveedor ORDER BY total DESC`
    );
  } catch (err) {
    console.warn("No se pudo consultar la vista del IGIC:", err);
    return [];
  }
}
