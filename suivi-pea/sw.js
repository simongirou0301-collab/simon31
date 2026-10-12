// Réseau d'abord : les cours changent chaque soir ; le cache sert seulement hors connexion.
const CACHE = "mon-pea-v14";
const FILES = ["./", "index.html", "manifest.json", "data.json", "jours/index.json", "mon-pea.js", "composition.json", "apple.css", "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png"];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  const fonts = url.hostname.endsWith("googleapis.com") || url.hostname.endsWith("gstatic.com");
  if (url.origin !== location.origin && !fonts) return;
  const key = e.request.mode === "navigate" ? "index.html" : e.request;
  e.respondWith(fetch(e.request, fonts ? {} : {cache: "no-cache"}).then(r => {
    if (r.ok || r.type === "opaque") { const c = r.clone(); caches.open(CACHE).then(ca => ca.put(key, c)); }
    return r;
  }).catch(() => caches.match(key)));
});
