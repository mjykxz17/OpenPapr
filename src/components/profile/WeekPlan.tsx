import Link from "next/link";
import type { WeeklyPlan } from "@/enrich/profiles";
import type { Status } from "@/server/profiles";
import { RebuildButton } from "./RebuildButton";

const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// The week at a glance: what matters in each module and a day-by-day list,
// written from the module profiles, the student profile and what is due.
export function WeekPlan({ plan, status, today, moduleIdByCode, hasModel }: {
  plan: WeeklyPlan | null; status: Status; today: string; moduleIdByCode: Record<string, number>; hasModel: boolean;
}) {
  const days = plan ? [...plan.days].sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day)) : [];
  const link = (code: string) => {
    const id = moduleIdByCode[code.toUpperCase()];
    return id ? <Link href={`/modules/${id}`} className="font-medium text-ink hover:text-accent">{code}</Link> : <span className="font-medium text-ink">{code}</span>;
  };
  return (
    <section aria-labelledby="week-plan" className="rounded-[10px] border border-line bg-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-line px-5 py-3.5">
        <h2 id="week-plan" className="text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-2">This week</h2>
        {hasModel
          ? <RebuildButton scope="plan" status={status} noun="plan" />
          : <Link href="/account" className="text-[12px] text-accent hover:underline">Add an AI key for a weekly plan</Link>}
      </div>
      {!plan ? (
        <p className="px-5 py-5 text-sm text-ink-2">
          {hasModel ? "Your plan for the week is built after the next sync, from your modules, their profiles and what is due." : "A weekly plan across your modules needs an AI provider."}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-x-10 gap-y-5 px-5 py-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div>
            <p className="text-[15px] leading-[1.55] text-ink">{plan.overview}</p>
            {plan.priorities.length > 0 && (
              <ol className="mt-3 flex flex-col gap-2">
                {plan.priorities.map((p, i) => (
                  <li key={i} className="text-[14px] leading-[1.5] text-ink-2">
                    {link(p.module)} — {p.focus} <span className="text-ink-3">({p.why})</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
          <div className="flex flex-col gap-3">
            {days.map((d) => {
              const total = d.items.reduce((n, i) => n + i.minutes, 0);
              const isToday = d.day === today;
              return (
                <div key={d.day} className={`rounded-md border px-3 py-2 ${isToday ? "border-accent/40 bg-accent-soft" : "border-line"}`}>
                  <p className="flex items-baseline justify-between text-[13px] font-semibold text-ink">
                    {isToday ? `Today · ${d.day}` : d.day}
                    <span className="font-normal tabular-nums text-ink-3">{total >= 60 ? `${Math.floor(total / 60)}h${total % 60 ? ` ${total % 60}m` : ""}` : `${total}m`}</span>
                  </p>
                  <ul className="mt-1 flex flex-col gap-1">
                    {d.items.map((it, i) => (
                      <li key={i} className="flex items-baseline justify-between gap-3 text-[14px] leading-[1.45] text-ink-2">
                        <span>{link(it.module)} {it.task}</span>
                        <span className="shrink-0 text-[12px] tabular-nums text-ink-3">{it.minutes}m</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
            {days.length === 0 && <p className="text-sm text-ink-3">No tasks planned for the rest of the week.</p>}
          </div>
        </div>
      )}
    </section>
  );
}
