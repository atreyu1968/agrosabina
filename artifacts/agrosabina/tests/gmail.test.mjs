import test from "node:test";
import assert from "node:assert/strict";

import { buildGmailSearchQuery, decodeGmailRaw } from "../assets/js/gmail.js";
import { emailDocumentFiles, parseEml } from "../assets/js/mail.js";

test("decodifica el correo raw base64url de Gmail en UTF-8", () => {
  const expected = "From: tienda@example.com\r\nSubject: Factura ágil\r\n\r\nAdjunto factura.";
  const raw = Buffer.from(expected, "utf8").toString("base64url");
  assert.equal(decodeGmailRaw(raw), expected);
});

test("filtra Gmail por intervalo inclusivo y solo busca correos con adjuntos", () => {
  assert.equal(
    buildGmailSearchQuery({ from: "2026-10-01", to: "2026-10-31" }),
    "has:attachment after:2026/10/01 before:2026/11/01",
  );
  assert.throws(
    () => buildGmailSearchQuery({ from: "2026-11-01", to: "2026-10-31" }),
    /posterior/,
  );
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
