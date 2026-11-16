import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { createSession, requireUser, safeUser, verifyPassword } from "../lib/auth";
import { database } from "../lib/storage";

const router: IRouter = Router();
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const attempts = new Map<string, { count: number; until: number }>();

type WebAuthnContext = { origin: string; rpID: string };
type ChallengeRow = {
  challenge: string;
  user_id: string | null;
  purpose: "registration" | "authentication";
  origin: string;
  rp_id: string;
  expires_at: number;
};

function rateLimited(key: string, limit: number): boolean {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.until <= now) {
    attempts.set(key, { count: 1, until: now + 15 * 60 * 1000 });
    return false;
  }
  entry.count += 1;
  return entry.count > limit;
}

function webAuthnContext(req: Request, res: Response): WebAuthnContext | null {
  const rawOrigin = req.get("origin");
  if (!rawOrigin) {
    res.status(400).json({ error: "No se pudo comprobar el origen seguro de la aplicación." });
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(rawOrigin);
  } catch {
    res.status(400).json({ error: "El origen de la aplicación no es válido." });
    return null;
  }

  if (parsed.origin !== rawOrigin || parsed.username || parsed.password) {
    res.status(400).json({ error: "El origen de la aplicación no es válido." });
    return null;
  }

  const forwardedHost = req.get("x-forwarded-host")?.split(",")[0]?.trim();
  const requestHost = (forwardedHost || req.get("host") || "").toLowerCase();
  if (!requestHost || parsed.host.toLowerCase() !== requestHost) {
    res.status(403).json({ error: "El origen de la solicitud no coincide con esta aplicación." });
    return null;
  }

  const isLoopbackHttp = parsed.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname.toLowerCase());
  if (parsed.protocol !== "https:" && !isLoopbackHttp) {
    res.status(400).json({ error: "Para usar el acceso biométrico desde el móvil, la aplicación debe abrirse con HTTPS." });
    return null;
  }

  const configuredOrigin = process.env.WEBAUTHN_ORIGIN || process.env.APP_PUBLIC_URL || "";
  if (configuredOrigin) {
    try {
      if (new URL(configuredOrigin).origin !== parsed.origin) {
        res.status(403).json({ error: "El origen no coincide con la dirección configurada para Agrosabina." });
        return null;
      }
    } catch {
      res.status(500).json({ error: "La dirección pública configurada para Agrosabina no es válida." });
      return null;
    }
  }

  const rpID = (process.env.WEBAUTHN_RP_ID || parsed.hostname).toLowerCase();
  const hostname = parsed.hostname.toLowerCase();
  if (hostname !== rpID && !hostname.endsWith(`.${rpID}`)) {
    res.status(500).json({ error: "El dominio configurado para el acceso biométrico no coincide con la aplicación." });
    return null;
  }

  return { origin: parsed.origin, rpID };
}

