/*
 * Acceso directo a Gmail desde la PWA.
 *
 * Solo solicita gmail.readonly. El token vive en memoria y nunca se guarda en
 * SQLite, IndexedDB ni localStorage. La lectura de correos siempre la inicia
 * el usuario desde la pantalla Correo.
 */

const GOOGLE_SCRIPT = "https://accounts.google.com/gsi/client";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const MAX_RESULTS = 10;
const MAX_LIST_PAGE_SIZE = 500;
const MAX_LIST_PAGES = 20;
const MAX_RAW_MESSAGE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_RAW_BYTES = 30 * 1024 * 1024;

let scriptPromise = null;
let accessToken = "";
let accessTokenExpiresAt = 0;
let connectedEmail = "";
let pendingAuthorization = null;

function googleIdentity() {
  return typeof window !== "undefined" ? window.google?.accounts?.oauth2 : null;
}

function clearAccessToken() {
  accessToken = "";
  accessTokenExpiresAt = 0;
  connectedEmail = "";
}

export function gmailStatus(clientId = "") {
  if (accessToken && Date.now() >= accessTokenExpiresAt) clearAccessToken();
  return {
    configured: !!String(clientId || "").trim(),
    ready: !!googleIdentity(),
    connected: !!accessToken,
    email: connectedEmail,
  };
}

export function prepareGmail(clientId = "") {
  if (!String(clientId || "").trim()) return Promise.resolve(false);
  if (googleIdentity()) return Promise.resolve(true);
  if (scriptPromise) return scriptPromise;
  if (typeof document === "undefined") {
    return Promise.reject(new Error("Gmail solo se puede conectar desde la aplicación web."));
  }

  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector("script[data-agrosabina-google-identity]");
    const script = existing || document.createElement("script");
    const onLoad = () => {
      if (googleIdentity()) resolve(true);
      else reject(new Error("Google no ha preparado la autorización. Recarga la aplicación y prueba otra vez."));
    };
    const onError = () => reject(new Error("No he podido cargar la conexión segura de Google."));

    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener("error", onError, { once: true });
    if (!existing) {
      script.src = GOOGLE_SCRIPT;
      script.async = true;
      script.defer = true;
      script.dataset.agrosabinaGoogleIdentity = "true";
      document.head.appendChild(script);
    } else if (googleIdentity()) {
      resolve(true);
    }
  }).catch((error) => {
    scriptPromise = null;
    throw error;
  });

  return scriptPromise;
}

export function connectGmail(clientId = "") {
  const oauthClientId = String(clientId || "").trim();
  if (!oauthClientId) {
    return Promise.reject(new Error("Falta configurar el Client ID OAuth de Google."));
  }
  const identity = googleIdentity();
  if (!identity) {
    return Promise.reject(new Error("La conexión de Google aún se está preparando."));
  }
  if (pendingAuthorization) return pendingAuthorization.promise;

  let resolveAuthorization;
  let rejectAuthorization;
  const promise = new Promise((resolve, reject) => {
    resolveAuthorization = resolve;
    rejectAuthorization = reject;
  });
  pendingAuthorization = { promise, resolve: resolveAuthorization, reject: rejectAuthorization };

  const rejectPending = (error) => {
    const pending = pendingAuthorization;
    pendingAuthorization = null;
    clearAccessToken();
    pending?.reject(error instanceof Error ? error : new Error("No se pudo autorizar Gmail."));
  };

  try {
    const client = identity.initTokenClient({
      client_id: oauthClientId,
      scope: GMAIL_READONLY_SCOPE,
      callback: async (response) => {
        if (response?.error || !response?.access_token) {
          rejectPending(new Error(response?.error_description || "No se autorizó el acceso a Gmail."));
          return;
        }

        accessToken = response.access_token;
        accessTokenExpiresAt = Date.now() + Math.max(1, Number(response.expires_in) || 3600) * 1000;
        try {
          const profile = await gmailRequest("/profile");
          connectedEmail = String(profile.emailAddress || "");
          const pending = pendingAuthorization;
          pendingAuthorization = null;
          pending?.resolve({ email: connectedEmail });
        } catch (error) {
          rejectPending(error);
        }
      },
      error_callback: (error) => {
        rejectPending(new Error(error?.message || "No se pudo abrir la autorización de Google."));
      },
    });

    // Se ejecuta directamente desde el botón que pulsó el usuario.
    client.requestAccessToken({ prompt: "consent select_account" });
  } catch (error) {
    rejectPending(error);
  }

  return promise;
}

