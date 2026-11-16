import { Router, type IRouter } from "express";
import { requireAdmin, requireUser } from "../lib/auth";
import { database } from "../lib/storage";

const router: IRouter = Router();
router.use(requireUser);

function safeSharedState(value: unknown): unknown {
  const copy = JSON.parse(JSON.stringify(value));
  if (copy && typeof copy === "object" && copy.settings && typeof copy.settings === "object") {
    copy.settings.aiKey = "";
  }
  return copy;
}

router.get("/state", (_req, res) => {
  const row = database.prepare("SELECT revision, state_json AS state, updated_at AS updatedAt FROM app_state WHERE id = 1")
    .get() as { revision: number; state: string; updatedAt: string } | undefined;
  if (!row) {
    res.json({ revision: 0, state: null, updatedAt: null });
    return;
  }
  res.json({ revision: row.revision, state: safeSharedState(JSON.parse(row.state)), updatedAt: row.updatedAt });
});

router.put("/state", (req, res): void => {
  const expectedRevision = Number(req.body?.expectedRevision);
  const state = req.body?.state;
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || !state || typeof state !== "object" || Array.isArray(state)) {
    res.status(400).json({ error: "Los datos compartidos no tienen un formato válido." });
    return;
  }
  const safeState = safeSharedState(state) as Record<string, unknown>;
  const stateJson = JSON.stringify(safeState);
  if (Buffer.byteLength(stateJson, "utf8") > 25 * 1024 * 1024) {
    res.status(413).json({ error: "El estado supera el límite de 25 MB." });
    return;
  }

  database.exec("BEGIN IMMEDIATE");
  try {
    const current = database.prepare("SELECT revision FROM app_state WHERE id = 1").get() as { revision: number } | undefined;
    const currentRevision = current?.revision ?? 0;
    if (currentRevision !== expectedRevision) {
      database.exec("ROLLBACK");
      res.status(409).json({ error: "Otra persona guardó cambios. Se detuvo este guardado para no sobrescribirlos.", currentRevision });
      return;
    }
    if (current && res.locals.authUser?.role !== "admin") {
      const currentState = JSON.parse((database.prepare("SELECT state_json FROM app_state WHERE id = 1").get() as { state_json: string }).state_json);
      const recordCount = (value: Record<string, unknown>) =>
        ["invoices", "suppliers", "messages"].reduce((count, key) => count + (Array.isArray(value[key]) ? (value[key] as unknown[]).length : 0), 0);
      if (recordCount(currentState) > 0 && recordCount(safeState) === 0) {
        database.exec("ROLLBACK");
        res.status(403).json({ error: "Solo administración puede vaciar todos los datos compartidos." });
        return;
      }
    }
    const revision = currentRevision + 1;
    const updatedAt = new Date().toISOString();
    if (!current) {
      if (res.locals.authUser?.role !== "admin") {
        database.exec("ROLLBACK");
        res.status(403).json({ error: "La cuenta administradora debe iniciar la base compartida." });
        return;
      }
      database.prepare("INSERT INTO app_state (id, revision, state_json, updated_at) VALUES (1, ?, ?, ?)")
        .run(revision, stateJson, updatedAt);
    } else {
      database.prepare("UPDATE app_state SET revision = ?, state_json = ?, updated_at = ? WHERE id = 1")
        .run(revision, stateJson, updatedAt);
    }
    database.exec("COMMIT");
    res.json({ revision, updatedAt });
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch {}
    throw error;
  }
});

router.post("/state/resolve", requireAdmin, (req, res): void => {
  const state = req.body?.state;
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    res.status(400).json({ error: "La copia local no tiene un formato válido." });
    return;
  }
  const stateJson = JSON.stringify(safeSharedState(state));
  if (Buffer.byteLength(stateJson, "utf8") > 25 * 1024 * 1024) {
    res.status(413).json({ error: "La copia local supera el límite de 25 MB." });
    return;
  }
  database.exec("BEGIN IMMEDIATE");
  try {
    const current = database.prepare("SELECT revision FROM app_state WHERE id = 1").get() as { revision: number } | undefined;
    const revision = (current?.revision ?? 0) + 1;
    const updatedAt = new Date().toISOString();
    database.prepare(`
      INSERT INTO app_state (id, revision, state_json, updated_at) VALUES (1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, state_json = excluded.state_json, updated_at = excluded.updated_at
    `).run(revision, stateJson, updatedAt);
    database.exec("COMMIT");
    res.json({ revision, updatedAt });
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch {}
    throw error;
  }
});

export default router;
