import { randomUUID, timingSafeEqual } from "node:crypto";
import { Router, type IRouter } from "express";
import {
  clearSession,
  createSession,
  currentUser,
  hashPassword,
  normalizeEmail,
  randomToken,
  safeUser,
  tokenHash,
  validEmail,
  validPassword,
  verifyPassword,
} from "../lib/auth";
import { database } from "../lib/storage";
import { getResendSettings, sendEmail } from "../lib/email";

const router: IRouter = Router();
const attempts = new Map<string, { count: number; until: number }>();
const genericResetMessage = "Si existe una cuenta con ese correo, recibirás instrucciones para recuperar el acceso.";
const WINDOW_MS = 15 * 60 * 1000;

function rateLimited(key: string, limit: number): boolean {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.until <= now) {
    attempts.set(key, { count: 1, until: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > limit;
}

router.get("/auth/status", (req, res) => {
  const userCount = (database.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number }).count;
  const user = currentUser(req);
  res.json({
    setupRequired: userCount === 0,
    setupTokenRequired: userCount === 0 && (process.env.NODE_ENV === "production" || !!process.env.APP_SETUP_TOKEN),
    setupTokenConfigured: !!process.env.APP_SETUP_TOKEN,
    authenticated: !!user,
    user: user ? { id: user.id, name: user.name, email: user.email, role: user.role } : null,
    recoveryConfigured: getResendSettings().configured,
  });
});

router.post("/auth/setup", async (req, res): Promise<void> => {
  if (rateLimited(`setup:${req.ip}`, 8)) {
    res.status(429).json({ error: "Demasiados intentos. Espera 15 minutos antes de volver a probar." });
    return;
  }
  const setupToken = process.env.APP_SETUP_TOKEN || "";
  if (process.env.NODE_ENV === "production" && !setupToken) {
    res.status(503).json({ error: "Falta configurar el código de instalación en el servidor." });
    return;
  }
  if (setupToken || process.env.NODE_ENV === "production") {
    const supplied = String(req.body?.setupToken || "");
    const expectedBytes = Buffer.from(setupToken);
    const suppliedBytes = Buffer.from(supplied);
    if (!setupToken || expectedBytes.length !== suppliedBytes.length || !timingSafeEqual(expectedBytes, suppliedBytes)) {
      res.status(403).json({ error: "El código de instalación no es válido." });
      return;
    }
  }
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
    database.exec("BEGIN IMMEDIATE");
    const count = (database.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number }).count;
    if (count > 0) {
      database.exec("ROLLBACK");
      res.status(409).json({ error: "La instalación ya tiene una cuenta administradora." });
      return;
    }
    database.prepare("INSERT INTO users (id, email, name, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, 'admin', 1, ?)")
      .run(id, email, name, passwordHash, new Date().toISOString());
    database.exec("COMMIT");
    createSession(req, res, id);
    res.status(201).json({ user: { id, name, email, role: "admin" } });
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch {}
    if (error instanceof Error && error.message.includes("UNIQUE")) {
      res.status(409).json({ error: "Ese correo ya está registrado." });
      return;
    }
    throw error;
  }
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const email = normalizeEmail(req.body?.email);
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const rateKey = `${req.ip}:${email.slice(0, 254)}`;
  if (rateLimited(rateKey, 8)) {
    res.status(429).json({ error: "Demasiados intentos. Espera 15 minutos antes de volver a probar." });
    return;
  }
  const row = database.prepare("SELECT id, email, name, role, active, password_hash FROM users WHERE email = ? COLLATE NOCASE")
    .get(email) as ({ id: string; email: string; name: string; role: "admin" | "user"; active: number; password_hash: string } | undefined);
  const passwordOk = row
    ? (password.length <= 256 && await verifyPassword(password, row.password_hash))
    : (await hashPassword(password.slice(0, 256)), false);
  if (!row || row.active !== 1 || !passwordOk) {
    res.status(401).json({ error: "Correo o contraseña incorrectos." });
    return;
  }
  attempts.delete(rateKey);
  createSession(req, res, row.id);
  res.json({ user: safeUser(row) });
});

router.post("/auth/logout", (req, res) => {
  clearSession(req, res);
  res.json({ success: true });
});

router.post("/auth/password/request", async (req, res): Promise<void> => {
  if (rateLimited(`reset:${req.ip}`, 5)) {
    res.status(429).json({ message: "Has solicitado demasiados enlaces. Espera 15 minutos y vuelve a probar." });
    return;
  }
  const email = normalizeEmail(req.body?.email);
  if (!validEmail(email)) {
    res.json({ message: genericResetMessage });
    return;
  }
  const user = database.prepare("SELECT id, email, name FROM users WHERE email = ? COLLATE NOCASE AND active = 1")
    .get(email) as { id: string; email: string; name: string } | undefined;
  const mailSettings = getResendSettings();
  if (user && mailSettings.configured) {
    const token = randomToken();
    database.prepare("DELETE FROM password_resets WHERE user_id = ?").run(user.id);
    database.prepare("INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
      .run(tokenHash(token), user.id, Date.now() + 30 * 60 * 1000);
    const baseUrl = (process.env.APP_PUBLIC_URL || mailSettings.publicUrl || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
    const resetUrl = new URL("/", `${baseUrl}/`);
    resetUrl.searchParams.set("reset", token);
    try {
      await sendEmail({
        to: user.email,
        subject: "Recupera tu acceso a Agrosabina",
        text: `Hola ${user.name}, abre este enlace en los próximos 30 minutos para cambiar tu contraseña: ${resetUrl.toString()}`,
        html: `<p>Hola ${escapeHtml(user.name)},</p><p>Has solicitado cambiar tu contraseña de Agrosabina. El enlace caduca en 30 minutos.</p><p><a href="${escapeHtml(resetUrl.toString())}">Crear una contraseña nueva</a></p><p>Si no solicitaste este cambio, puedes ignorar este correo.</p>`,
      });
    } catch (error) {
      database.prepare("DELETE FROM password_resets WHERE token_hash = ?").run(tokenHash(token));
      req.log.warn({ err: error }, "Password recovery email could not be sent");
    }
  }
  res.json({ message: genericResetMessage });
});

router.post("/auth/password/reset", async (req, res): Promise<void> => {
  const token = typeof req.body?.token === "string" ? req.body.token : "";
  const password = req.body?.password;
  if (token.length < 32 || token.length > 200 || !validPassword(password)) {
    res.status(400).json({ error: "El enlace o la contraseña no son válidos." });
    return;
  }
  const hashedToken = tokenHash(token);
  const row = database.prepare("SELECT user_id FROM password_resets WHERE token_hash = ? AND expires_at > ?")
    .get(hashedToken, Date.now()) as { user_id: string } | undefined;
  if (!row) {
    res.status(400).json({ error: "El enlace ha caducado o ya se utilizó. Solicita uno nuevo." });
    return;
  }
  const passwordHash = await hashPassword(password);
  database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare("UPDATE users SET password_hash = ? WHERE id = ? AND active = 1").run(passwordHash, row.user_id);
    database.prepare("DELETE FROM password_resets WHERE user_id = ?").run(row.user_id);
    database.prepare("DELETE FROM sessions WHERE user_id = ?").run(row.user_id);
    database.exec("COMMIT");
    res.json({ success: true });
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
});

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] || character);
}

export default router;
