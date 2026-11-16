import test from "node:test";
import assert from "node:assert/strict";

import { buildGmailSearchQuery, gmailDateBounds, gmailMessageInRange, connectGmail, disconnectGmail, fetchRecentGmailFiles, decodeGmailRaw } from "../assets/js/gmail.js";
import { emailDocumentFiles, parseEml } from "../assets/js/mail.js";

test("decodifica el correo raw base64url de Gmail en UTF-8", () => {
  const expected = "From: tienda@example.com\r\nSubject: Factura ágil\r\n\r\nAdjunto factura.";
  const raw = Buffer.from(expected, "utf8").toString("base64url");
  assert.equal(decodeGmailRaw(raw), expected);
});

test("filtra Gmail por intervalo inclusivo y solo busca correos con adjuntos", () => {
  assert.equal(
    buildGmailSearchQuery({ from: "2026-10-01", to: "2026-10-31" }),
    `has:attachment after:${Date.parse("2026-09-30T23:00:00Z") / 1000 - 1} before:${Date.parse("2026-11-01T00:00:00Z") / 1000}`,
  );
  assert.throws(
    () => buildGmailSearchQuery({ from: "2026-11-01", to: "2026-10-31" }),
    /posterior/,
  );
});

test("ambos días completos, un solo día y cambios de horario de Canarias", () => {
  const sameDay = gmailDateBounds({ from: "2026-07-15", to: "2026-07-15" });
  assert.equal(sameDay.start, Date.parse("2026-07-14T23:00:00Z"));
  assert.equal(sameDay.end, Date.parse("2026-07-15T23:00:00Z"));
  assert.equal(gmailMessageInRange(sameDay.start - 1, sameDay), false);
  assert.equal(gmailMessageInRange(String(sameDay.start), sameDay), true);
  assert.equal(gmailMessageInRange(sameDay.end - 1, sameDay), true);
  assert.equal(gmailMessageInRange(sameDay.end, sameDay), false);
  assert.equal(gmailMessageInRange("", sameDay), false);
  assert.equal(gmailMessageInRange("sin fecha", sameDay), false);
  const spring = gmailDateBounds({ from: "2026-03-29", to: "2026-03-29" });
  assert.equal(spring.end - spring.start, 23 * 3600000);
  const autumn = gmailDateBounds({ from: "2026-10-25", to: "2026-10-25" });
  assert.equal(autumn.end - autumn.start, 25 * 3600000);
  const yearEnd = gmailDateBounds({ from: "2026-12-31", to: "2026-12-31" });
  assert.equal(yearEnd.end, Date.parse("2027-01-01T00:00:00Z"));
  assert.doesNotThrow(() => gmailDateBounds({ from: "2024-02-29", to: "2024-02-29" }));
  for (const invalid of ["2026-02-29", "2026-04-31", "2026-13-01", "2026-10", "ayer"]) {
    assert.throws(() => buildGmailSearchQuery({ from: invalid, to: "2026-12-31" }), /válida/);
  }
});

async function mockConnectedGmail(t, handler) {
  const previousWindow = globalThis.window;
  globalThis.window = { google: { accounts: { oauth2: {
    initTokenClient: (config) => ({
      requestAccessToken() { config.callback({ access_token: "synthetic-test-token", expires_in: 3600 }); },
    }),
    revoke: (_, callback) => callback(),
  } } } };
  t.mock.method(globalThis, "fetch", async (url) => ({
    ok: true, status: 200,
    json: async () => String(url).endsWith("/profile")
      ? { emailAddress: "synthetic@example.test" }
      : handler(new URL(url)),
  }));
  t.after(async () => {
    await disconnectGmail();
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  });
  await connectGmail("synthetic-client");
}

