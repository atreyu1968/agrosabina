const CACHE_PREFIX = "agrosabina-runtime-";
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const APP_SCOPE = self.registration.scope;
const APP_ROOT = new URL("./", APP_SCOPE).href;
const CORE_URLS = [
  APP_ROOT,
  new URL("mobile.html", APP_ROOT).href,
  new URL("manifest.webmanifest", APP_ROOT).href,
  new URL("manifest-mobile.webmanifest", APP_ROOT).href,
  new URL("icons/agrosabina-icon-192.png", APP_ROOT).href,
  new URL("icons/agrosabina-icon-512.png", APP_ROOT).href,
  new URL("favicon.svg", APP_ROOT).href,
];
const STATIC_FILE = /\.(?:html|css|js|mjs|wasm|png|svg|webp|jpe?g|ico|woff2?|webmanifest)$/i;
const CACHEABLE_DESTINATIONS = new Set(["script", "style", "image", "font", "worker", "sharedworker"]);

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_URLS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ),
    ),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (/(^|\/)api(?:\/|$)/i.test(url.pathname)) return;

  const isNavigation = request.mode === "navigate";
  const isStaticFile =
    CACHEABLE_DESTINATIONS.has(request.destination) || STATIC_FILE.test(url.pathname);
  if (!isNavigation && !isStaticFile) return;

  event.respondWith(networkFirst(request, isNavigation));
});

async function networkFirst(request, isNavigation) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    const isHtmlNavigation =
      !isNavigation || (response.headers.get("content-type") || "").includes("text/html");
    if (response.ok && isHtmlNavigation) {
      try {
        await cache.put(request, response.clone());
      } catch (error) {
        console.warn("No se pudo guardar un recurso para uso sin conexión:", error);
      }
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (isNavigation) {
      const shell = await cache.match(APP_ROOT);
      if (shell) return shell;
    }
    return Response.error();
  }
}