export async function disconnectGmail() {
  const token = accessToken;
  clearAccessToken();
  if (!token || !googleIdentity()?.revoke) return;

  await new Promise((resolve) => {
    googleIdentity().revoke(token, () => resolve());
  });
}

async function gmailRequest(path) {
  if (!accessToken || Date.now() >= accessTokenExpiresAt) {
    clearAccessToken();
    throw new Error("La autorización de Gmail ha caducado. Conecta la cuenta otra vez.");
  }

  const response = await fetch(`${GMAIL_API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  if (response.status === 401) {
    clearAccessToken();
    throw new Error("La autorización de Gmail ha caducado. Conecta la cuenta otra vez.");
  }
  if (!response.ok) {
    throw new Error(payload.error?.message || `Gmail respondió con el error ${response.status}.`);
  }
  return payload;
}

export function decodeGmailRaw(raw) {
  const base64 = String(raw || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(String(raw || "").length / 4) * 4, "=");
  if (!base64) return "";

  let bytes;
  if (typeof atob === "function") {
    const binary = atob(base64);
    bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } else if (typeof Buffer !== "undefined") {
    bytes = new Uint8Array(Buffer.from(base64, "base64"));
  } else {
    throw new Error("Este navegador no puede descodificar los correos de Gmail.");
  }
  return new TextDecoder("utf-8").decode(bytes);
}

export async function fetchRecentGmailFiles(importedIds = []) {
  const alreadyImported = new Set(Array.isArray(importedIds) ? importedIds : []);
  const found = [];
  const newMessages = [];
  let pageToken = "";
  let pagesScanned = 0;

  while (pagesScanned < MAX_LIST_PAGES && newMessages.length < MAX_RESULTS) {
    const params = new URLSearchParams({
      q: "has:attachment newer_than:90d",
      maxResults: String(MAX_LIST_PAGE_SIZE),
    });
    if (pageToken) params.set("pageToken", pageToken);
    const page = await gmailRequest(`/messages?${params}`);
    const messages = Array.isArray(page.messages) ? page.messages : [];
    found.push(...messages);
    for (const message of messages) {
      if (message.id && !alreadyImported.has(message.id)) newMessages.push(message);
      if (newMessages.length >= MAX_RESULTS) break;
    }
    pageToken = page.nextPageToken || "";
    pagesScanned++;
    if (!pageToken) break;
  }

  const files = [];
  let skippedLarge = 0;
  let skippedMalformed = 0;
  let totalRawBytes = 0;

  for (const summary of newMessages.slice(0, MAX_RESULTS)) {
    const message = await gmailRequest(`/messages/${encodeURIComponent(summary.id)}?format=raw`);
    if (!message.raw) {
      skippedMalformed++;
      continue;
    }
    const estimatedBytes = message.raw.length * 0.75;
    if (estimatedBytes > MAX_RAW_MESSAGE_BYTES || totalRawBytes + estimatedBytes > MAX_TOTAL_RAW_BYTES) {
      skippedLarge++;
      continue;
    }
    totalRawBytes += estimatedBytes;
    const raw = decodeGmailRaw(message.raw);
    if (!raw.trim()) {
      skippedMalformed++;
      continue;
    }
    const file = new File([raw], `gmail-${summary.id}.eml`, { type: "message/rfc822" });
    Object.defineProperty(file, "gmailMessageId", { value: summary.id });
    files.push(file);
  }

  return {
    files,
    foundCount: found.length,
    alreadyImportedCount: found.filter((message) => message.id && alreadyImported.has(message.id)).length,
    skippedLarge,
    skippedMalformed,
    hasMore: !!pageToken || found.filter((message) => message.id && !alreadyImported.has(message.id)).length > MAX_RESULTS,
  };
}
