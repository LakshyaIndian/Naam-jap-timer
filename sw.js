const CACHE_NAME = "harivansh-mala-cache-v1";
const ASSETS = ["./","./index.html","./css/style.css","./js/app.js","./js/timer.js","./js/storage.js","./js/themes.js","./js/history.js","./js/ui.js","./manifest.json","./icons/icon.svg","./icons/icon-192.png","./icons/icon-512.png"];
self.addEventListener("install", (event) => { event.waitUntil(caches.open(CACHE_NAME).then((cache)=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())); });
self.addEventListener("activate", (event) => { event.waitUntil(caches.keys().then((keys)=>Promise.all(keys.filter((key)=>key!==CACHE_NAME).map((key)=>caches.delete(key)))).then(()=>self.clients.claim())); });
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(caches.match(event.request).then((cached)=>cached || fetch(event.request).then((network)=>{ const copy = network.clone(); caches.open(CACHE_NAME).then((cache)=>cache.put(event.request, copy)).catch(()=>{}); return network; }).catch(()=>caches.match("./index.html"))));
});
