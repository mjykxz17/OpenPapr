"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const POLL_MS = 1_500;
// If the worker is not running the request stays pending forever; give up and
// let the staleness badge tell that story.
const TIMEOUT_MS = 3 * 60_000;

type SyncState = { pending: boolean; running: boolean; lastFinishedAt: number | null };

export function SyncButton() {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);

  async function onClick() {
    setSyncing(true);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const { lastFinishedAt: before } = (await res.json()) as { lastFinishedAt: number | null };
      const deadline = Date.now() + TIMEOUT_MS;
      // Done when the worker has taken the request, nothing is mid-run, and a
      // run has finished since we asked (guards the gap between the request
      // being taken and the first sync_runs row appearing).
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        const state = (await fetch("/api/sync").then((r) => r.json())) as SyncState;
        if (!state.pending && !state.running && state.lastFinishedAt !== before) break;
      }
    } finally {
      setSyncing(false);
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={syncing}
      className="shrink-0 border border-line px-2 py-1 text-xs text-ink-2 hover:text-accent disabled:opacity-50"
    >
      {syncing ? "Syncing…" : "Sync now"}
    </button>
  );
}
