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

export { WidgetCard } from "./WidgetCard";
import { WidgetCard } from "./WidgetCard";

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
export function TodayWidget({ view, size, tomorrow }: { view: TasksView; size: "S" | "W" | "L"; tomorrow?: string }) {
  const steps = view.today;
  // Room left on the large card shows what tomorrow holds, so the day after is never a surprise.
  const later = size === "L" && tomorrow && steps.length < 5
    ? [...view.soon, ...view.later].flatMap((t) => t.steps.filter((x) => !x.done && x.doBy === tomorrow).map((x) => ({ ...x, code: t.code, taskId: t.id }))).slice(0, 5 - steps.length)
    : [];
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
    <WidgetCard title={steps.length ? `Today · ${fmtMinutes(view.todayMinutes)}` : "Today"} href="/tasks" linkLabel="All tasks">
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
      {later.length > 0 && (
        <div className="mt-4">
          <p className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-ink-3">Tomorrow</p>
          <ul className="mt-2 flex flex-col gap-2 text-[13px]">
            {later.map((s) => (
              <li key={`${s.taskId}-${s.id}`} className="flex min-w-0 items-baseline gap-2 text-ink-2">
                <span className="h-3 w-3 shrink-0 translate-y-0.5 rounded-[3px] border border-dashed border-line-2" />
                {s.code && <span className="shrink-0 font-mono text-[12px] font-medium">{s.code}</span>}
                <span className="truncate">{s.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {size === "L" && view.done.length > 0 && <p className="mt-auto pt-2 text-[12px] text-ink-3">{view.done.length} task{view.done.length === 1 ? "" : "s"} finished this week</p>}
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

// --- Coming up --------------------------------------------------------------------
// Every deadline in one list, soonest first: what is overdue, what Canvas has
// dated, and the quizzes the planner expects. The first row is the next one.
export type UpItem = { key: string; title: string; code: string | null; dueAt: number; overdue: boolean; estimated: boolean; worth: number | null; href: string };

export function UpcomingWidget({ items, now, size }: { items: UpItem[]; now: number; size: "W" | "L" | "F" }) {
  const list = items.slice(0, size === "W" ? 2 : size === "L" ? 7 : 8);
  const when = (i: UpItem) => {
    if (i.overdue) return "Overdue";
    const d = Math.round((new Date(i.dueAt).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / D);
    const base = d <= 0 ? `Today, ${new Date(i.dueAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : d === 1 ? "Tomorrow" : dayLabel(i.dueAt);
    return i.estimated ? `~ ${base}` : base;
  };
  return (
    <WidgetCard title="Coming up">
      {list.length === 0 ? <Empty>Nothing due in the next two weeks.</Empty> : (
        <ul className="flex flex-col text-[13px]">
          {list.map((i, n) => (
            <li key={i.key} className="border-b border-line/70 last:border-0">
              <Link href={i.href} className="flex min-w-0 items-baseline gap-2 py-[7px] no-underline">
                <span className="w-[62px] shrink-0 font-mono text-[12px] font-medium text-ink-2">{i.code ?? ""}</span>
                <span className={`min-w-0 flex-1 truncate ${n === 0 && !i.overdue ? "font-semibold text-ink" : "text-ink"}`} title={i.title}>
                  {i.title}
                  {i.estimated && <span className="font-normal text-ink-3"> (expected)</span>}
                  {i.worth != null && <span className="font-normal text-ink-3"> · {i.worth}%</span>}
                </span>
                <span className={`shrink-0 tabular-nums ${i.overdue ? "font-medium text-danger" : n === 0 ? "font-medium text-ink" : "text-ink-2"}`}>{when(i)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {items.length > list.length && <p className="mt-auto pt-1 text-[12px] text-ink-3">+{items.length - list.length} more on the Tasks page</p>}
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
