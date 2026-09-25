"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SYNC_ON_OPEN_AFTER_MS } from "@/lib/poll-schedule";

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

// With lastSyncedAt, opening the page syncs straight away when Canvas was last
// read more than a couple of minutes ago, so the student never starts from
// stale data even overnight, when the background schedule is hourly.
export function SyncButton({ lastSyncedAt }: { lastSyncedAt?: number | null } = {}) {
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

  async function syncNow(quiet = false) {
    setError(null);
    setBusy(true);
    deadline.current = Date.now() + 3 * 60_000;
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      if (!res.ok) throw new Error("Could not request a sync");
    } catch {
      setBusy(false);
      if (!quiet) setError("Could not reach the server.");
      return;
    }
    watch();
  }

  const auto = useRef(false);
  useEffect(() => {
    if (auto.current || lastSyncedAt === undefined) return;
    auto.current = true;
    if (lastSyncedAt !== null && Date.now() - lastSyncedAt < SYNC_ON_OPEN_AFTER_MS) return;
    void syncNow(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastSyncedAt]);

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-[13px] text-danger">{error}</span>}
      <button
        type="button"
        onClick={() => syncNow()}
        disabled={busy}
        className="inline-flex h-9 items-center gap-2 rounded-md border border-line-2 bg-panel px-3 text-[13px] font-medium text-ink transition-colors hover:border-accent hover:text-accent disabled:opacity-60"
      >
        {busy ? <SpinnerIcon /> : <RefreshIcon />}
        {busy ? "Syncing…" : "Sync now"}
      </button>
    </div>
  );
}
