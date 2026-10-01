"use client";

import { useEffect } from "react";

// Registers public/sw.js, which keeps study guides readable offline. Only in
// a production build: in development it would serve stale code.
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => { /* offline reading is a bonus */ });
  }, []);
  return null;
}
