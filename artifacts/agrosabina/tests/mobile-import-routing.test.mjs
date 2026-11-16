import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const views = readFileSync(new URL("../assets/js/views.js", import.meta.url), "utf8");

test("las capturas móviles aparecen en Importar y no en Documentos", () => {
  const documentsStart = views.indexOf("function viewDocumentos()");
  const documentsEnd = views.indexOf("/** Repinta solo la tabla", documentsStart);
  const importStart = views.indexOf("function viewImportar()");
  const importEnd = views.indexOf("/* ---- lista de ficheros de esta sesión ---- */", importStart);

  assert.notEqual(documentsStart, -1);
  assert.notEqual(importStart, -1);
  assert.doesNotMatch(views.slice(documentsStart, documentsEnd), /mobileImportInboxHtml/);
  assert.match(views.slice(importStart, importEnd), /mobileImportInboxHtml\(\)/);
  assert.match(views, /data-action="import-mobile-upload"/);
});

test("importar una captura móvil conserva el original y exige el flujo de tipo habitual", () => {
  assert.match(views, /case "import-mobile-upload":\s*await importMobileUpload/);
  assert.match(views, /queueFiles\(\[file\],\s*\{\s*mobileInboxId:/);
  assert.match(views, /job\.selectedKind = await chooseDocumentImporter\(job\)/);
  assert.match(views, /await removeImportedMobileUpload\(job, res\.invoice\)/);
});
