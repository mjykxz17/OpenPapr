"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Status = {
  title: string | null; planned: boolean; planError: string | null; planGaveUp?: boolean;
  total: number; ready: number; queued: number;
  writing: { title: string; stage: string | null } | null;
  incomplete?: number;
  failed: string[];
  stuck?: { title: string; error: string }[];
  scanned?: string[];
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
// What the page shows: changes when a chapter or a missing section lands.
const shown = (x: Status) => `${x.ready}:${x.incomplete ?? 0}`;

// The guide keeps itself up to date; this says what it is doing and offers
// the two things worth asking for: look again now, or rewrite it all.
export function GuideStatus({ moduleId, initial, canGenerate }: { moduleId: number; initial: Status; canGenerate: boolean }) {
  const [s, setS] = useState(initial);
  const [menu, setMenu] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const router = useRouter();
  const lastReady = useRef(shown(initial));

  useEffect(() => {
    if (!canGenerate) return;
    const busy = s.writing || s.queued > 0 || !s.planned;
    const t = setInterval(async () => {
      const r = await fetch(`/api/modules/${moduleId}/guide`).catch(() => null);
      if (!r?.ok) return;
      const next = (await r.json()) as Status;
      setS(next);
      // A chapter landed, or a missing section did: show it without a reload.
      if (shown(next) !== lastReady.current) { lastReady.current = shown(next); router.refresh(); }
    }, busy ? 6000 : 60000);
    return () => clearInterval(t);
  }, [moduleId, canGenerate, s.writing, s.queued, s.planned, router]);

  async function ask(rewrite: boolean) {
    setMenu(false);
    const r = await fetch(`/api/modules/${moduleId}/guide`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rewrite }) }).catch(() => null);
    setNote(r?.ok ? (rewrite ? "Every chapter will be rewritten, one at a time." : "Checking the slides again.") : "Could not reach the server.");
    setS((x) => ({ ...x, queued: rewrite ? x.total : x.queued }));
  }

  let line: string;
  if (s.writing) line = `Writing “${s.writing.title}”${s.writing.stage ? ` — ${s.writing.stage}` : ""}`;
  else if (!s.planned) line = !s.planError ? "Reading the slides…" : s.planGaveUp ? "Could not plan the guide. Use “Check for new slides now” to try again." : "Could not plan the guide yet; will retry.";
  else if (s.queued > 0) line = `${s.ready} of ${s.total} chapters up to date · ${s.queued} waiting`;
  else if ((s.incomplete ?? 0) > 0 || (s.stuck?.length ?? 0) > 0) line = `${s.ready} of ${s.total} chapters written`;
  else line = `Up to date · ${s.total} chapter${s.total === 1 ? "" : "s"}`;

  if (!canGenerate) {
    return (
      <p className="text-[13px] text-ink-3">
        <a href="/account" className="font-medium text-accent hover:underline">Add an AI key</a> and the guide will write itself.
      </p>
    );
  }

  return (
    <div className="relative flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className={`flex items-center gap-2 text-[13px] ${s.writing ? "text-ink" : "text-ink-3"}`} aria-live="polite">
        {s.writing && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" aria-hidden />}
        {note ?? line}
      </span>
      {canGenerate && (
        <>
          <button type="button" onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-label="Guide options"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-line-2 bg-panel text-ink-2 hover:border-ink-3 hover:text-ink">⋯</button>
          {menu && (
            <div className="absolute right-0 top-10 z-30 w-60 rounded-[10px] border border-line bg-panel p-1 shadow-lg">
              <button type="button" onClick={() => ask(false)} className="block w-full rounded-md px-3 py-2 text-left text-[13px] text-ink hover:bg-ink/[0.05]">
                Check for new slides now
                <span className="block text-[12px] text-ink-3">It also checks on its own every few minutes.</span>
              </button>
              <button type="button" onClick={() => ask(true)} className="block w-full rounded-md px-3 py-2 text-left text-[13px] text-ink hover:bg-ink/[0.05]">
                Rewrite every chapter
                <span className="block text-[12px] text-ink-3">Uses about 5–10 AI calls per chapter.</span>
              </button>
            </div>
          )}
        </>
      )}
      {s.failed.length > 0 && !s.writing && <span className="text-[12px] text-warn-ink" title={s.failed.join(", ")}>{s.failed.length} will retry</span>}
      {(s.incomplete ?? 0) > 0 && (
        <span className="text-[12px] text-warn-ink">{plural(s.incomplete!, "section", "sections")} couldn’t be written yet — retrying</span>
      )}
      {(s.stuck?.length ?? 0) > 0 && (
        <span className="text-[12px] text-warn-ink" title={s.stuck!.map((x) => `${x.title}: ${x.error}`).join("\n")}>
          {plural(s.stuck!.length, "chapter", "chapters")} couldn’t be written — try “Check for new slides now”
        </span>
      )}
      {(s.scanned?.length ?? 0) > 0 && (
        <span className="text-[12px] text-ink-3" title={s.scanned!.join(", ")}>
          {s.scanned!.length === 1 ? `${s.scanned![0]} is scanned images` : `${s.scanned!.length} decks are scanned images`} — no text to read
        </span>
      )}
    </div>
  );
}
