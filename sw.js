const CACHE_NAME = "harivansh-mala-cache-v5";
const APP_SHELL_ASSETS = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/app.js",
  "./js/timer.js",
  "./js/storage.js",
  "./js/themes.js",
  "./js/history.js",
  "./js/ui.js",
  "./manifest.json",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

async function networkFirst(request, cacheKey = request) {
  try {
    const response = await fetch(request, { cache: "no-store" });
    if (response && response.ok) {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(cacheKey, copy)).catch(() => {});
    }
    return response;
  } catch {
    const cached = await caches.match(cacheKey);
    if (cached) return cached;
    throw new Error("Network and cache both unavailable.");
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) {
    const copy = response.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  const isNavigation = event.request.mode === "navigate";
  const isAppCode = url.pathname.endsWith(".js") || url.pathname.endsWith(".css") || url.pathname.endsWith(".html") || url.pathname.endsWith("/Naam-jap-timer/") || url.pathname.endsWith("/Naam-jap-timer");

  if (isNavigation) {
    event.respondWith(networkFirst(event.request, "./index.html"));
    return;
  }

  if (isAppCode) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  event.respondWith(cacheFirst(event.request));
});