import { createHash, randomBytes } from "node:crypto";
import { createReadStream, existsSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import express from "express";
import { Router, type IRouter, type Request } from "express";
import { requireAdmin, requireUser } from "../lib/auth";
import { database, filesDirectory } from "../lib/storage";

const router: IRouter = Router();

function fileId(req: Request): string {
  const value = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(value) ? value : "";
}

function physicalPath(id: string): string {
  return path.join(filesDirectory, `${createHash("sha256").update(id).digest("hex")}.bin`);
}

router.get("/files", requireUser, (_req, res) => {
  const rows = database.prepare(`
    SELECT id, name, type, size, sha256, segment, saved_at AS savedAt
    FROM files ORDER BY saved_at, id
  `).all();
  res.json({ files: rows });
});

router.get("/files/summary", requireUser, (_req, res) => {
  const row = database.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(size), 0) AS bytes FROM files").get() as { count: number; bytes: number };
  res.json(row);
});

router.get("/files/:id", requireUser, (req, res): void => {
  const id = fileId(req);
  if (!id) {
    res.status(400).json({ error: "El identificador del documento no es válido." });
    return;
  }
  const row = database.prepare("SELECT name, type, size FROM files WHERE id = ?").get(id) as { name: string; type: string; size: number } | undefined;
  if (!row || !existsSync(physicalPath(id))) {
    res.status(404).json({ error: "No se encontró el original del documento." });
    return;
  }
  const safeName = encodeURIComponent(path.basename(row.name)).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16)}`);
  res.setHeader("Content-Type", row.type || "application/octet-stream");
  res.setHeader("Content-Length", row.size);
  res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${safeName}`);
  res.setHeader("X-File-Name", safeName);
  res.setHeader("X-File-Type", row.type || "application/octet-stream");
  const metadata = database.prepare("SELECT sha256, segment, saved_at FROM files WHERE id = ?").get(id) as { sha256: string; segment: string; saved_at: string };
  res.setHeader("X-File-Sha256", metadata.sha256);
  res.setHeader("X-File-Segment", encodeURIComponent(metadata.segment));
  res.setHeader("X-File-Saved-At", metadata.saved_at);
  res.setHeader("Cache-Control", "private, no-store");
  createReadStream(physicalPath(id)).pipe(res);
});

router.put("/files/:id", requireUser, express.raw({ type: "application/octet-stream", limit: "100mb" }), (req, res): void => {
  const id = fileId(req);
  if (!id || !Buffer.isBuffer(req.body) || req.body.length === 0 || req.body.length > 100 * 1024 * 1024) {
    res.status(400).json({ error: "El identificador o el fichero no son válidos." });
    return;
  }
  const nameHeader = String(req.get("x-file-name") || "documento");
  let name = "documento";
  try { name = decodeURIComponent(nameHeader).slice(0, 240) || name; } catch {}
  const type = String(req.get("x-file-type") || "application/octet-stream").slice(0, 160);
  const sha256 = createHash("sha256").update(req.body).digest("hex");
  const suppliedHash = String(req.get("x-file-sha256") || "").toLowerCase();
  if (suppliedHash && !/^[a-f0-9]{64}$/.test(suppliedHash)) {
    res.status(400).json({ error: "La huella del fichero no tiene un formato válido." });
    return;
  }
  if (suppliedHash && suppliedHash !== sha256) {
    res.status(400).json({ error: "La huella del fichero no coincide con su contenido." });
    return;
  }
  const segment = String(req.get("x-file-segment") || "1").slice(0, 100);
  const savedAt = new Date().toISOString();
  const destination = physicalPath(id);
  const temporary = `${destination}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    writeFileSync(temporary, req.body, { mode: 0o600, flag: "wx" });
    renameSync(temporary, destination);
    database.prepare(`
      INSERT INTO files (id, name, type, size, sha256, segment, saved_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name, type = excluded.type, size = excluded.size,
        sha256 = excluded.sha256, segment = excluded.segment, saved_at = excluded.saved_at
    `).run(id, name, type, req.body.length, sha256, segment, savedAt);
  } catch (error) {
    try { if (existsSync(temporary)) unlinkSync(temporary); } catch {}
    throw error;
  }
  res.status(201).json({ id, name, type, size: req.body.length, sha256, segment, savedAt });
});

router.delete("/files/:id", requireUser, (req, res): void => {
  const id = fileId(req);
  if (!id) {
    res.status(400).json({ error: "El identificador del documento no es válido." });
    return;
  }
  database.prepare("DELETE FROM files WHERE id = ?").run(id);
  const target = physicalPath(id);
  if (existsSync(target)) unlinkSync(target);
  res.json({ success: true });
});

router.delete("/files", requireAdmin, (_req, res) => {
  const rows = database.prepare("SELECT id FROM files").all() as { id: string }[];
  database.exec("DELETE FROM files");
  for (const row of rows) {
    const target = physicalPath(row.id);
    if (existsSync(target)) unlinkSync(target);
  }
  res.json({ success: true });
});

export default router;
