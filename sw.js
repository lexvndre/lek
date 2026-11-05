// Guarda o app no celular pra abrir rápido e até sem internet.
const CACHE = "lek-1793839686";
self.addEventListener("install", e => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
));
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async c => {
    const velho = await c.match(e.request);
    const novo = fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; });
    if (velho) { e.waitUntil(novo.catch(() => {})); return velho; }
    return novo;
  }));
});
