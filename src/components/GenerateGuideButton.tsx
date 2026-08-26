"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Status = {
  state: "idle" | "running" | "done" | "failed";
  stage?: string | null;
  decksTotal?: number;
  decksDone?: number;
  sectionsTotal?: number;
  sectionsDone?: number;
  error?: string | null;
};

export function GenerateGuideButton({ moduleId, hasGuide }: { moduleId: number; hasGuide: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const [starting, setStarting] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const poll = useCallback(async () => {
    let s: Status | null = null;
    try {
      s = await (await fetch(`/api/modules/${moduleId}/guide`)).json();
    } catch {
      // A dropped poll is not fatal — the next beat will pick it up.
    }
    if (!s) {
      timer.current = setTimeout(poll, 3000);
      return;
    }
    setStatus(s);
    if (s.state === "running") {
      timer.current = setTimeout(poll, 3000);
      return;
    }
    if (s.state === "done") router.refresh();
  }, [moduleId, router]);

  // Pick up a generation already in flight — started here, on another device,
  // or before a reload.
  useEffect(() => {
    void poll();
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [poll]);

  async function start() {
    setStarting(true);
    try {
      await fetch(`/api/modules/${moduleId}/guide`, { method: "POST" });
    } catch {
      setStatus({ state: "failed", error: "Could not reach the server." });
      setStarting(false);
      return;
    }
    setStarting(false);
    setStatus({ state: "running", stage: "Queued" });
    void poll();
  }

  const running = status.state === "running";
  const sections = running && status.sectionsTotal ? ` · ${status.sectionsDone}/${status.sectionsTotal} sections` : "";

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {running ? (
        <span className="inline-flex items-center gap-2 text-xs text-ink-3">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="animate-spin motion-reduce:animate-none">
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          {status.stage ?? "Generating"}{sections}
        </span>
      ) : (
        <button
          type="button"
          onClick={start}
          disabled={starting}
          className="rounded-md border border-line px-2.5 py-1 text-xs text-ink-2 transition-colors hover:border-accent hover:text-accent disabled:opacity-60"
        >
          {starting ? "Queueing…" : hasGuide ? "Regenerate guide" : "Generate study guide"}
        </button>
      )}

      {status.state === "failed" && status.error && (
        <span className="text-xs text-danger">{status.error}</span>
      )}
      {status.state === "done" && status.error && (
        // Generation succeeded but the validator had notes worth showing.
        <span className="text-xs text-warn">{status.error}</span>
      )}
    </div>
  );
}
