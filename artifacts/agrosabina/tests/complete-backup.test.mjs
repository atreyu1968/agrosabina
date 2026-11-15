import test from "node:test";
import assert from "node:assert/strict";
import { packCompleteBackup, unpackCompleteBackup, portableSettings } from "../assets/js/complete-backup.js";

const data = () => ({
  version: 1,
  settings: { businessName: "Prueba", aiKey: "FICTICIA", aiEndpoint: "https://user:password@example.test", token: "TOKEN" },
  suppliers: [{ id: "s1", name: "Proveedor" }],
  invoices: [{ id: "i1", supplierId: "s1", number: "PDF-1" }, { id: "i2", supplierId: "s1", number: "FOTO-1" }],
  messages: [{ id: "m1", subject: "Correo", text: "Texto" }],
});
const originals = () => new Map([
  ["i1", { name: "factura.pdf", type: "application/pdf", savedAt: "2026-11-15", blob: new Blob(["%PDF-1.4\nprueba"]) }],
  ["i2", { name: "foto.png", type: "image/png", savedAt: "2026-11-15", blob: new Blob([new Uint8Array([137, 80, 78, 71, 0, 255])]) }],
]);

test("copia portable conserva bytes de PDF/foto, relaciones y correos sin credenciales", async () => {
  const source = data();
  const text = await packCompleteBackup(source, originals());
  assert.equal(text.includes("FICTICIA"), false);
  assert.equal(text.includes("password"), false);
  assert.equal(text.includes("TOKEN"), false);
  const result = await unpackCompleteBackup(text);
  assert.equal(result.data.invoices[0].supplierId, "s1");
  assert.equal(result.data.messages[0].subject, "Correo");
  for (const [id, original] of originals()) {
    assert.deepEqual(await result.originals.get(id).blob.arrayBuffer(), await original.blob.arrayBuffer());
  }
  assert.deepEqual(portableSettings(source.settings), { businessName: "Prueba" });
});

test("rechaza versiones, contenido truncado, checksum, tamaño, duplicados y relaciones rotas", async () => {
  const text = await packCompleteBackup(data(), originals());
  for (const mutate of [
    (a) => { a.version = 2; },
    (a) => { a.attachments.pop(); },
    (a) => { a.attachments[0].base64 = "!!!!"; },
    (a) => { a.attachments[0].sha256 = "0".repeat(64); },
    (a) => { a.attachments[0].size++; },
    (a) => { a.attachments.push(a.attachments[0]); },
    (a) => { a.attachments[0].invoiceId = "inexistente"; },
    (a) => { a.data.invoices[0].supplierId = "inexistente"; },
    (a) => { a.data.invoices[0].original.name = "otro.pdf"; },
  ]) {
    const archive = JSON.parse(text);
    mutate(archive);
    await assert.rejects(unpackCompleteBackup(JSON.stringify(archive)), /Copia .*no válida/);
  }
  await assert.rejects(unpackCompleteBackup(text.slice(0, -10)), SyntaxError);
});

test("un original anunciado pero ausente no produce una falsa copia completa", async () => {
  const source = data();
  source.invoices[0].original = { name: "perdido.pdf", size: 123 };
  await assert.rejects(packCompleteBackup(source, new Map()), /Falta el original/);
});

test("una copia sin adjuntos sigue siendo portable", async () => {
  const result = await unpackCompleteBackup(await packCompleteBackup(data(), new Map()));
  assert.equal(result.originals.size, 0);
  assert.equal(result.data.invoices.length, 2);
});
