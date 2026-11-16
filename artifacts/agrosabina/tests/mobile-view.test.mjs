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
  const upload = renderMobileScreen({ invoices: [], inbox: [], activeTab: "upload" });
  assert.match(upload, /id="mobile-camera-file"[^>]*capture="environment"/);
  assert.match(upload, /id="mobile-picker-file"[^>]*application\/pdf/);
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
    invoices: [],
    inbox: [{ id: 'x" onclick="alert(1)', name: "<img src=x>", size: 1024, savedAt: "2026-11-16T12:00:00Z" }],
    activeTab: "review",
  });
  assert.doesNotMatch(html, /<img src=x>/);
  assert.match(html, /&lt;img src=x&gt;/);
  const account = renderMobileScreen({
    user: { name: "<script>alert(1)</script>" },
    invoices: [],
    inbox: [],
    activeTab: "account",
  });
  assert.doesNotMatch(account, /<script>alert/);
  assert.match(account, /&lt;script&gt;/);
  assert.match(html, /originales se conservan/);
  const upload = renderMobileScreen({ invoices: [], inbox: [], activeTab: "upload" });
  assert.match(upload, /Sin clasificar/);
  assert.match(upload, /No se contabiliza automáticamente/);
});

test("la página móvil permite activar el acceso biométrico con confirmación de contraseña", () => {
  const html = renderMobileScreen({
    user: { name: "Ana" },
    invoices: [],
    inbox: [],
    activeTab: "account",
    passkeySupported: true,
    passkeySetupOpen: true,
  });
  assert.match(html, /Activar acceso biométrico/);
  assert.match(html, /data-mobile-form="passkey"/);
  assert.match(html, /autocomplete="current-password"/);
  assert.match(html, /tus datos biométricos permanecen en el teléfono/i);
});

test("la página móvil explica cuándo no está disponible el acceso biométrico", () => {
  const html = renderMobileScreen({ invoices: [], inbox: [], activeTab: "account", passkeySupported: false });
  assert.match(html, /abre la aplicación desde HTTPS/);
  assert.doesNotMatch(html, /data-mobile-action="open-passkey-setup"/);
});

test("la navegación inferior ofrece pestañas compactas para las cuatro tareas móviles", () => {
  const html = renderMobileScreen({
    invoices: [{ id: "invoice", direction: "GASTO", party: "Proveedor", total: 24 }],
    inbox: [{ id: "file", name: "recibo.pdf" }],
  });
  assert.match(html, /class="mobile-tabbar" aria-label="Secciones del móvil"/);
  for (const tab of ["pending", "upload", "review", "account"]) {
    assert.match(html, new RegExp(`data-mobile-tab="${tab}"`));
  }
  assert.match(html, /Pendientes/);
  assert.match(html, /Subir/);
  assert.match(html, /Revisar/);
  assert.match(html, /Cuenta/);
  assert.match(html, /aria-current="page"/);
  assert.doesNotMatch(html, /id="mobile-camera-file"/);
});

test("cada pestaña muestra solo su contenido y mantiene captura, revisión y cuenta accesibles", () => {
  const common = {
    invoices: [{ id: "invoice", direction: "GASTO", party: "Proveedor", total: 24 }],
    inbox: [{ id: "file", name: "recibo.pdf" }],
    passkeySupported: true,
  };
  const upload = renderMobileScreen({ ...common, activeTab: "upload" });
  assert.match(upload, /id="mobile-camera-file"[^>]*capture="environment"/);
  assert.match(upload, /id="mobile-picker-file"/);
  assert.doesNotMatch(upload, /id="pending-title"/);

  const review = renderMobileScreen({ ...common, activeTab: "review" });
  assert.match(review, /id="inbox-title"/);
  assert.match(review, /recibo\.pdf/);
  assert.doesNotMatch(review, /id="mobile-camera-file"/);

  const account = renderMobileScreen({ ...common, activeTab: "account", user: { name: "Ana" } });
  assert.match(account, /id="account-title"/);
  assert.match(account, /Activar acceso biométrico/);
  assert.match(account, /data-mobile-action="logout"/);
  assert.doesNotMatch(account, /id="pending-title"/);
});
