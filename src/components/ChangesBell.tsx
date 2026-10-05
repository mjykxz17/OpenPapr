"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeView } from "@/server/changes";

// The bell: what the courses changed. A date you set that an announcement
// contradicts waits here for you to choose; dates moved for you can be
// undone; newly found work can be confirmed or thrown out.

const fmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Singapore" });
const fmtDay = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Singapore" });
// "Tue 13 Oct, 18:30", or "Tue 13 Oct" for "by the end of the day".
function when(ms: number | null): string {
  if (ms === null) return "no date";
  const parts = fmt.formatToParts(ms);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const time = `${get("hour")}:${get("minute")}`;
  return `${get("weekday")} ${get("day")} ${get("month")}${time === "23:59" ? "" : `, ${time}`}`;
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

async function act(id: number, action: string): Promise<boolean> {
  try {
    return (await fetch(`/api/changes/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) })).ok;
  } catch { return false; }
}

function useChanges(initial: number) {
  const router = useRouter();
  const [count, setCount] = useState(initial);
  useEffect(() => setCount(initial), [initial]);
  const [list, setList] = useState<ChangeView[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/changes");
      if (!r.ok) return;
      const { changes } = (await r.json()) as { changes: ChangeView[] };
      setList(changes);
      setCount(changes.filter((c) => c.open).length);
    } catch { /* offline: keep what we have */ }
  }, []);
  const run = async (id: number, action: string) => {
    setBusy(id);
    const ok = await act(id, action);
    setBusy(null);
    setFailed(!ok);
    await load();
    router.refresh();
  };
  const seenAll = async () => {
    await fetch("/api/changes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "seen_all" }) }).catch(() => null);
    await load();
    router.refresh();
  };
  return { count, list, load, run, seenAll, busy, failed };
}

function Panel({ c, onClose }: { c: ReturnType<typeof useChanges>; onClose: () => void }) {
  const informational = (c.list ?? []).some((x) => x.open && x.kind !== "date_proposed");
  const btn = "h-8 rounded-md px-3 text-[13px] font-medium disabled:opacity-50";
  return (
    <>
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <h2 className="text-[14px] font-semibold text-ink">Changes from your courses</h2>
        <div className="flex items-center gap-3">
          {informational && <button type="button" onClick={c.seenAll} className="text-[12.5px] text-ink-3 hover:text-ink">Mark all seen</button>}
          <button type="button" onClick={onClose} aria-label="Close" className="h-7 w-7 rounded-md text-ink-3 hover:bg-sunken hover:text-ink">✕</button>
        </div>
      </div>
      {c.failed && <p role="alert" className="px-4 pt-2 text-[12.5px] text-danger">That didn't save. Try again.</p>}
      {c.list === null ? <p className="px-4 py-6 text-[13px] text-ink-3">Loading…</p>
        : !c.list.length ? <p className="px-4 py-6 text-[13px] leading-relaxed text-ink-2">Nothing has changed. When a course moves a date or adds work, it shows up here.</p>
        : (
          <ul className="max-h-[min(70vh,560px)] overflow-y-auto">
            {c.list.map((x) => (
              <li key={x.id} className={`border-b border-line px-4 py-3 last:border-0 ${x.open ? "" : "opacity-60"}`}>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[13.5px]">
                  {x.open && <span aria-hidden className="relative top-[-1px] h-2 w-2 shrink-0 rounded-full bg-warn" />}
                  <b className="font-semibold text-ink">{x.title}</b>
                  {x.code && <span className="font-mono text-[11.5px] font-semibold text-ink-2">{x.code}</span>}
                  {x.kind === "task_added" && <span className="text-ink-3">added{x.newDueAt ? ` · ${when(x.newDueAt)}` : ""}</span>}
                </div>
                {x.kind !== "task_added" && (
                  <div className="mt-1 flex flex-wrap items-baseline gap-x-2 text-[13.5px]">
                    <s className="text-ink-3">{when(x.oldDueAt)}{x.kind === "date_proposed" ? " (yours)" : ""}</s>
                    <span className="text-ink-3">→</span>
                    <b className="font-semibold text-ink">{when(x.newDueAt)}</b>
                    {x.kind === "date_moved" && x.open && <span className="text-[12.5px] text-ink-3">moved for you</span>}
                  </div>
                )}
                {x.source.quote && <p className="mt-1.5 border-l-2 border-line-2 pl-2 text-[12.5px] leading-snug text-ink-2">“{x.source.quote}”</p>}
                {x.source.label && (
                  <p className="mt-1 text-[12px] text-ink-3">
                    {x.source.href ? <Link href={x.source.href} onClick={onClose} className="hover:text-accent">{x.source.label} ↗</Link> : x.source.label}
                  </p>
                )}
                {x.open ? (
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    {x.kind === "date_proposed" && <>
                      <button type="button" disabled={c.busy === x.id} onClick={() => c.run(x.id, "accept")} className={`${btn} bg-accent text-on-accent hover:bg-accent-strong`}>Use {x.newDueAt ? fmtDay.format(x.newDueAt) : "theirs"}</button>
                      <button type="button" disabled={c.busy === x.id} onClick={() => c.run(x.id, "keep")} className={`${btn} border border-line-2 text-ink hover:border-ink-3`}>Keep mine</button>
                    </>}
                    {x.kind === "date_moved" && <>
                      <button type="button" disabled={c.busy === x.id} onClick={() => c.run(x.id, "seen")} className={`${btn} border border-line-2 text-ink hover:border-ink-3`}>OK</button>
                      <button type="button" disabled={c.busy === x.id} onClick={() => c.run(x.id, "undo")} className={`${btn} text-accent hover:underline`}>Undo</button>
                    </>}
                    {x.kind === "task_added" && <>
                      <button type="button" disabled={c.busy === x.id} onClick={() => c.run(x.id, "seen")} className={`${btn} border border-line-2 text-ink hover:border-ink-3`}>Looks right</button>
                      <button type="button" disabled={c.busy === x.id} onClick={() => c.run(x.id, "not_task")} className={`${btn} text-ink-3 hover:text-danger`}>Not a task</button>
                    </>}
                  </div>
                ) : (
                  <p className="mt-1.5 text-[12px] text-ink-3">
                    {x.status === "accepted" ? `Moved to ${when(x.newDueAt)}` : x.status === "kept" ? `You kept ${when(x.oldDueAt)}` : x.status === "undone" ? (x.kind === "task_added" ? "Removed" : `Back to ${when(x.oldDueAt)}`) : "Seen"}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
    </>
  );
}

function useDismiss(open: boolean, close: () => void, ref: React.RefObject<HTMLElement | null>, trigger: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || trigger.current?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("pointerdown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open, close, ref, trigger]);
}

// In the side rail on a computer.
export function ChangesBell({ count: initial }: { count: number }) {
  const c = useChanges(initial);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, box, btn);
  const [top, setTop] = useState(80);
  return (
    <>
      <button ref={btn} type="button" title="Changes from your courses" aria-label={`Changes from your courses${c.count ? `, ${c.count} new` : ""}`} aria-expanded={open}
        onClick={() => { if (!open) { setTop(Math.max(12, Math.min((btn.current?.getBoundingClientRect().top ?? 80) - 8, window.innerHeight - 520))); void c.load(); } setOpen((o) => !o); }}
        className={`relative flex h-11 w-11 items-center justify-center rounded-md transition-colors ${open ? "bg-accent-soft text-accent" : "text-ink-2 hover:bg-ink/[0.05] hover:text-ink"}`}>
        <BellIcon />
        {c.count > 0 && <span className="absolute right-1.5 top-1.5 flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-danger px-1 text-[10.5px] font-bold leading-none text-white">{c.count}</span>}
      </button>
      {open && (
        <div ref={box} role="dialog" aria-label="Changes from your courses" style={{ top }}
          className="fixed left-[64px] z-50 w-[420px] max-w-[calc(100vw-80px)] overflow-hidden rounded-xl border border-line-2 bg-panel shadow-2xl">
          <Panel c={c} onClose={close} />
        </div>
      )}
    </>
  );
}

// On a phone, where the tab bar is full: a line at the top of the page while
// something is waiting, opening the same list from the bottom.
export function ChangesStrip({ count: initial }: { count: number }) {
  const c = useChanges(initial);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, box, btn);
  if (c.count === 0 && !open) return null;
  return (
    <>
      <button ref={btn} type="button" onClick={() => { void c.load(); setOpen(true); }}
        className="mb-4 flex w-full items-center gap-2.5 rounded-[10px] border border-warn-line bg-warn-soft px-3.5 py-2.5 text-left text-[14px] text-warn-ink sm:hidden">
        <BellIcon />
        <span className="flex-1 font-medium">{c.count} change{c.count === 1 ? "" : "s"} from your courses</span>
        <span aria-hidden>›</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40 sm:hidden" aria-hidden />
          <div ref={box} role="dialog" aria-label="Changes from your courses"
            className="fixed inset-x-0 bottom-0 z-50 max-h-[85svh] overflow-hidden rounded-t-2xl border-t border-line bg-panel pb-[env(safe-area-inset-bottom)] shadow-2xl sm:hidden">
            <Panel c={c} onClose={close} />
          </div>
        </>
      )}
    </>
  );
}