test("la descarga real del cliente incluye leídos y no leídos, excluye extremos exteriores y usa recepción", async (t) => {
  const range = { from: "2026-10-01", to: "2026-10-31" };
  const { start, end } = gmailDateBounds(range);
  const queries = [];
  const raw = Buffer.from("Date: Thu, 1 Jan 1998 00:00:00 +0000\r\nSubject: asunto sin relación con el intervalo\r\n\r\nSolo un mensaje sintético.").toString("base64url");
  const data = {
    opened: { internalDate: String(start), labelIds: ["INBOX"], raw },
    unread: { internalDate: String(end - 1), labelIds: ["INBOX", "UNREAD"], raw },
    previous: { internalDate: String(start - 1), raw },
    next: { internalDate: String(end), raw },
    undated: { raw },
  };
  await mockConnectedGmail(t, (url) => {
    if (url.pathname.endsWith("/messages")) {
      queries.push(url.searchParams.get("q"));
      return { messages: Object.keys(data).map((id) => ({ id })) };
    }
    return data[url.pathname.split("/").pop()];
  });
  const result = await fetchRecentGmailFiles([], range);
  assert.deepEqual(result.files.map((file) => file.gmailMessageId), ["opened", "unread"]);
  assert.deepEqual(result.messageIds, ["opened", "unread"]);
  assert.equal(result.skippedOutsideRange, 3);
  assert.equal(result.files[0].gmailReceivedAt, new Date(start).toISOString());
  assert.match(await result.files[0].text(), /1998/);
  assert.equal(queries[0], buildGmailSearchQuery(range));
  assert.doesNotMatch(queries[0], /is:(unread|read)|label:unread|-is:read/i);
});

test("carga 37 correos en lotes sucesivos, manteniendo intervalo y sin repetir pendientes ni revisados", async (t) => {
  const range = { from: "2026-01-01", to: "2026-01-31" };
  const { start } = gmailDateBounds(range);
  const queries = [];
  const downloaded = [];
  const raw = Buffer.from("Subject: adjunto sintético\r\n\r\nOriginal.").toString("base64url");
  const candidates = Array.from({ length: 37 }, (_, index) => ({ id: `message${index}` }));
  await mockConnectedGmail(t, (url) => {
    if (url.pathname.endsWith("/messages")) {
      queries.push(url.searchParams.get("q"));
      return url.searchParams.get("pageToken") === "page2"
        ? { messages: candidates }
        : { messages: [{ id: "previously-reviewed" }], nextPageToken: "page2" };
    }
    const id = url.pathname.split("/").pop();
    downloaded.push(id);
    return { internalDate: String(start + 1000), raw, labelIds: ["INBOX"] };
  });
  const pendingIds = [];
  const pendingFiles = [];
  for (const expectedCount of [10, 10, 10, 7]) {
    const result = await fetchRecentGmailFiles(["previously-reviewed", ...pendingIds], range);
    assert.equal(result.files.length, expectedCount);
    pendingIds.push(...result.messageIds);
    pendingFiles.push(...result.files);
    assert.equal(result.hasMore, pendingIds.length < 37);
  }
  assert.equal(pendingFiles.length, 37);
  assert.equal(new Set(downloaded).size, 37);
  assert.equal(downloaded.length, 37);
  const exhausted = await fetchRecentGmailFiles(["previously-reviewed", ...pendingIds], range);
  assert.equal(exhausted.files.length, 0);
  assert.equal(exhausted.hasMore, false);
  assert.equal(queries.length, 10);
  assert.ok(queries.every((query) => query === buildGmailSearchQuery(range)));
});

test("el correo raw de Gmail conserva el PDF para la revisión existente", async () => {
  const email = [
    "From: tienda@example.com",
    "Subject: Factura de prueba",
    'Content-Type: multipart/mixed; boundary="mail-boundary"',
    "",
    "--mail-boundary",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Adjuntamos la factura.",
    "--mail-boundary",
    "Content-Type: application/pdf; name=\"factura.pdf\"",
    "Content-Disposition: attachment; filename=\"factura.pdf\"",
    "Content-Transfer-Encoding: base64",
    "",
    "SGVsbG8=",
    "--mail-boundary--",
    "",
  ].join("\r\n");
  const raw = Buffer.from(email, "utf8").toString("base64url");
  const parsed = parseEml(decodeGmailRaw(raw), "gmail-test.eml");

  assert.equal(parsed.subject, "Factura de prueba");
  assert.equal(parsed.attachments.length, 1);
  assert.equal(parsed.attachments[0].name, "factura.pdf");
  assert.equal(new TextDecoder().decode(parsed.attachments[0].bytes), "Hello");
  const files = emailDocumentFiles(parsed);
  assert.equal(files.length, 1);
  assert.equal(files[0].name, "factura.pdf");
  assert.equal(await files[0].text(), "Hello");
});

test("nunca convierte el cuerpo, asunto o firma del correo en documento importable", () => {
  assert.deepEqual(emailDocumentFiles({
    subject: "FACTURA TOTAL 99999", text: "BASE IMPONIBLE 99999\nTOTAL 99999",
    attachments: [],
  }), []);
  assert.deepEqual(emailDocumentFiles({
    text: "Factura con adjunto no compatible",
    attachments: [{ name: "instrucciones.txt", readable: false, bytes: new Uint8Array([65]) }],
  }), []);
});
