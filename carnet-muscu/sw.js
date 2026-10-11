const CACHE = "carnet-v23";
const FILES = [
  "./", "index.html", "manifest.json", "run.js", "run.css", "apple.css",
  "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png",
  "photos/pull-1.jpg",
  "photos/pull-2.jpg",
  "photos/pull-3.jpg",
  "photos/pull-4.jpg",
  "photos/pull-5.jpg",
  "photos/pull-6.jpg",
  "photos/pull-7.jpg",
  "photos/push-1.jpg",
  "photos/push-2.jpg",
  "photos/push-3.jpg",
  "photos/push-4.jpg",
  "photos/push-5.jpg",
  "photos/push-6.jpg",
  "photos/push-7.jpg",
  "photos/push-8.jpg",
];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.hostname.endsWith("intervals.icu")) return;
  if (url.origin !== location.origin && !url.hostname.endsWith("googleapis.com") && !url.hostname.endsWith("gstatic.com")) return;
  const fresh = url.origin === location.origin && (e.request.mode === "navigate" || /\/(index\.html|run\.js|run\.css|apple\.css)$/.test(url.pathname));
  if (fresh) {
    const key = e.request.mode === "navigate" ? "index.html" : e.request;
    e.respondWith(fetch(e.request, {cache:"reload"}).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(ca => ca.put(key, c)); } return r; })
      .catch(() => caches.match(key)));
    return;
  }
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => {
    if (r.ok || r.type === "opaque") { const c = r.clone(); caches.open(CACHE).then(ca => ca.put(e.request, c)); }
    return r;
  })));
});
