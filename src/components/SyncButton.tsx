"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

function SpinnerIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="animate-spin motion-reduce:animate-none">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}

type State = { pending: boolean; running: boolean; lastOk: boolean | null; lastError: string | null };

export function SyncButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deadline = useRef(0);

  const stop = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  // Poll until the worker has both taken the request and finished the cycle.
  const watch = useCallback(() => {
    const poll = async () => {
      let s: State | null = null;
      try {
        s = await (await fetch("/api/sync")).json();
      } catch {
        // A dropped poll is not fatal; try again on the next beat.
      }
      if (s && !s.pending && !s.running) {
        setBusy(false);
        if (s.lastOk === false) setError(s.lastError ?? "Sync failed.");
        router.refresh();
        return;
      }
      // The worker may be down entirely — stop spinning rather than hang.
      if (Date.now() > deadline.current) {
        setBusy(false);
        setError("Sync did not finish. The worker may not be running.");
        return;
      }
      timer.current = setTimeout(poll, 1500);
    };
    timer.current = setTimeout(poll, 1500);
  }, [router]);

  async function syncNow() {
    setError(null);
    setBusy(true);
    deadline.current = Date.now() + 3 * 60_000;
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      if (!res.ok) throw new Error("Could not request a sync");
    } catch {
      setBusy(false);
      setError("Could not reach the server.");
      return;
    }
    watch();
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-danger">{error}</span>}
      <button
        type="button"
        onClick={syncNow}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-xs text-ink-2 transition-colors hover:border-accent hover:text-accent disabled:opacity-60"
      >
        {busy ? <SpinnerIcon /> : <RefreshIcon />}
        {busy ? "Syncing…" : "Sync now"}
      </button>
    </div>
  );
}
