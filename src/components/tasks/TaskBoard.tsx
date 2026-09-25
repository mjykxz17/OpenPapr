"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { TaskView, TasksView, TodayStep, SourceLink } from "@/server/tasks";
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
  return { isDone, toggle, setStatus, failed };
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

function Sources({ sources }: { sources: SourceLink[] }) {
  const icon: Record<string, string> = { canvas: "Canvas", announcement: "Announcement", discussion: "Discussion", planner: "Canvas planner", file: "Slides", weightage: "Weightage", nusmods: "NUSMods" };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[12px] text-ink-3">Seen in</span>
      {sources.map((s, i) => {
        const inner = (<><span className="text-ink-3">{icon[s.kind] ?? s.kind}</span><span className="max-w-[16rem] truncate">{s.label}</span></>);
        const cls = "inline-flex items-baseline gap-1 rounded-full border border-line px-2 py-0.5 text-[12px] text-ink-2";
        return s.href ? (
          <a key={i} href={s.href} title={s.quote ? `“${s.quote}”` : undefined} className={`${cls} hover:border-accent hover:text-accent`}
            {...(s.external ? { target: "_blank", rel: "noreferrer" } : {})}>{inner}</a>
        ) : <span key={i} className={cls} title={s.quote ?? undefined}>{inner}</span>;
      })}
    </div>
  );
}

function TaskCard({ t, today, tick }: { t: TaskView; today: string; tick: ReturnType<typeof useTick> }) {
  const done = t.steps.filter((s) => tick.isDone(t.id, s)).length;
  const next = t.steps.find((s) => !tick.isDone(t.id, s));
  const overdue = t.overdue;
  return (
    <li className="rounded-[10px] border border-line bg-panel">
      <details className="group">
        <summary className="flex cursor-pointer list-none flex-col gap-1.5 px-4 py-3 [&::-webkit-details-marker]:hidden">
          <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
            <div className="flex min-w-0 flex-1 items-baseline gap-2">
              <Code code={t.code} />
              <span className="min-w-0 text-[15px] font-medium text-ink">{t.title}</span>
            </div>
            <span className={`shrink-0 text-[13px] tabular-nums ${overdue || t.missing ? "text-danger" : "text-ink-2"}`}>{t.missing ? "Missing on Canvas · " : overdue ? "Overdue · " : ""}{t.dueText}</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-3">
            <span>{KIND[t.kind] ?? t.kind}</span>
            {t.weightPct != null && <><span aria-hidden>·</span><span className="tabular-nums">{t.weightPct}% of grade</span></>}
            {t.anticipated && <><span aria-hidden>·</span><span className="rounded-full bg-accent-soft px-1.5 text-accent">Anticipated</span></>}
            {t.total > 0 && (
              <span className="ml-auto inline-flex items-center gap-2">
                <span className="h-1 w-16 overflow-hidden rounded-full bg-line" aria-hidden>
                  <span className="block h-full rounded-full bg-accent" style={{ width: `${(done / t.total) * 100}%` }} />
                </span>
                <span className="tabular-nums">{done}/{t.total} steps</span>
              </span>
            )}
          </div>
          {next && <p className="text-[13px] text-ink-2 group-open:hidden">Next: {next.text} <span className="text-ink-3">· {dayLabel(next.doBy, today)} · {fmtMin(next.minutes)}</span></p>}
        </summary>
        <div className="flex flex-col gap-3 border-t border-line px-4 py-3">
          {t.why && <p className="text-[13px] text-ink-2">{t.why}</p>}
          {t.steps.length > 0 && (
            <ul className="flex flex-col gap-2">
              {t.steps.map((s) => {
                const d = tick.isDone(t.id, s);
                return (
                  <li key={s.id} className="flex items-start gap-2.5 text-[14px]">
                    <Check checked={d} onChange={() => tick.toggle(t.id, s)} label={s.text} />
                    <span className={`min-w-0 flex-1 ${d ? "text-ink-3 line-through" : "text-ink"}`}>{s.text}</span>
                    <span className="shrink-0 text-[12px] tabular-nums text-ink-3">{dayLabel(s.doBy, today)} · {fmtMin(s.minutes)}</span>
                  </li>
                );
              })}
            </ul>
          )}
          {t.sources.length > 0 && <Sources sources={t.sources} />}
          <div className="flex gap-4 text-[13px]">
            {t.status === "open" ? (
              <>
                <button type="button" onClick={() => tick.setStatus(t.id, "done")} className="font-medium text-accent hover:underline">Mark done</button>
                <button type="button" onClick={() => tick.setStatus(t.id, "dismissed")} className="text-ink-3 hover:text-ink-2">Not needed</button>
              </>
            ) : (
              <button type="button" onClick={() => tick.setStatus(t.id, "open")} className="text-ink-3 hover:text-ink-2">Reopen</button>
            )}
          </div>
        </div>
      </details>
    </li>
  );
}

function TodayList({ steps, minutes, nextDay, today, tick }: { steps: TodayStep[]; minutes: number; nextDay: TasksView["nextDay"]; today: string; tick: ReturnType<typeof useTick> }) {
  const left = steps.filter((s) => !tick.isDone(s.taskId, s));
  return (
    <section aria-labelledby="today" className="rounded-[10px] border border-accent/30 bg-accent-soft/60">
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
                    <span>for {s.taskTitle}</span>
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

export function TaskBoard({ view, today }: { view: TasksView; today: string }) {
  const tick = useTick();
  const group = (title: string, list: TaskView[], hint?: string) => list.length > 0 && (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-2">{title}</h2>
        {hint && <span className="hidden text-[12px] text-ink-3 sm:inline">{hint}</span>}
      </div>
      <ul className="flex flex-col gap-2">{list.map((t) => <TaskCard key={t.id} t={t} today={today} tick={tick} />)}</ul>
    </section>
  );
  return (
    <div className="flex flex-col gap-8">
      {tick.failed && <p className="text-sm text-danger" role="alert">That change did not save — check your connection and try again.</p>}
      <TodayList steps={view.today} minutes={view.todayMinutes} nextDay={view.nextDay} today={today} tick={tick} />
      {group("Next two weeks", view.soon)}
      {group("Further ahead", view.later, "Anticipated work is dated as a best guess")}
      {view.done.length > 0 && (
        <details>
          <summary className="cursor-pointer text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-2 hover:text-ink">Done this week ({view.done.length})</summary>
          <ul className="mt-2.5 flex flex-col gap-2">{view.done.map((t) => <TaskCard key={t.id} t={t} today={today} tick={tick} />)}</ul>
        </details>
      )}
    </div>
  );
}
