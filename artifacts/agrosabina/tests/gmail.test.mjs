import test from "node:test";
import assert from "node:assert/strict";

import { decodeGmailRaw } from "../assets/js/gmail.js";
import { parseEml } from "../assets/js/mail.js";

test("decodifica el correo raw base64url de Gmail en UTF-8", () => {
  const expected = "From: tienda@example.com\r\nSubject: Factura ágil\r\n\r\nAdjunto factura.";
  const raw = Buffer.from(expected, "utf8").toString("base64url");
  assert.equal(decodeGmailRaw(raw), expected);
});

test("el correo raw de Gmail conserva el PDF para la revisión existente", () => {
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
});
