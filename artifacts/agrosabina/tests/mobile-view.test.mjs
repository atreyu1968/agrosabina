import test from "node:test";
import assert from "node:assert/strict";
import { renderMobileScreen } from "../assets/js/mobile-view.js";

test("la vista móvil ofrece filtros y captura con cámara trasera", () => {
  const html = renderMobileScreen({
    user: { name: "Ana" },
    invoices: [],
    inbox: [],
  });
  assert.match(html, /data-mobile-filter="IN"/);
  assert.match(html, /data-mobile-filter="OUT"/);
  assert.match(html, /id="mobile-camera-file"[^>]*capture="environment"/);
  assert.match(html, /id="mobile-picker-file"[^>]*application\/pdf/);
});

test("el filtro móvil separa cobros y pagos pendientes", () => {
  const html = renderMobileScreen({
    filter: "OUT",
    invoices: [
      { id: "sale", direction: "INGRESO", party: "Cliente", total: 25 },
      { id: "purchase", direction: "GASTO", party: "Proveedor", total: 40 },
    ],
    inbox: [],
  });
  assert.match(html, /Proveedor/);
  assert.doesNotMatch(html, /Cliente/);
  assert.match(html, /40,00/);
});

test("los datos dinámicos se escapan y las subidas quedan pendientes de revisión", () => {
  const html = renderMobileScreen({
    user: { name: "<script>alert(1)</script>" },
    invoices: [],
    inbox: [{ id: 'x" onclick="alert(1)', name: "<img src=x>", size: 1024, savedAt: "2026-11-16T12:00:00Z" }],
  });
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /<img src=x>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img src=x&gt;/);
  assert.match(html, /Sin clasificar/);
  assert.match(html, /No se contabiliza automáticamente/);
});

test("la página móvil permite activar el acceso biométrico con confirmación de contraseña", () => {
  const html = renderMobileScreen({
    user: { name: "Ana" },
    invoices: [],
    inbox: [],
    passkeySupported: true,
    passkeySetupOpen: true,
  });
  assert.match(html, /Activar acceso biométrico/);
  assert.match(html, /data-mobile-form="passkey"/);
  assert.match(html, /autocomplete="current-password"/);
  assert.match(html, /tus datos biométricos permanecen en el teléfono/i);
});

test("la página móvil explica cuándo no está disponible el acceso biométrico", () => {
  const html = renderMobileScreen({ invoices: [], inbox: [], passkeySupported: false });
  assert.match(html, /abre la aplicación desde HTTPS/);
  assert.doesNotMatch(html, /data-mobile-action="open-passkey-setup"/);
});
