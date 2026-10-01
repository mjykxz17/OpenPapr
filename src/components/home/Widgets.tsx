import Link from "next/link";
import type { ReactNode } from "react";
import type { WeeklyPlan } from "@/enrich/profiles";
import type { Overview } from "@/server/overview";
import type { TasksView } from "@/server/tasks";
import { clip, firstSentence, fmtMinutes } from "@/components/profile/WeekPlan";
import { WeightBar } from "@/components/WeightBar";
import { dayLabel } from "@/lib/format-date";

// The small faces of the home widgets. Server-rendered, so every date is
// formatted once, in Singapore time, and the browser never disagrees.

const D = 86_400_000;

export function WidgetCard({ title, href, children, className = "" }: { title: string; href?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`@container flex h-full flex-col gap-3 overflow-hidden rounded-[10px] border border-line bg-panel px-[18px] py-4 ${className}`}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="truncate text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-2">{title}</h2>
        {href && <Link href={href} className="hidden shrink-0 text-[12px] text-ink-3 hover:text-accent @[210px]:inline">Open →</Link>}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

const Big = ({ n, unit }: { n: ReactNode; unit: string }) => (
  <div className="flex items-baseline gap-1.5">
    <span className="text-[32px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-ink">{n}</span>
    <span className="text-[13px] text-ink-2">{unit}</span>
  </div>
);

const Empty = ({ children }: { children: ReactNode }) => <p className="text-[13px] text-ink-3">{children}</p>;

function inDays(ms: number, now: number): string {
  const days = Math.round((new Date(ms).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / D);
  return days <= 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
}

// --- This week ---------------------------------------------------------------
export function WeekWidget({ plan, today, size }: { plan: WeeklyPlan | null; today: { count: number; minutes: number } | null; size: "W" | "L" }) {
  const todayLine = !today ? null : today.count ? `Today: ${today.count} step${today.count === 1 ? "" : "s"} · ${fmtMinutes(today.minutes)}` : "Nothing scheduled today";
  return (
    <WidgetCard title="This week" href="/tasks">
      {plan ? (
        <p className="text-[14px] leading-[1.5] text-ink">{clip(firstSentence(plan.overview), size === "W" ? 110 : 160)}</p>
      ) : (
        <Empty>No weekly summary yet.</Empty>
      )}
      {size === "L" && plan && plan.priorities.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5 text-[13px]">
          {plan.priorities.slice(0, 4).map((p) => (
            <li key={`${p.module}-${p.focus}`} className="flex gap-2 truncate" title={p.why}>
              <span className="shrink-0 font-mono text-[12px] font-medium text-ink-2">{p.module}</span>
              <span className="truncate text-ink">{p.focus}</span>
            </li>
          ))}
        </ul>
      )}
      {todayLine && <p className="mt-auto pt-2 text-[13px] text-ink-2">{todayLine}</p>}
    </WidgetCard>
  );
}

// --- Today's steps -------------------------------------------------------------
export function TodayWidget({ view, size }: { view: TasksView; size: "S" | "W" | "L" }) {
  const steps = view.today;
  if (size === "S") {
    return (
      <WidgetCard title="Today" href="/tasks">
        {steps.length ? <Big n={steps.length} unit={steps.length === 1 ? "step" : "steps"} /> : <Big n="0" unit="steps" />}
        <p className="mt-auto text-[13px] text-ink-2">{steps.length ? fmtMinutes(view.todayMinutes) : view.nextDay ? `Next: ${dayLabel(Date.parse(`${view.nextDay.date}T12:00:00+08:00`))}` : "A free day"}</p>
      </WidgetCard>
    );
  }
  const max = size === "W" ? 2 : 7;
  return (
    <WidgetCard title={steps.length ? `Today · ${fmtMinutes(view.todayMinutes)}` : "Today"} href="/tasks">
      {steps.length === 0 ? (
        <Empty>{view.nextDay ? `Nothing today. Next steps on ${dayLabel(Date.parse(`${view.nextDay.date}T12:00:00+08:00`))}.` : "Nothing scheduled. Enjoy it."}</Empty>
      ) : (
        <ul className="flex flex-col gap-2 text-[13px]">
          {steps.slice(0, max).map((s) => (
            <li key={`${s.taskId}-${s.id}`} className="flex min-w-0 items-baseline gap-2">
              <span className={`h-3 w-3 shrink-0 translate-y-0.5 rounded-[3px] border ${s.late ? "border-danger" : "border-line-2"}`} />
              {s.code && <span className="shrink-0 font-mono text-[12px] font-medium text-ink-2">{s.code}</span>}
              <span className="truncate text-ink">{s.text}</span>
            </li>
          ))}
          {steps.length > max && <li className="text-ink-3">+{steps.length - max} more</li>}
        </ul>
      )}
    </WidgetCard>
  );
}

// --- Next deadline ---------------------------------------------------------------
export type NextUp = { title: string; code: string | null; dueAt: number; estimated: boolean; href: string | null };

export function NextWidget({ items, overdue, now, size }: { items: NextUp[]; overdue: number; now: number; size: "S" | "W" }) {
  const first = items[0];
  return (
    <WidgetCard title="Next up" href="/tasks">
      {!first ? (
        <Empty>Nothing due.</Empty>
      ) : (
        <div className="flex min-w-0 flex-col gap-1">
          {(() => {
            const days = Math.max(0, Math.round((new Date(first.dueAt).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / D));
            const about = first.estimated ? " (about)" : "";
            return days === 0 ? <Big n="Today" unit={about.trim()} /> : <Big n={days} unit={`${days === 1 ? "day" : "days"}${about}`} />;
          })()}
          <p className="truncate text-[13px] font-medium text-ink" title={first.title}>{first.code ? `${first.code} · ` : ""}{first.title}</p>
          {size === "W" && items[1] && (
            <p className="truncate text-[13px] text-ink-2">Then {items[1].code ? `${items[1].code} ` : ""}{items[1].title}, {inDays(items[1].dueAt, now)}</p>
          )}
        </div>
      )}
      {overdue > 0 && <p className="mt-auto pt-1 text-[12px] font-medium text-danger">{overdue} overdue</p>}
    </WidgetCard>
  );
}

// --- Done this week ----------------------------------------------------------------
export function DoneWidget({ view, size }: { view: TasksView; size: "S" | "W" }) {
  const n = view.done.length;
  return (
    <WidgetCard title="Completed" href="/tasks">
      <Big n={n} unit={n === 1 ? "task" : "tasks"} />
      <p className="mt-1 text-[13px] text-ink-2">this week</p>
      {size === "W" && n > 0 && <p className="mt-auto truncate text-[13px] text-ink-3">Latest: {view.done[0].title}</p>}
    </WidgetCard>
  );
}

// --- Due this week (compact) ----------------------------------------------------------
export function DueWidget({ todos, modules, now, size }: { todos: Overview["todos"]; modules: Overview["modules"]; now: number; size: "W" | "L" }) {
  const due = todos.filter((t) => t.category !== "routine" && t.dueAt !== null && t.dueAt < now + 7 * D).slice(0, size === "W" ? 2 : 6);
  const code = (id: number | null) => modules.find((m) => m.id === id)?.code ?? "";
  return (
    <WidgetCard title="Due this week" href="/tasks">
      {due.length === 0 ? <Empty>Nothing due in the next seven days.</Empty> : (
        <ul className="flex flex-col gap-2.5 text-[13px]">
          {due.map((t) => {
            const late = t.dueAt! < now;
            return (
              <li key={t.id} className="flex min-w-0 items-baseline gap-2">
                <span className="w-[62px] shrink-0 font-mono text-[12px] font-medium text-ink-2">{code(t.moduleId)}</span>
                <span className="truncate text-ink">{t.title}</span>
                <span className={`ml-auto shrink-0 tabular-nums ${late ? "font-medium text-danger" : "text-ink-2"}`}>{late ? "Overdue" : dayLabel(t.dueAt!)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </WidgetCard>
  );
}

// --- Modules (compact) ------------------------------------------------------------------
export function ModulesWidget({ modules, size }: { modules: Overview["modules"]; size: "W" | "L" }) {
  const list = modules.filter((m) => !m.hidden).slice(0, size === "W" ? 2 : 6);
  return (
    <WidgetCard title="Modules">
      <ul className="flex flex-col gap-2.5 text-[13px]">
        {list.map((m) => (
          <li key={m.id}>
            <Link href={`/modules/${m.id}`} className="grid grid-cols-[62px_minmax(0,1fr)_64px] items-center gap-2 no-underline">
              <span className="font-mono text-[12px] font-medium text-ink">{m.code}</span>
              <span className="truncate text-ink-2" title={m.next ? `${m.next.title} · ${m.next.when}` : m.shortName}>
                {m.next ? <>{m.next.title} <span className="text-ink-3">· {m.next.when}</span></> : m.shortName}
              </span>
              <WeightBar components={m.components} height="h-1.5" />
            </Link>
          </li>
        ))}
      </ul>
    </WidgetCard>
  );
}
