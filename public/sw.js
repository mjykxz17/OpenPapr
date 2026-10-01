// OpenPapr's service worker: study guides keep working without a connection.
//  - Guide pages: network first, the last copy when offline.
//  - Slide images: from the cache at once, refreshed behind the scenes (a deck
//    can be replaced by a newer version under the same name).
//  - Next's build files: cache first (their names change with every build).
// Nothing else is cached, and signing out clears it all.
const VERSION = "v1";
const PAGES = `op-pages-${VERSION}`;
const SLIDES = `op-slides-${VERSION}`;
const STATIC = `op-static-${VERSION}`;
const KEEP = [PAGES, SLIDES, STATIC];
const MAX_SLIDES = 1500;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (!KEEP.includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

const isGuide = (url) => /^\/modules\/\d+\/guide\/?$/.test(url.pathname);
const isSlide = (url) => /^\/api\/modules\/\d+\/slide$/.test(url.pathname);
const isStatic = (url) => url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/brand/") || url.pathname === "/pdfjs" || url.pathname.startsWith("/pdfjs/");

async function trim(cache, max) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

async function cacheFirst(req, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && !res.redirected) {
    await cache.put(req, res.clone());
    if (name === SLIDES) trim(cache, MAX_SLIDES);
  }
  return res;
}

async function staleWhileRevalidate(event, req) {
  const cache = await caches.open(SLIDES);
  const hit = await cache.match(req);
  const fresh = fetch(req).then(async (res) => {
    if (res.ok && !res.redirected) { await cache.put(req, res.clone()); trim(cache, MAX_SLIDES); }
    return res;
  });
  if (hit) { event.waitUntil(fresh.catch(() => {})); return hit; }
  return fresh;
}

// A page keyed without its query or hash, and its React Server Component
// payload kept apart from its HTML.
const pageKey = (req, url) => `${url.origin}${url.pathname}${req.headers.get("RSC") ? "?__rsc" : ""}`;

async function networkFirst(req, url) {
  const cache = await caches.open(PAGES);
  const key = pageKey(req, url);
  try {
    const res = await fetch(req);
    if (res.ok && !res.redirected) await cache.put(key, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(key);
    if (hit) return hit;
    throw err;
  }
}

function offlinePage() {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline · OpenPapr</title>
<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;color:#18181b">
<h1 style="font-size:1.4rem">You're offline</h1>
<p style="color:#52525b;line-height:1.6">This page needs a connection. Study guides you've opened or saved for offline still work — go back to one of those, or try again when you're online.</p>
<p><a href="javascript:location.reload()" style="color:#0f766e">Try again</a></p></body>`,
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (isSlide(url)) return event.respondWith(staleWhileRevalidate(event, req));
  if (isStatic(url)) return event.respondWith(cacheFirst(req, STATIC));
  if (isGuide(url)) return event.respondWith(networkFirst(req, url));
  if (req.mode === "navigate") event.respondWith(fetch(req).catch(async () => (await caches.match(pageKey(req, url), { cacheName: PAGES })) ?? offlinePage()));
});

self.addEventListener("message", (event) => {
  if (event.data === "clear") event.waitUntil((async () => { for (const k of await caches.keys()) await caches.delete(k); })());
});
