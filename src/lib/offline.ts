"use client";

import { slideImageUrl } from "./slide-citation";

// The browser side of offline reading (see public/sw.js).

export async function clearOfflineCaches(): Promise<void> {
  try {
    if ("caches" in window) for (const k of await caches.keys()) if (k.startsWith("op-")) await caches.delete(k);
    navigator.serviceWorker?.controller?.postMessage("clear");
    for (const k of Object.keys(localStorage)) if (k.startsWith("offline:")) localStorage.removeItem(k);
  } catch { /* best effort */ }
}

export const offlineKey = (moduleId: number) => `offline:${moduleId}`;

// Fetches the guide page, the build files it loads, and every slide image it
// shows, through the service worker so each lands in its cache. Images go
// six at a time.
export async function saveGuideOffline(
  moduleId: number, markdown: string, onProgress: (done: number, total: number) => void,
): Promise<{ ok: boolean; failed: number }> {
  if (!("serviceWorker" in navigator) || !navigator.serviceWorker.controller) return { ok: false, failed: 0 };
  const urls = new Set<string>();
  for (const m of markdown.matchAll(/\]\((slide|slide-img):([^)#\s]+)#(\d+)\)/g)) {
    let deck = m[2]!;
    try { deck = decodeURIComponent(deck); } catch { /* as written */ }
    urls.add(slideImageUrl(moduleId, deck, Number(m[3])));
    if (m[1] === "slide") urls.add(slideImageUrl(moduleId, deck, Number(m[3]), "thumb"));
  }
  const page = `/modules/${moduleId}/guide`;
  try {
    const html = await (await fetch(page, { cache: "no-store" })).text();
    for (const m of html.matchAll(/["'](\/_next\/static\/[^"'\s]+)["']/g)) urls.add(m[1]!);
  } catch { return { ok: false, failed: 0 }; }
  const list = [...urls];
  let done = 0;
  let failed = 0;
  const next = async (): Promise<void> => {
    const u = list.shift();
    if (!u) return;
    try { const r = await fetch(u); if (!r.ok) failed++; } catch { failed++; }
    onProgress(++done, urls.size);
    return next();
  };
  await Promise.all(Array.from({ length: 6 }, next));
  try { localStorage.setItem(offlineKey(moduleId), String(Date.now())); } catch { /* fine */ }
  return { ok: true, failed };
}
