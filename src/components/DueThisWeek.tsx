import Link from "next/link";
import type { Overview } from "@/server/overview";
import { findWeightBadge } from "@/lib/component-display";
import { dueLabel } from "@/lib/format-date";

const WEEK_MS = 7 * 86_400_000;
const MAX = 6;

// The first question a dashboard should answer. Overdue and next-seven-days
// reminders, at most six, each tied to its module and — when the title
// matches an assessment component — to what it is worth.
export function DueThisWeek({ todos, modules, now }: { todos: Overview["todos"]; modules: Overview["modules"]; now: number }) {
  const due = todos
    .filter((t) => t.category !== "routine" && t.dueAt !== null && t.dueAt < now + WEEK_MS)
    .slice(0, MAX);
  const codeFor = (moduleId: number | null) => modules.find((m) => m.id === moduleId)?.code ?? "General";
  const weightName = (t: (typeof due)[number]) => {
    const mod = modules.find((m) => m.id === t.moduleId);
    const pct = findWeightBadge(t, modules);
    if (pct == null || !mod) return null;
    const comp = mod.components.find((c) => c.weightPct === pct);
    return comp ? `${comp.name} · ${pct}% of grade` : `${pct}% of grade`;
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-2">Due this week</h2>
        <Link href="/reminders" className="text-[13px] text-ink-2 hover:text-accent">
          All reminders →
        </Link>
      </div>
      {due.length === 0 ? (
        <p className="text-sm text-ink-3">Nothing due in the next seven days.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {due.map((t) => {
            const overdue = t.dueAt !== null && t.dueAt < now;
            const worth = weightName(t);
            return (
              <li key={t.id} className="flex flex-col gap-1.5 rounded-[10px] border border-line bg-panel px-4 py-3.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-semibold text-ink-2">{codeFor(t.moduleId)}</span>
                  <span className={`text-[13px] tabular-nums ${overdue ? "font-medium text-danger" : "text-ink-2"}`}>
                    {overdue ? "Overdue · " : ""}
                    {dueLabel(t.dueAt as number, now)}
                  </span>
                </div>
                <span className="text-[15px] font-medium leading-[1.35] text-ink">{t.title}</span>
                {worth && <span className="text-[13px] text-ink-3">{worth}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
