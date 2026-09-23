"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Status = {
  state: "idle" | "running" | "done" | "failed";
  stage?: string | null;
  decksTotal?: number;
  decksDone?: number;
  sectionsTotal?: number;
  sectionsDone?: number;
  error?: string | null;
};

export type GuideCandidate = {
  id: number;
  name: string;
  group: string;
  meta: string;
  suggested: boolean;   // a lecture deck the automatic pick would use
  inGuide: boolean;     // the current guide already has a chapter from it
};

export function GenerateGuideButton({ moduleId, hasGuide, canGenerate = true, candidates = [] }: {
  moduleId: number; hasGuide: boolean; canGenerate?: boolean; candidates?: GuideCandidate[];
}) {
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

  const [open, setOpen] = useState(false);

  async function start(choice?: { fileIds: number[]; mode: "replace" | "merge" }) {
    setStarting(true);
    setOpen(false);
    try {
      const res = await fetch(`/api/modules/${moduleId}/guide`, choice
        ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(choice) }
        : { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setStatus({ state: "failed", error: body?.error ?? "Could not queue the guide." });
        setStarting(false);
        return;
      }
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
    <div className="relative flex flex-wrap items-center gap-x-3 gap-y-1">
      {!canGenerate && !running ? (
        <Link
          href="/account"
          className="inline-flex h-8 items-center rounded-md border border-line-2 bg-panel px-3 text-[13px] font-medium text-ink transition-colors hover:border-accent hover:text-accent"
        >
          Add an AI key to generate →
        </Link>
      ) : running ? (
        <span className="inline-flex items-center gap-2 text-[13px] text-ink-2">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="animate-spin motion-reduce:animate-none">
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          {status.stage ?? "Generating"}{sections}
        </span>
      ) : (
        <button
          type="button"
          onClick={() => (candidates.length ? setOpen((o) => !o) : start())}
          disabled={starting}
          aria-expanded={candidates.length ? open : undefined}
          aria-haspopup={candidates.length ? "dialog" : undefined}
          className="h-8 rounded-md border border-line-2 bg-panel px-3 text-[13px] font-medium text-ink transition-colors hover:border-accent hover:text-accent disabled:opacity-60"
        >
          {starting ? "Queueing…" : hasGuide ? "Regenerate…" : "Generate study guide…"}
        </button>
      )}
      {open && (
        <GuideChooser
          candidates={candidates}
          hasGuide={hasGuide}
          onCancel={() => setOpen(false)}
          onGenerate={(fileIds, mode) => void start({ fileIds, mode })}
        />
      )}

      {status.state === "failed" && status.error && (
        <span className="text-[13px] text-danger">{status.error}</span>
      )}
      {status.state === "done" && status.error && (
        // Generation succeeded but the validator had notes worth showing.
        <span className="text-[13px] text-warn-ink">{status.error}</span>
      )}
    </div>
  );
}

// Which files the guide is written from. Lecture decks are ticked by default;
// anything else with pages (tutorials, readings, PowerPoint) can be added.
// With a guide already there, the default is to rewrite only the chosen
// chapters and keep the rest.
function GuideChooser({ candidates, hasGuide, onCancel, onGenerate }: {
  candidates: GuideCandidate[];
  hasGuide: boolean;
  onCancel: () => void;
  onGenerate: (fileIds: number[], mode: "replace" | "merge") => void;
}) {
  const suggested = useMemo(() => new Set(candidates.filter((c) => c.suggested).map((c) => c.id)), [candidates]);
  const [picked, setPicked] = useState<Set<number>>(() => new Set(suggested));
  const [mode, setMode] = useState<"replace" | "merge">(hasGuide ? "merge" : "replace");
  const [q, setQ] = useState("");
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    const onDown = (e: MouseEvent) => { if (panel.current && !panel.current.parentElement?.contains(e.target as Node)) onCancel(); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    panel.current?.querySelector<HTMLElement>("input[type=checkbox]")?.focus();
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("mousedown", onDown); };
  }, [onCancel]);

  const needle = q.trim().toLowerCase();
  const shown = needle ? candidates.filter((c) => c.name.toLowerCase().includes(needle)) : candidates;
  const groups: { label: string; rows: GuideCandidate[] }[] = [];
  for (const c of shown) {
    const g = groups.find((x) => x.label === c.group);
    if (g) g.rows.push(c); else groups.push({ label: c.group, rows: [c] });
  }
  const toggle = (id: number) => setPicked((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const setGroup = (rows: GuideCandidate[], on: boolean) => setPicked((prev) => {
    const n = new Set(prev); for (const r of rows) { if (on) n.add(r.id); else n.delete(r.id); } return n;
  });
  const count = picked.size;
  const quick = "rounded px-1.5 py-0.5 text-[12px] text-accent hover:bg-accent-soft";

  return (
    <div ref={panel} role="dialog" aria-label="Choose files for the study guide"
      className="absolute right-0 top-full z-30 mt-2 flex max-h-[min(75vh,640px)] w-[min(440px,calc(100vw-5rem))] flex-col rounded-[10px] border border-line bg-panel shadow-[0_8px_30px_rgb(0_0_0/0.14)]">
      <div className="shrink-0 border-b border-line px-4 pb-3 pt-3.5">
        <p className="text-[14px] font-semibold text-ink">Write the guide from</p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-ink-3">One chapter per file. Lecture slides are ticked; add tutorials or readings if you want chapters on them.</p>
        <div className="mt-2.5 flex flex-wrap items-center gap-1">
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter" aria-label="Filter files"
            className="mr-1 h-7 w-32 rounded-md border border-line-2 bg-surface px-2 text-[12px] text-ink outline-none focus:border-accent" />
          <button type="button" className={quick} onClick={() => setPicked(new Set(suggested))}>Lecture slides</button>
          <button type="button" className={quick} onClick={() => setPicked(new Set(candidates.map((c) => c.id)))}>All</button>
          <button type="button" className={quick} onClick={() => setPicked(new Set())}>None</button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {groups.length === 0 && <p className="px-2 py-3 text-[13px] text-ink-3">No match.</p>}
        {groups.map((g) => {
          const on = g.rows.filter((r) => picked.has(r.id)).length;
          return (
            <fieldset key={g.label} className="mb-2">
              <legend className="flex w-full items-baseline justify-between px-2 pb-1 pt-1.5">
                <span className="text-[12px] font-semibold text-ink-2">{g.label}</span>
                <button type="button" className={quick} onClick={() => setGroup(g.rows, on < g.rows.length)}>
                  {on < g.rows.length ? "Select all" : "Clear"}
                </button>
              </legend>
              {g.rows.map((c) => (
                <label key={c.id} className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-ink/[0.04]">
                  <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} className="mt-[3px] h-4 w-4 shrink-0 accent-[var(--accent)]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-ink" title={c.name}>{c.name}</span>
                    <span className="block text-[11px] tabular-nums text-ink-3">
                      {c.meta}{c.inGuide && <span className="text-accent"> · in the guide</span>}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
          );
        })}
      </div>

      <div className="shrink-0 border-t border-line px-4 py-3">
        {hasGuide && (
          <div role="radiogroup" aria-label="What to do with the current guide" className="mb-3 flex flex-col gap-1.5 text-[13px] text-ink">
            <label className="flex cursor-pointer items-start gap-2">
              <input type="radio" name="guide-mode" checked={mode === "merge"} onChange={() => setMode("merge")} className="mt-[3px] accent-[var(--accent)]" />
              <span>Rewrite only these chapters <span className="text-ink-3">— keep the rest of the guide</span></span>
            </label>
            <label className="flex cursor-pointer items-start gap-2">
              <input type="radio" name="guide-mode" checked={mode === "replace"} onChange={() => setMode("replace")} className="mt-[3px] accent-[var(--accent)]" />
              <span>Replace the whole guide <span className="text-ink-3">— it will contain only these</span></span>
            </label>
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <span className="text-[12px] tabular-nums text-ink-3">{count} file{count === 1 ? "" : "s"} · about {Math.max(1, count * 2)} min</span>
          <span className="flex gap-2">
            <button type="button" onClick={onCancel} className="h-8 rounded-md px-3 text-[13px] text-ink-2 hover:bg-ink/[0.05]">Cancel</button>
            <button type="button" disabled={count === 0} onClick={() => onGenerate([...picked], hasGuide ? mode : "replace")}
              className="h-8 rounded-md bg-accent px-3 text-[13px] font-medium text-on-accent hover:bg-accent-strong disabled:opacity-50">
              {count === 0 ? "Choose a file" : `Write ${count} chapter${count === 1 ? "" : "s"}`}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
