"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
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

const KIND: Record<string, string> = {
  exam: "Exam", quiz: "Quiz", submission: "Submission", project: "Project", presentation: "Presentation", prep: "Prep", reading: "Reading", admin: "Admin",
};

async function send(taskId: number, body: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch(`/api/tasks/${taskId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return res.ok;
  } catch { return false; }
}

// Ticks optimistically; the page refreshes from the server afterwards so
// progress bars and "done" states agree everywhere.
function useTick() {
  const router = useRouter();
  const [, start] = useTransition();
  const [local, setLocal] = useState<Record<string, boolean>>({});
  const [failed, setFailed] = useState(false);
  const isDone = (taskId: number, s: TaskStep) => local[`${taskId}:${s.id}`] ?? s.done;
  const toggle = async (taskId: number, s: TaskStep) => {
    const k = `${taskId}:${s.id}`;
    const next = !isDone(taskId, s);
    setLocal((m) => ({ ...m, [k]: next }));
    const ok = await send(taskId, { stepId: s.id, done: next });
    setFailed(!ok);
    if (!ok) setLocal((m) => ({ ...m, [k]: !next }));
    start(() => router.refresh());
  };
  const setStatus = async (taskId: number, status: "open" | "done" | "dismissed") => {
    const ok = await send(taskId, { status });
    setFailed(!ok);
    start(() => router.refresh());
  };
  // Corrections the planner learns from.
  const correct = async (taskId: number, body: { notTask: true } | { dueDate: string }) => {
    const ok = await send(taskId, body);
    setFailed(!ok);
    start(() => router.refresh());
    return ok;
  };
  return { isDone, toggle, setStatus, correct, failed };
}

function Check({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} aria-label={label} onClick={onChange}
      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] border transition-colors ${checked ? "border-accent bg-accent text-white" : "border-ink-3/60 hover:border-accent"}`}>
      {checked && <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden><path d="m3.5 8.5 3 3 6-7" /></svg>}
    </button>
  );
}

function Code({ code, moduleId }: { code: string | null; moduleId?: number | null }) {
  if (!code) return null;
  const cls = "shrink-0 font-mono text-[12px] font-medium";
  return moduleId ? <Link href={`/modules/${moduleId}`} className={`${cls} text-accent hover:underline`}>{code}</Link> : <span className={`${cls} text-ink-2`}>{code}</span>;
}

function TodayList({ steps, minutes, nextDay, today, tick }: { steps: TodayStep[]; minutes: number; nextDay: TasksView["nextDay"]; today: string; tick: ReturnType<typeof useTick> }) {
  const left = steps.filter((s) => !tick.isDone(s.taskId, s));
  return (
    <section aria-labelledby="today" className="rounded-[10px] border border-line bg-panel">
      <div className="flex items-baseline justify-between px-4 pt-3.5">
        <h2 id="today" className="text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-2">Today</h2>
        {steps.length > 0 && <span className="text-[13px] tabular-nums text-ink-2">{!left.length ? "All done" : left.length === steps.length ? `${steps.length} step${steps.length > 1 ? "s" : ""} · ${fmtMin(minutes)}` : `${left.length} of ${steps.length} left · ${fmtMin(left.reduce((n, s) => n + s.minutes, 0))}`}</span>}
      </div>
      {steps.length === 0 ? (
        <p className="px-4 pb-4 pt-2 text-sm text-ink-2">
          Nothing scheduled for today.{nextDay && <> Next: {nextDay.steps} step{nextDay.steps > 1 ? "s" : ""} ({fmtMin(nextDay.minutes)}) {dayLabel(nextDay.date, today).toLowerCase() === "tomorrow" ? "tomorrow" : `on ${dayLabel(nextDay.date, today)}`}.</>}
        </p>
      ) : (
        <ul className="flex flex-col px-4 pb-2 pt-1">
          {steps.map((s) => {
            const d = tick.isDone(s.taskId, s);
            return (
              <li key={`${s.taskId}:${s.id}`} className="flex items-start gap-2.5 border-b border-line/70 py-2.5 last:border-0">
                <Check checked={d} onChange={() => tick.toggle(s.taskId, s)} label={s.text} />
                <div className="min-w-0 flex-1">
                  <p className={`text-[14px] leading-snug ${d ? "text-ink-3 line-through" : "text-ink"}`}>{s.text}</p>
                  <p className="mt-0.5 flex flex-wrap gap-x-1.5 text-[12px] text-ink-3">
                    <Code code={s.code} />
                    {s.text !== s.taskTitle && <span>for {s.taskTitle}</span>}
                    {s.late && <span className="text-warn-ink">· carried over</span>}
                  </p>
                </div>
                <span className="shrink-0 text-[12px] tabular-nums text-ink-3">{fmtMin(s.minutes)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// The study steps planned for today, above the views: the AI plan's part of
// the page that is about doing rather than dates.
export function TodaySteps({ view, today }: { view: TasksView; today: string }) {
  const tick = useTick();
  return (
    <>
      {tick.failed && <p className="text-sm text-danger" role="alert">That change did not save — check your connection and try again.</p>}
      <TodayList steps={view.today} minutes={view.todayMinutes} nextDay={view.nextDay} today={today} tick={tick} />
    </>
  );
}
