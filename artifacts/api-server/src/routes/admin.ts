import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { hashPassword, normalizeEmail, requireAdmin, validEmail, validPassword, removeUserSessions } from "../lib/auth";
import { getResendSettings, sendEmail, updateResendSettings } from "../lib/email";
import { database } from "../lib/storage";

const router: IRouter = Router();
router.use(requireAdmin);

router.get("/admin/users", (_req, res) => {
  const users = database.prepare(`
    SELECT id, email, name, role, active, created_at AS createdAt
    FROM users
    ORDER BY role = 'admin' DESC, name COLLATE NOCASE
  `).all();
  res.json({ users });
});

router.post("/admin/users", async (req, res): Promise<void> => {
  const name = String(req.body?.name || "").trim().slice(0, 120);
  const email = normalizeEmail(req.body?.email);
  const password = req.body?.password;
  if (!name || !validEmail(email) || !validPassword(password)) {
    res.status(400).json({ error: "Indica nombre, correo válido y una contraseña de al menos 12 caracteres." });
    return;
  }
  const passwordHash = await hashPassword(password);
  const id = randomUUID();
  try {
    database.prepare("INSERT INTO users (id, email, name, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, 'user', 1, ?)")
      .run(id, email, name, passwordHash, new Date().toISOString());
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) {
      res.status(409).json({ error: "Ya existe una cuenta con ese correo." });
      return;
    }
    throw error;
  }
  res.status(201).json({ user: { id, email, name, role: "user", active: true } });
});

router.patch("/admin/users/:id", (req, res): void => {
  const id = String(req.params.id || "");
  const active = req.body?.active;
  if (!/^[0-9a-f-]{36}$/i.test(id) || typeof active !== "boolean") {
    res.status(400).json({ error: "La cuenta o el estado no son válidos." });
    return;
  }
  const target = database.prepare("SELECT role FROM users WHERE id = ?").get(id) as { role: string } | undefined;
  if (!target) {
    res.status(404).json({ error: "No se encontró la cuenta." });
    return;
  }
  if (target.role === "admin") {
    res.status(400).json({ error: "La cuenta administradora no se puede desactivar desde aquí." });
    return;
  }
  database.prepare("UPDATE users SET active = ? WHERE id = ?").run(active ? 1 : 0, id);
  if (!active) removeUserSessions(id);
  res.json({ success: true });
});

router.get("/admin/mail", (_req, res) => {
  res.json(getResendSettings());
});

router.put("/admin/mail", (req, res): void => {
  try {
    const settings = updateResendSettings({
      apiKey: typeof req.body?.apiKey === "string" ? req.body.apiKey : "",
      fromEmail: String(req.body?.fromEmail || ""),
      publicUrl: String(req.body?.publicUrl || ""),
      clearApiKey: req.body?.clearApiKey === true,
    });
    res.json(settings);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "No se pudieron guardar los datos de Resend." });
  }
});

router.post("/admin/mail/test", async (req, res): Promise<void> => {
  const email = normalizeEmail(req.body?.email);
  if (!validEmail(email)) {
    res.status(400).json({ error: "Indica un correo válido para la prueba." });
    return;
  }
  try {
    await sendEmail({
      to: email,
      subject: "Prueba de correo de Agrosabina",
      text: "La configuración de correo de Agrosabina funciona.",
      html: "<p>La configuración de correo de Agrosabina funciona.</p>",
    });
  } catch (error) {
    req.log.warn({ err: error }, "Resend test email failed");
    res.status(502).json({ error: "No se pudo enviar el correo de prueba. Revisa la clave y el remitente de Resend." });
    return;
  }
  res.json({ success: true });
});

export default router;
