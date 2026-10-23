"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import type { TasksView, TodayStep } from "@/server/tasks";
import type { TaskStep } from "@/enrich/tasks";

const fmtMin = (m: number) => (m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}`);
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// "Today" / "Tomorrow" / "Sat" / "Mon 12 Oct" for a step's YYYY-MM-DD.
export function dayLabel(date: string, today: string): string {
  const days = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  const d = new Date(`${date}T12:00:00Z`);
  if (days < 0) return "Earlier";
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 7) return WEEKDAY[d.getUTCDay()]!;
  return `${WEEKDAY[d.getUTCDay()]} ${d.getUTCDate()} ${d.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" })}`;
}

// How long a ticked step stays on the list, struck through, with Undo.
export const HOLD_MS = 5000;
const LEAVE_MS = 220;

const keyOf = (s: { taskId: number; id: string }) => `${s.taskId}:${s.id}`;

// A step just ticked (or just un-ticked): the server may not list it yet, or
// any more, but it stays where it was until its Undo runs out.
export type Held = { step: TodayStep; at: number; leaving: boolean; undone?: boolean };
export function mergeHeld(server: TodayStep[], held: Held[]): TodayStep[] {
  const have = new Set(server.map(keyOf));
  const out = [...server];
  for (const h of [...held].sort((a, b) => a.at - b.at)) if (!have.has(keyOf(h.step))) out.splice(Math.min(Math.max(0, h.at), out.length), 0, h.step);
  return out;
}

