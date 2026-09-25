import Link from "next/link";
import type { WeeklyPlan } from "@/enrich/profiles";
import type { Status } from "@/server/profiles";
import { RebuildButton } from "./RebuildButton";

const MAX_FOCUS = 4;

// Cut long model text at a word boundary so one wordy line can't flood the card.
export function clip(s: string, n: number): string {
  const t = s.trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n - 1);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.—-]+$/, "")}…`;
}

// First sentence only: the overview is a headline, not a paragraph.
export function firstSentence(s: string): string {
  const m = s.trim().match(/^.*?[.!?](?=\s|$)/);
  return m ? m[0] : s.trim();
}

export function fmtMinutes(total: number): string {
  if (total < 60) return `${total}m`;
  return `${Math.floor(total / 60)}h${total % 60 ? ` ${total % 60}m` : ""}`;
}

// The week in a few seconds, as a read rather than a to-do list: one line on
// what the week is about, the modules to lean on, and a pointer to today's
// steps, which live on the Tasks page.
export function WeekPlan({ plan, status, moduleIdByCode, hasModel, todaySteps }: {
  plan: WeeklyPlan | null; status: Status; moduleIdByCode: Record<string, number>; hasModel: boolean;
  todaySteps: { count: number; minutes: number };
}) {
  const code = (c: string) => {
    const id = moduleIdByCode[c.toUpperCase()];
    const cls = "shrink-0 font-mono text-[12px] font-medium";
    return id ? <Link href={`/modules/${id}`} className={`${cls} text-accent hover:underline`}>{c}</Link> : <span className={`${cls} text-ink-2`}>{c}</span>;
  };

  return (
    <section aria-labelledby="week-plan" className="rounded-[10px] border border-line bg-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-line px-5 py-3.5">
        <h2 id="week-plan" className="text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-2">This week</h2>
        {hasModel
          ? <RebuildButton scope="plan" status={status} noun="summary" />
          : <Link href="/account" className="text-[12px] text-accent hover:underline">Add an AI key for a weekly summary</Link>}
      </div>
      <div className="flex flex-col gap-3.5 px-5 py-4">
        {plan?.overview ? (
          <p className="text-[15px] leading-snug text-ink">{clip(firstSentence(plan.overview), 160)}</p>
        ) : (
          <p className="text-sm text-ink-2">
            {hasModel ? "A short read of your week appears after the next sync, from your modules and what is due." : "A summary of your week across modules needs an AI provider."}
          </p>
        )}
        {plan && plan.priorities.length > 0 && (
          <div className="flex flex-wrap gap-1.5" aria-label="Focus this week">
            {plan.priorities.slice(0, MAX_FOCUS).map((p, i) => (
              <span key={i} title={p.why} className="inline-flex max-w-full items-baseline gap-1.5 rounded-full border border-line px-2.5 py-1 text-[13px] text-ink-2">
                {code(p.module)}
                <span className="truncate">{clip(p.focus, 40)}</span>
              </span>
            ))}
          </div>
        )}
        <Link href="/tasks" className="group inline-flex items-baseline gap-1.5 self-start text-[13px] text-ink-2 hover:text-accent">
          {todaySteps.count
            ? <span>Today: <span className="font-medium text-ink group-hover:text-accent">{todaySteps.count} step{todaySteps.count > 1 ? "s" : ""}</span> · {fmtMinutes(todaySteps.minutes)}</span>
            : <span>Nothing scheduled for today</span>}
          <span aria-hidden>→</span>
          <span className="text-ink-3 group-hover:text-accent">Tasks</span>
        </Link>
      </div>
    </section>
  );
}
