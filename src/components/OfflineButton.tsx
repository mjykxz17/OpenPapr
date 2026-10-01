"use client";

import { useEffect, useState } from "react";
import { offlineKey, saveGuideOffline } from "@/lib/offline";

// "Save offline" for one guide: its page and every slide it shows, so it
// opens on the MRT with no signal. Shows when it was last saved.
export function OfflineButton({ moduleId, markdown }: { moduleId: number; markdown: string }) {
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [can, setCan] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    try { const v = localStorage.getItem(offlineKey(moduleId)); setSavedAt(v ? Number(v) : null); } catch { /* none */ }
    setCan(Boolean(navigator.serviceWorker?.controller));
    navigator.serviceWorker?.ready.then(() => setCan(Boolean(navigator.serviceWorker.controller))).catch(() => {});
  }, [moduleId]);

  async function save() {
    setNote(null);
    setProgress({ done: 0, total: 1 });
    const r = await saveGuideOffline(moduleId, markdown, (done, total) => setProgress({ done, total }));
    setProgress(null);
    if (!r.ok) { setNote("Couldn't save — are you online?"); return; }
    setSavedAt(Date.now());
    setNote(r.failed ? `Saved, but ${r.failed} slide${r.failed === 1 ? "" : "s"} didn't download` : "Saved for offline");
    setTimeout(() => setNote(null), 4000);
  }

  const busy = progress !== null;
  const title = !can ? "Offline reading turns on after you reload this page once" : savedAt ? `Saved for offline ${new Date(savedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} — press to update` : "Keep this guide and its slides for reading offline";
  return (
    <span className="relative flex">
      <button type="button" onClick={save} disabled={!can || busy} title={title} aria-label={title}
        className={`flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:text-ink-3 ${savedAt ? "border-accent bg-accent-soft text-accent" : "border-line-2 bg-panel text-ink-2 hover:border-ink-3 hover:text-ink"}`}>
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          {savedAt ? <path d="M20 6 9 17l-5-5" /> : <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></>}
        </svg>
        <span className="hidden md:inline">{busy ? `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` : savedAt ? "Offline" : "Save offline"}</span>
      </button>
      {note && <span role="status" className="absolute right-0 top-10 z-30 whitespace-nowrap rounded-md border border-line bg-panel px-2.5 py-1.5 text-[12px] text-ink-2 shadow-md">{note}</span>}
    </span>
  );
}
