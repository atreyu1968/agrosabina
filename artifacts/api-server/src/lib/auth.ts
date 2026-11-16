import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { database } from "./storage";

const SESSION_COOKIE = "agrosabina_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: "admin" | "user";
  active: boolean;
};

type UserRow = {
  id: string;
  email: string;
  name: string;
  role: "admin" | "user";
  active: number;
};

export function safeUser(row: UserRow): AuthUser {
  return { id: row.id, email: row.email, name: row.name, role: row.role, active: row.active === 1 };
}

export function normalizeEmail(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

export function validEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function validPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= 12 && value.length <= 256;
}

function scrypt(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt);
  return `scrypt$32768$8$1$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, n, r, p, saltText, hashText] = stored.split("$");
  if (algorithm !== "scrypt" || n !== "32768" || r !== "8" || p !== "1" || !saltText || !hashText) return false;
  const expected = Buffer.from(hashText, "base64url");
  const candidate = await scrypt(password, Buffer.from(saltText, "base64url"));
  return expected.length === candidate.length && timingSafeEqual(expected, candidate);
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

function readCookie(req: Request, key: string): string {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === key) {
      try {
        return decodeURIComponent(rest.join("="));
      } catch {
        return "";
      }
    }
  }
  return "";
}

function setSessionCookie(req: Request, res: Response, token: string): void {
  const secure = req.secure || process.env.COOKIE_SECURE === "true";
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS,
  });
}

export function createSession(req: Request, res: Response, userId: string): void {
  const token = randomToken();
  const now = Date.now();
  database.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
  database.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .run(tokenHash(token), userId, now + SESSION_TTL_MS, now);
  setSessionCookie(req, res, token);
}

export function currentUser(req: Request): AuthUser | null {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const row = database.prepare(`
    SELECT users.id, users.email, users.name, users.role, users.active
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND users.active = 1
  `).get(tokenHash(token), Date.now()) as UserRow | undefined;
  return row ? safeUser(row) : null;
}

export function clearSession(req: Request, res: Response): void {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) database.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash(token));
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: req.secure || process.env.COOKIE_SECURE === "true",
    sameSite: "lax",
    path: "/",
  });
}

export function requireUser(req: Request, res: Response, next: NextFunction): void {
  const user = currentUser(req);
  if (!user) {
    res.status(401).json({ error: "Inicia sesión para continuar." });
    return;
  }
  res.locals.authUser = user;
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const user = currentUser(req);
  if (!user) {
    res.status(401).json({ error: "Inicia sesión para continuar." });
    return;
  }
  if (user.role !== "admin") {
    res.status(403).json({ error: "Solo la cuenta administradora puede hacer esto." });
    return;
  }
  res.locals.authUser = user;
  next();
}

export function requireSameOrigin(req: Request, res: Response, next: NextFunction): void {
  const origin = req.get("origin");
  if (!origin) {
    next();
    return;
  }
  try {
    const parsed = new URL(origin);
    const forwardedHost = req.get("x-forwarded-host");
    const expectedHost = forwardedHost || req.get("host");
    if (parsed.host !== expectedHost) {
      res.status(403).json({ error: "Origen de solicitud no permitido." });
      return;
    }
  } catch {
    res.status(403).json({ error: "Origen de solicitud no permitido." });
    return;
  }
  next();
}

export function removeUserSessions(userId: string): void {
  database.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  database.prepare("DELETE FROM password_resets WHERE user_id = ?").run(userId);
}
