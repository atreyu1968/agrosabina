import { database, decryptSecret, encryptSecret } from "./storage";

export type ResendSettings = { configured: boolean; fromEmail: string; publicUrl: string };

function readSetting(key: string): string {
  const row = database.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value || "";
}

function writeSetting(key: string, value: string): void {
  database.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, value);
}

export function getResendSettings(): ResendSettings {
  const encryptedKey = readSetting("resend_api_key");
  return {
    configured: !!encryptedKey && !!readSetting("resend_from"),
    fromEmail: readSetting("resend_from"),
    publicUrl: readSetting("app_public_url"),
  };
}

export function updateResendSettings(input: { apiKey?: string; fromEmail: string; publicUrl?: string; clearApiKey?: boolean }): ResendSettings {
  const fromEmail = input.fromEmail.trim();
  const publicUrl = String(input.publicUrl || "").trim().replace(/\/+$/, "");
  if (!/^[^<>\r\n]+@[^<>\r\n]+\.[^<>\r\n]+$/.test(fromEmail) && !/^.+\s<[^<>\r\n]+@[^<>\r\n]+\.[^<>\r\n]+>$/.test(fromEmail)) {
    throw new Error("Escribe un remitente válido, por ejemplo Agrosabina <avisos@tudominio.es>.");
  }
  if (publicUrl) {
    try {
      const parsed = new URL(publicUrl);
      if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error();
    } catch {
      throw new Error("La dirección pública debe ser una URL válida que empiece por http:// o https://.");
    }
  }
  if (input.clearApiKey) {
    database.prepare("DELETE FROM app_settings WHERE key = 'resend_api_key'").run();
  } else if (input.apiKey?.trim()) {
    const apiKey = input.apiKey.trim();
    if (apiKey.length > 500 || !apiKey.startsWith("re_")) throw new Error("La clave de Resend no tiene un formato válido.");
    writeSetting("resend_api_key", encryptSecret(apiKey));
  }
  writeSetting("resend_from", fromEmail);
  writeSetting("app_public_url", publicUrl);
  return getResendSettings();
}

export async function sendEmail(input: { to: string; subject: string; text: string; html: string }): Promise<void> {
  const encryptedKey = readSetting("resend_api_key");
  const from = readSetting("resend_from");
  if (!encryptedKey || !from) throw new Error("Resend todavía no está configurado.");
  const apiKey = decryptSecret(encryptedKey);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: [input.to], subject: input.subject, text: input.text, html: input.html }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    // Do not include the provider response body; it can contain account details.
    throw new Error(`Resend rechazó el envío (HTTP ${response.status}).`);
  }
}