async function send(taskId: number, body: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch(`/api/tasks/${taskId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return res.ok;
  } catch { return false; }
}

// Runs jobs with the same key one after another (a job that fails does not
// stop the next). Jobs with different keys still run side by side.
export function queueBy() {
  const tails = new Map<string, Promise<unknown>>();
  return <T,>(key: string, job: () => Promise<T>): Promise<T> => {
    const run = (tails.get(key) ?? Promise.resolve()).catch(() => {}).then(job);
    tails.set(key, run);
    void run.catch(() => {}).finally(() => { if (tails.get(key) === run) tails.delete(key); });
    return run;
  };
}

// Ticks optimistically; the page refreshes from the server afterwards so
// progress bars and "done" states agree everywhere.
function useTick() {
  const router = useRouter();
  const [, start] = useTransition();
  const [local, setLocal] = useState<Record<string, boolean>>({});
  const [failed, setFailed] = useState(false);
  // A quick Undo sends "not done" while "done" may still be on its way; one
  // step's requests go in order, so the server cannot end up with the tick.
  const [queue] = useState(queueBy);
  const isDone = (taskId: number, s: TaskStep) => local[`${taskId}:${s.id}`] ?? s.done;
  const set = async (taskId: number, s: TaskStep, next: boolean) => {
    const k = `${taskId}:${s.id}`;
    setLocal((m) => ({ ...m, [k]: next }));
    const ok = await queue(k, () => send(taskId, { stepId: s.id, done: next }));
    setFailed(!ok);
    if (!ok) setLocal((m) => ({ ...m, [k]: !next }));
    start(() => router.refresh());
    return ok;
  };
  return { isDone, set, failed };
}

function Check({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  // A 20px box with a 24px target around it: the target hangs off the inside
  // of the 1px border, so 18px + 3px each side.
  return (
    <button type="button" role="checkbox" aria-checked={checked} aria-label={label} onClick={onChange}
      className={`relative mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] border transition-colors before:absolute before:-inset-[3px] before:content-[''] ${checked ? "border-accent bg-accent text-white" : "border-ink-3/60 hover:border-accent"}`}>
      {checked && <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden><path d="m3.5 8.5 3 3 6-7" /></svg>}
    </button>
  );
}

function Code({ code, moduleId }: { code: string | null; moduleId?: number | null }) {
  if (!code) return null;
  const cls = "shrink-0 font-mono text-[12px] font-medium";
  return moduleId ? <Link href={`/modules/${moduleId}`} className={`${cls} text-accent hover:underline`}>{code}</Link> : <span className={`${cls} text-ink-2`}>{code}</span>;
}

// The rows for a step (the page draws the list twice — the phone one folded
// away — so there can be two), and the one that has the keyboard.
const rowsOf = (k: string) => [...document.querySelectorAll<HTMLElement>(`[data-step="${CSS.escape(k)}"]`)];
const focusedRow = (k: string) => rowsOf(k).find((el) => el.contains(document.activeElement)) ?? null;

// Ticking a step keeps it on the list for a few seconds, struck through, with
// Undo beside it — so a slip of the finger is one click to put right, and the
// list does not jump under the pointer. Focus stays where it is: while the
// keyboard is on that row it waits, and when the row goes, focus moves to the
// list itself, never to the next step's box (one more Space would tick it).
function useHold(steps: TodayStep[]) {
  const tick = useTick();
  const [held, setHeld] = useState<Held[]>([]);
  const [said, setSaid] = useState("");
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const waiting = useRef(new Set<string>());     // ran out while the keyboard was on it
  const shown = mergeHeld(steps, held);
  const [ever, setEver] = useState(steps.length > 0);
  if (shown.length && !ever) setEver(true);

  useEffect(() => {
    const all = timers.current;
    return () => { for (const t of all.values()) clearTimeout(t); };
  }, []);
  // An un-ticked step stays put until the server lists it again.
  const [listed, setListed] = useState(steps);
  if (steps !== listed) {
    setListed(steps);
    const have = new Set(steps.map(keyOf));
    setHeld((h) => (h.some((x) => x.undone && have.has(keyOf(x.step))) ? h.filter((x) => !(x.undone && have.has(keyOf(x.step)))) : h));
  }

  const stop = (k: string) => { clearTimeout(timers.current.get(k)); timers.current.delete(k); waiting.current.delete(k); };
  const forget = (k: string) => setHeld((h) => h.filter((x) => keyOf(x.step) !== k));
  const drop = useCallback((k: string) => {
    timers.current.delete(k);
    waiting.current.delete(k);
    const el = focusedRow(k);
    setHeld((h) => h.map((x) => (keyOf(x.step) === k ? { ...x, leaving: true } : x)));
    el?.closest("section")?.focus({ preventScroll: true });
    timers.current.set(k, setTimeout(() => { timers.current.delete(k); setHeld((h) => h.filter((x) => keyOf(x.step) !== k || x.undone)); }, LEAVE_MS));
  }, []);
  const expire = useCallback((k: string) => {
    timers.current.delete(k);
    // Someone tabbing through keeps the row (and its Undo) until they move on.
    if (rowsOf(k).some((el) => el.querySelector(":focus-visible"))) waiting.current.add(k);
    else drop(k);
  }, [drop]);
  const onBlur = (k: string, e: React.FocusEvent) => {
    if (waiting.current.has(k) && !e.currentTarget.contains(e.relatedTarget as Node | null)) drop(k);
  };

  const toggle = async (s: TodayStep) => {
    const k = keyOf(s);
    const was = tick.isDone(s.taskId, s);
    stop(k);
    if (was) {
      // Undo: an open step again, in the same place. Focus goes to its box if Undo had it.
      const fromUndo = (document.activeElement as HTMLElement | null)?.dataset.undo === k;
      const row = focusedRow(k);
      setHeld((h) => h.map((x) => (keyOf(x.step) === k ? { ...x, step: { ...x.step, done: false }, undone: true, leaving: false } : x)));
      setSaid(`“${s.text}” is back on today's list.`);
      if (fromUndo && row) requestAnimationFrame(() => row.querySelector<HTMLElement>("[role=checkbox]")?.focus());
      if (!(await tick.set(s.taskId, s, false))) forget(k);
      return;
    }
    const at = shown.findIndex((x) => keyOf(x) === k);
    setHeld((h) => [...h.filter((x) => keyOf(x.step) !== k), { step: { ...s, done: true }, at, leaving: false }]);
    setSaid(`Done: “${s.text}”. Undo is next to it for a few seconds.`);
    timers.current.set(k, setTimeout(() => expire(k), HOLD_MS));
    if (!(await tick.set(s.taskId, s, true))) { stop(k); forget(k); }
  };
  return { tick, held, shown, said, toggle, onBlur, ever };
}
type Hold = ReturnType<typeof useHold>;