function saveChallenge(
  flowId: string,
  challenge: string,
  userId: string | null,
  purpose: ChallengeRow["purpose"],
  context: WebAuthnContext,
): void {
  const now = Date.now();
  database.prepare("DELETE FROM webauthn_challenges WHERE expires_at <= ?").run(now);
  database.prepare(`
    INSERT INTO webauthn_challenges (flow_id, challenge, user_id, purpose, origin, rp_id, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(flowId, challenge, userId, purpose, context.origin, context.rpID, now + CHALLENGE_TTL_MS);
}

function consumeChallenge(flowId: string, purpose: ChallengeRow["purpose"]): ChallengeRow | undefined {
  const now = Date.now();
  const row = database.prepare(`
    SELECT challenge, user_id, purpose, origin, rp_id, expires_at
    FROM webauthn_challenges
    WHERE flow_id = ? AND purpose = ? AND expires_at > ?
  `).get(flowId, purpose, now) as ChallengeRow | undefined;
  if (!row) {
    database.prepare("DELETE FROM webauthn_challenges WHERE flow_id = ? AND expires_at <= ?").run(flowId, now);
    return undefined;
  }
  database.prepare("DELETE FROM webauthn_challenges WHERE flow_id = ?").run(flowId);
  return row;
}

function parseTransports(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

router.get("/auth/passkeys", requireUser, (_req, res) => {
  const userId = res.locals.authUser.id as string;
  const row = database.prepare("SELECT COUNT(*) AS count FROM passkeys WHERE user_id = ?")
    .get(userId) as { count: number };
  res.json({ count: row.count });
});

router.post("/auth/passkeys/register/options", requireUser, async (req, res): Promise<void> => {
  const context = webAuthnContext(req, res);
  if (!context) return;

  const userId = res.locals.authUser.id as string;
  const key = `register:${req.ip}:${userId}`;
  if (rateLimited(key, 8)) {
    res.status(429).json({ error: "Has solicitado demasiados intentos. Espera 15 minutos." });
    return;
  }

  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const user = database.prepare("SELECT id, email, name, password_hash FROM users WHERE id = ? AND active = 1")
    .get(userId) as { id: string; email: string; name: string; password_hash: string } | undefined;
  if (!user || password.length > 256 || !(await verifyPassword(password, user.password_hash))) {
    res.status(401).json({ error: "La contraseña actual no es correcta." });
    return;
  }

  const existing = database.prepare("SELECT credential_id, transports_json FROM passkeys WHERE user_id = ?")
    .all(userId) as { credential_id: string; transports_json: string }[];
  const options = await generateRegistrationOptions({
    rpName: "Agrosabina",
    rpID: context.rpID,
    userName: user.email,
    userDisplayName: user.name,
    userID: new TextEncoder().encode(user.id),
    attestationType: "none",
    authenticatorSelection: {
      authenticatorAttachment: "platform",
      residentKey: "required",
      userVerification: "required",
    },
    preferredAuthenticatorType: "localDevice",
    excludeCredentials: existing.map((credential) => ({
      id: credential.credential_id,
      transports: parseTransports(credential.transports_json),
    })),
  });

  const flowId = randomUUID();
  saveChallenge(flowId, options.challenge, userId, "registration", context);
  res.json({ flowId, options });
});

router.post("/auth/passkeys/register/verify", requireUser, async (req, res): Promise<void> => {
  const context = webAuthnContext(req, res);
  if (!context) return;

  const flowId = typeof req.body?.flowId === "string" ? req.body.flowId.slice(0, 64) : "";
  const response = req.body?.credential as RegistrationResponseJSON | undefined;
  if (!flowId || !response || typeof response.id !== "string" || response.id.length > 2048) {
    res.status(400).json({ error: "No se recibió una respuesta válida del dispositivo." });
    return;
  }

  const challenge = consumeChallenge(flowId, "registration");
  const userId = res.locals.authUser.id as string;
  if (!challenge || challenge.user_id !== userId || challenge.origin !== context.origin || challenge.rp_id !== context.rpID) {
    res.status(400).json({ error: "La solicitud ha caducado. Vuelve a iniciar la activación." });
    return;
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: challenge.origin,
      expectedRPID: challenge.rp_id,
      requireUserVerification: true,
    });
  } catch (error) {
    req.log.warn({ err: error }, "Passkey registration could not be verified");
    res.status(400).json({ error: "No se pudo validar el acceso biométrico del dispositivo." });
    return;
  }
  if (!verification.verified) {
    res.status(400).json({ error: "No se pudo validar el acceso biométrico del dispositivo." });
    return;
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  try {
    database.prepare(`
      INSERT INTO passkeys (credential_id, user_id, public_key, counter, transports_json, device_type, backed_up, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      credential.id,
      userId,
      Buffer.from(credential.publicKey),
      credential.counter,
      JSON.stringify(credential.transports || []),
      credentialDeviceType,
      credentialBackedUp ? 1 : 0,
      new Date().toISOString(),
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) {
      res.status(409).json({ error: "Este acceso ya está vinculado a una cuenta." });
      return;
    }
    throw error;
  }

  const row = database.prepare("SELECT COUNT(*) AS count FROM passkeys WHERE user_id = ?")
    .get(userId) as { count: number };
  res.status(201).json({ success: true, count: row.count });
});

