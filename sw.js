/* sw.js — offline cache */

const VERSION = "gymcoach-v16-1";
const CORE = `${VERSION}-core`;
const RUNTIME = `${VERSION}-runtime`;

// Everything the app needs to boot with no network at all.

const FILES = [
  "./",
  "./index.html",
  "./manifest.json",
  "./assets/app.css",
  "./assets/custom.css",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/icon-maskable-512.png",
  "./data/templates.js",
  "./data/seed-project.js",
  "./js/ui.js",
  "./js/mediaStore.js",
  "./js/store.js",
  "./js/ml.js",
  "./js/pipeline.js",
  "./js/settings.js",
  "./js/app.js",
  "./js/manage.js",
  "./js/report.js",
  "./js/home.js"
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CORE);
    // One at a time: a single 404 must not abort the whole install.
    const results = await Promise.allSettled(FILES.map(f => cache.add(new Request(f, { cache: "reload" }))));
    const failed = results
      .map((r, i) => (r.status === "rejected" ? FILES[i] : null))
      .filter(Boolean);
    if (failed.length) console.warn("[sw] not cached:", failed.join(", "));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keep = new Set([CORE, RUNTIME]);
    await Promise.all((await caches.keys()).filter(k => !keep.has(k)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Never touch API traffic because a cached coach reply would be worse than an error.
  if (url.hostname.endsWith("anthropic.com") || url.hostname.endsWith("openai.com")) return;

  // Navigations: network first so an update actually lands, cache as the safety net.
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        (await caches.open(CORE)).put("./index.html", fresh.clone());
        return fresh;
      } catch {
        return (await caches.match("./index.html")) || Response.error();
      }
    })());
    return;
  }

  // Cross-origin (the jsPDF CDN): stale-while-revalidate, so PDF export keeps
  // working offline once you've used it while connected.
  if (url.origin !== self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME);
      const hit = await cache.match(req);
      const network = fetch(req).then(res => {
        if (res.ok || res.type === "opaque") cache.put(req, res.clone());
        return res;
      }).catch(() => null);
      return hit || (await network) || Response.error();
    })());
    return;
  }

  // Same-origin assets: cache first, refresh in the background.
  event.respondWith((async () => {
    const cache = await caches.open(CORE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) {
      fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); }).catch(() => { });
      return hit;
    }
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      return Response.error();
    }
  })());
});