function TodayList({ hold, nextDay, today }: { hold: Hold; nextDay: TasksView["nextDay"]; today: string }) {
  const { tick, shown: steps, held } = hold;
  const id = useId();
  const left = steps.filter((s) => !tick.isDone(s.taskId, s));
  const minutes = steps.reduce((n, s) => n + s.minutes, 0);
  return (
    <section aria-labelledby={id} tabIndex={-1} className="rounded-[10px] border border-line bg-panel outline-none">
      <div className="flex items-baseline justify-between px-4 pt-3.5">
        <h2 id={id} className="text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-2">Today</h2>
        {steps.length > 0 && <span className="text-[13px] tabular-nums text-ink-2">{!left.length ? "All done" : left.length === steps.length ? `${steps.length} step${steps.length > 1 ? "s" : ""} · ${fmtMin(minutes)}` : `${left.length} of ${steps.length} left · ${fmtMin(left.reduce((n, s) => n + s.minutes, 0))}`}</span>}
      </div>
      <p className="sr-only" aria-live="polite">{hold.said}</p>
      {steps.length === 0 ? (
        <p className="px-4 pb-4 pt-2 text-sm text-ink-2">
          All done for today.{nextDay && <> Next: {nextDay.steps} step{nextDay.steps > 1 ? "s" : ""} ({fmtMin(nextDay.minutes)}) {dayLabel(nextDay.date, today).toLowerCase() === "tomorrow" ? "tomorrow" : `on ${dayLabel(nextDay.date, today)}`}.</>}
        </p>
      ) : (
        <ul className="flex flex-col px-4 pb-2 pt-1">
          {steps.map((s) => {
            const k = keyOf(s);
            const d = tick.isDone(s.taskId, s);
            const h = held.find((x) => keyOf(x.step) === k);
            return (
              // Folds to nothing when it leaves, so the rows below slide up
              // instead of jumping. The padding and the line under it sit
              // inside the part that folds, or the row would stop at ~21px;
              // that part reaches 4px past the row on each side so the box's
              // target is not clipped.
              <li key={k} data-step={k} onBlur={(e) => hold.onBlur(k, e)}
                className={`group/step grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${h?.leaving ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr]"}`}>
                <div className="-mx-1 min-h-0 overflow-hidden px-1">
                <div className="flex items-start gap-2.5 border-b border-line/70 py-2.5 group-last/step:border-0">
                  <Check checked={d} onChange={() => hold.toggle(s)} label={s.text} />
                  <div className="min-w-0 flex-1">
                    <p className={`text-[14px] leading-snug ${d ? "text-ink-3 line-through" : "text-ink"}`}>{s.text}</p>
                    <p className="mt-0.5 flex flex-wrap gap-x-1.5 text-[12px] text-ink-3">
                      <Code code={s.code} />
                      {s.text !== s.taskTitle && <span>for {s.taskTitle}</span>}
                      {s.late && <span className="text-warn-ink">· carried over</span>}
                    </p>
                  </div>
                  {h && d ? (
                    <button type="button" data-undo={k} onClick={() => hold.toggle(s)} aria-label={`Undo: ${s.text}`}
                      className="-my-0.5 h-6 shrink-0 rounded-md px-2 text-[12.5px] font-medium text-accent hover:bg-accent-soft">Undo</button>
                  ) : <span className="shrink-0 text-[12px] tabular-nums text-ink-3">{fmtMin(s.minutes)}</span>}
                </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// The study steps planned for today, above the views: the AI plan's part of
// the page that is about doing rather than dates. On a phone it folds away,
// so the views start on screen.
// Days in the next two weeks with more planned than fits, even after the
// worker spread the steps out: nothing could move without missing a deadline.
export function overloadText(days: TasksView["days"], today: string): string | null {
  const heavy = days.filter((d) => d.overloaded);
  if (!heavy.length) return null;
  const named = heavy.slice(0, 3).map((d) => `${dayLabel(d.date, today)} (${fmtMin(d.minutes)} planned, about ${fmtMin(d.cap)} fits)`);
  const more = heavy.length > 3 ? ` and ${heavy.length - 3} more` : "";
  return `${heavy.length === 1 ? "A heavy day" : "Heavy days"} ahead: ${named.join(", ")}${more}. These steps can't move later without missing a deadline — start some early if you can.`;
}

export function OverloadNote({ view, today }: { view: TasksView; today: string }) {
  const text = overloadText(view.days, today);
  if (!text) return null;
  return <p className="mb-6 max-w-3xl rounded-[10px] border border-line bg-panel px-4 py-3 text-[13px] text-ink-2" role="note">{text}</p>;
}

export function TodaySteps({ view, today }: { view: TasksView; today: string }) {
  const hold = useHold(view.today);
  // Nothing for today, and nothing ticked off here: no box at all.
  if (!hold.ever) return null;
  const left = hold.shown.filter((s) => !hold.tick.isDone(s.taskId, s));
  const minutes = left.reduce((n, s) => n + s.minutes, 0);
  const error = hold.tick.failed && <p className="mb-2 text-sm text-danger" role="alert">That change did not save — check your connection and try again.</p>;
  return (
    <>
      <div className="mb-6 hidden max-w-3xl sm:block">{error}<TodayList hold={hold} nextDay={view.nextDay} today={today} /></div>
      <details className="mb-4 rounded-[10px] border border-line bg-panel sm:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-[14px] [&::-webkit-details-marker]:hidden">
          <b className="font-semibold text-ink">Today’s steps</b>
          <span className="text-ink-2">{left.length ? `${left.length} · ${fmtMin(minutes)}` : "All done"} ▾</span>
        </summary>
        <div className="border-t border-line p-2">{error}<TodayList hold={hold} nextDay={view.nextDay} today={today} /></div>
      </details>
    </>
  );
}