router.post("/auth/passkeys/authenticate/options", async (req, res): Promise<void> => {
  const context = webAuthnContext(req, res);
  if (!context) return;

  const key = `authenticate-options:${req.ip}`;
  if (rateLimited(key, 20)) {
    res.status(429).json({ error: "Demasiados intentos. Espera 15 minutos antes de volver a probar." });
    return;
  }

  const options = await generateAuthenticationOptions({
    rpID: context.rpID,
    userVerification: "required",
    allowCredentials: [],
  });
  const flowId = randomUUID();
  saveChallenge(flowId, options.challenge, null, "authentication", context);
  res.json({ flowId, options });
});

router.post("/auth/passkeys/authenticate/verify", async (req, res): Promise<void> => {
  const context = webAuthnContext(req, res);
  if (!context) return;

  const key = `authenticate-verify:${req.ip}`;
  if (rateLimited(key, 8)) {
    res.status(429).json({ error: "Demasiados intentos. Espera 15 minutos antes de volver a probar." });
    return;
  }

  const flowId = typeof req.body?.flowId === "string" ? req.body.flowId.slice(0, 64) : "";
  const response = req.body?.credential as AuthenticationResponseJSON | undefined;
  if (!flowId || !response || typeof response.id !== "string" || response.id.length > 2048) {
    res.status(400).json({ error: "No se recibió una respuesta válida del dispositivo." });
    return;
  }

  const challenge = consumeChallenge(flowId, "authentication");
  if (!challenge || challenge.user_id !== null || challenge.origin !== context.origin || challenge.rp_id !== context.rpID) {
    res.status(400).json({ error: "La solicitud ha caducado. Vuelve a intentarlo." });
    return;
  }

  const passkey = database.prepare(`
    SELECT passkeys.credential_id, passkeys.user_id, passkeys.public_key, passkeys.counter,
           passkeys.transports_json, users.id, users.email, users.name, users.role, users.active
    FROM passkeys JOIN users ON users.id = passkeys.user_id
    WHERE passkeys.credential_id = ? AND users.active = 1
  `).get(response.id) as {
    credential_id: string;
    user_id: string;
    public_key: Uint8Array;
    counter: number;
    transports_json: string;
    id: string;
    email: string;
    name: string;
    role: "admin" | "user";
    active: number;
  } | undefined;
  if (!passkey) {
    res.status(401).json({ error: "No se pudo validar el acceso en este dispositivo. Usa tu contraseña." });
    return;
  }

  const expectedUserHandle = Buffer.from(passkey.user_id).toString("base64url");
  if (response.response.userHandle && response.response.userHandle !== expectedUserHandle) {
    res.status(401).json({ error: "No se pudo validar el acceso en este dispositivo. Usa tu contraseña." });
    return;
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: challenge.origin,
      expectedRPID: challenge.rp_id,
      requireUserVerification: true,
      credential: {
        id: passkey.credential_id,
        publicKey: new Uint8Array(passkey.public_key),
        counter: passkey.counter,
        transports: parseTransports(passkey.transports_json),
      },
    });
  } catch (error) {
    req.log.warn({ err: error }, "Passkey authentication could not be verified");
    res.status(401).json({ error: "No se pudo validar el acceso en este dispositivo. Usa tu contraseña." });
    return;
  }

  if (!verification.verified || !verification.authenticationInfo.userVerified) {
    res.status(401).json({ error: "No se pudo validar el acceso en este dispositivo. Usa tu contraseña." });
    return;
  }

  database.prepare("UPDATE passkeys SET counter = ?, last_used_at = ? WHERE credential_id = ?")
    .run(verification.authenticationInfo.newCounter, new Date().toISOString(), passkey.credential_id);
  attempts.delete(key);
  createSession(req, res, passkey.user_id);
  res.json({ user: safeUser(passkey) });
});

export default router;
