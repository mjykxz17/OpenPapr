import Link from "next/link";
import type { WeeklyPlan } from "@/enrich/profiles";
import type { Status } from "@/server/profiles";
import { RebuildButton } from "./RebuildButton";

const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_TODAY = 3;
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

// The week at a glance, built to be read in a few seconds: one line on the
// week, today's short checklist, the modules to lean on, and the rest of the
// week folded into one line you can open.
export function WeekPlan({ plan, status, today, moduleIdByCode, hasModel }: {
  plan: WeeklyPlan | null; status: Status; today: string; moduleIdByCode: Record<string, number>; hasModel: boolean;
}) {
  const days = plan ? [...plan.days].filter((d) => d.items.length).sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day)) : [];
  // Today if it has tasks, otherwise the next planned day.
  const lead = days.find((d) => d.day === today) ?? days.find((d) => DAY_ORDER.indexOf(d.day) > DAY_ORDER.indexOf(today)) ?? null;
  const later = days.filter((d) => d !== lead && DAY_ORDER.indexOf(d.day) > DAY_ORDER.indexOf(lead?.day ?? today));
  const code = (c: string) => {
    const id = moduleIdByCode[c.toUpperCase()];
    const cls = "shrink-0 font-mono text-[12px] font-medium";
    return id ? <Link href={`/modules/${id}`} className={`${cls} text-accent hover:underline`}>{c}</Link> : <span className={`${cls} text-ink-2`}>{c}</span>;
  };
  const total = (d: WeeklyPlan["days"][number]) => d.items.reduce((n, i) => n + i.minutes, 0);

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
        <div className="flex flex-col gap-4 px-5 py-4">
          {plan.overview && <p className="text-[14px] leading-snug text-ink-2">{clip(firstSentence(plan.overview), 120)}</p>}

          {lead ? (
            <div>
              <p className="mb-1.5 flex items-baseline justify-between text-[12px] font-semibold uppercase tracking-[0.05em] text-ink-2">
                {lead.day === today ? "Today" : lead.day}
                <span className="font-normal normal-case tracking-normal tabular-nums text-ink-3">{fmtMinutes(total(lead))}</span>
              </p>
              <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
                {lead.items.slice(0, MAX_TODAY).map((it, i) => (
                  <li key={i} className="grid grid-cols-[1fr_auto] items-baseline gap-x-3 gap-y-0.5 px-3 py-2 text-[14px] leading-snug sm:grid-cols-[auto_1fr_auto]">
                    {code(it.module)}
                    <span className="order-3 col-span-2 min-w-0 text-ink sm:order-none sm:col-span-1" title={it.task}>{clip(it.task, 70)}</span>
                    <span className="text-right text-[12px] tabular-nums text-ink-3">{it.minutes}m</span>
                  </li>
                ))}
              </ul>
              {lead.items.length > MAX_TODAY && (
                <p className="mt-1 text-[12px] text-ink-3">+{lead.items.length - MAX_TODAY} more below</p>
              )}
            </div>
          ) : (
            <p className="text-sm text-ink-3">Nothing planned for the rest of the week.</p>
          )}

          {plan.priorities.length > 0 && (
            <div className="flex flex-wrap gap-1.5" aria-label="Focus this week">
              {plan.priorities.slice(0, MAX_FOCUS).map((p, i) => (
                <span key={i} title={p.why} className="inline-flex max-w-full items-baseline gap-1.5 rounded-full border border-line px-2.5 py-1 text-[13px] text-ink-2">
                  {code(p.module)}
                  <span className="truncate">{clip(p.focus, 40)}</span>
                </span>
              ))}
            </div>
          )}

          {(later.length > 0 || (lead && lead.items.length > MAX_TODAY)) && (
            <details className="group text-[13px]">
              <summary className="flex cursor-pointer list-none items-center gap-2 text-ink-3 hover:text-ink-2 [&::-webkit-details-marker]:hidden">
                <span className="transition-transform group-open:rotate-90" aria-hidden>›</span>
                {later.length
                  ? <span>Rest of week · {later.map((d) => `${d.day} ${fmtMinutes(total(d))}`).join(" · ")}</span>
                  : <span>Show everything for {lead!.day === today ? "today" : lead!.day}</span>}
              </summary>
              <div className="mt-2 flex flex-col gap-3 pl-4">
                {lead && lead.items.length > MAX_TODAY && (
                  <DayList label={lead.day === today ? "Today" : lead.day} items={lead.items.slice(MAX_TODAY)} code={code} />
                )}
                {later.map((d) => <DayList key={d.day} label={d.day} items={d.items} code={code} />)}
              </div>
            </details>
          )}
        </div>
      )}
    </section>
  );
}

function DayList({ label, items, code }: {
  label: string; items: WeeklyPlan["days"][number]["items"]; code: (c: string) => React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[12px] font-semibold text-ink-2">{label}</p>
      <ul className="mt-0.5 flex flex-col gap-0.5">
        {items.map((it, i) => (
          <li key={i} className="grid grid-cols-[1fr_auto] items-baseline gap-x-2 text-ink-2 sm:grid-cols-[auto_1fr_auto]">
            {code(it.module)}
            <span className="order-3 col-span-2 min-w-0 sm:order-none sm:col-span-1" title={it.task}>{clip(it.task, 70)}</span>
            <span className="text-right text-[12px] tabular-nums text-ink-3">{it.minutes}m</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
