"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { relativeDay, shortTime } from "@/lib/format-date";

type Status = { builtAt: number | null; pending: boolean; error: string | null };

const built = (ms: number) => {
  const d = relativeDay(ms, Date.now());
  return d === "Today" ? `today ${shortTime(ms)}` : d === "Yesterday" ? "yesterday" : d;
};

// "Built today 14:02 · Rebuild". Rebuilding is done by the worker, so the
// button asks for it and then watches for the new version to land.
export function RebuildButton({ scope, moduleId, status, noun = "profile" }: {
  scope: "me" | "plan" | "module"; moduleId?: number; status: Status; noun?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(status.pending);
  const [error, setError] = useState<string | null>(status.error);
  const since = useRef(status.builtAt ?? 0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A save elsewhere on the page (a staff page, About you) can ask for a
  // rebuild; the refreshed props then say so.
  useEffect(() => {
    if (status.pending) setPending(true);
  }, [status.pending, status.builtAt]);

  const q = `/api/profile?scope=${scope}${moduleId ? `&moduleId=${moduleId}` : ""}`;
  useEffect(() => {
    if (!pending) return;
    const started = Date.now();
    const poll = async () => {
      try {
        const s = (await (await fetch(q)).json()) as Status;
        if (!s.pending) {
          setPending(false);
          setError(s.error);
          if ((s.builtAt ?? 0) !== since.current) { since.current = s.builtAt ?? 0; router.refresh(); }
          return;
        }
      } catch { /* try again */ }
      if (Date.now() - started < 5 * 60_000) timer.current = setTimeout(poll, 3000);
      else setPending(false);
    };
    timer.current = setTimeout(poll, 2500);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [pending, q, router]);

  async function rebuild() {
    setError(null);
    setPending(true);
    try {
      const res = await fetch("/api/profile", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, moduleId }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => null);
        setError(b?.error ?? "could not ask for a rebuild");
        setPending(false);
      }
    } catch {
      setError("could not reach the server");
      setPending(false);
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-3">
      {pending ? (
        <span className="inline-flex items-center gap-1.5 text-ink-2" role="status">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="animate-spin motion-reduce:animate-none" aria-hidden>
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          Building {noun}…
        </span>
      ) : (
        <>
          {status.builtAt ? <span suppressHydrationWarning>Built {built(status.builtAt)}</span> : <span>Not built yet</span>}
          <span aria-hidden>·</span>
          <button type="button" onClick={rebuild} className="font-medium text-accent hover:underline">
            {status.builtAt ? "Rebuild" : "Build now"}
          </button>
        </>
      )}
      {error && !pending && <span className="basis-full text-danger">{error}</span>}
    </span>
  );
}
