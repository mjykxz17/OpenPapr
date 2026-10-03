"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CalDue } from "@/server/calendar-dues";
import { WidgetCard } from "./WidgetCard";

// The home calendar: a month with a coloured dot for each deadline, one
// colour per module. Hovering a day (tapping it on a phone, or focusing it
// with the keyboard) opens a card with that day's deadlines: the time, the
// part of the grade each counts toward, and how far the plan has got.

export type MonthModule = { id: number; code: string };

const PALETTE = ["#3b82f6", "#f97316", "#14b8a6", "#8b5cf6", "#ec4899", "#0ea5e9", "#65a30d", "#ca8a04"];
const GREY = "#71717a";
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const toDate = (day: string) => new Date(`${day}T12:00:00Z`);
const diffDays = (a: string, b: string) => Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86_400_000);
const fmtMin = (m: number) => (m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}`);
const dayName = (day: string, today: string) => {
  const d = toDate(day), n = diffDays(today, day);
  const base = `${WD[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
  return n === 0 ? `Today · ${base}` : n === 1 ? `Tomorrow · ${base}` : base;
};

export function MonthWidget({ today, dues, modules }: { today: string; dues: CalDue[]; modules: MonthModule[] }) {
  const [month, setMonth] = useState(() => today.slice(0, 7));
  const [open, setOpen] = useState<{ day: string; rect: DOMRect; pinned: boolean } | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const color = useMemo(() => {
    const m = new Map(modules.map((x, i) => [x.id, PALETTE[i % PALETTE.length]!]));
    return (id: number | null) => (id != null ? m.get(id) ?? GREY : GREY);
  }, [modules]);
  const byDay = useMemo(() => {
    const m = new Map<string, CalDue[]>();
    for (const d of dues) m.set(d.day, [...(m.get(d.day) ?? []), d]);
    return m;
  }, [dues]);
  const overdue = dues.filter((d) => d.overdue);
  const next = dues.find((d) => !d.overdue && !d.event && d.day >= today);

  // A tap elsewhere, Escape or scrolling closes a pinned card.
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      if (e.type === "pointerdown" && (e.target as HTMLElement).closest?.("[data-cal-pop],[data-cal-day]")) return;
      setOpen(null);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    window.addEventListener("scroll", close, true);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", close); window.removeEventListener("scroll", close, true); };
  }, [open]);

  const show = (day: string, el: HTMLElement, pinned = false) => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    if (!byDay.get(day)?.length) { if (!pinned) setOpen(null); return; }
    setOpen({ day, rect: el.getBoundingClientRect(), pinned });
  };
  const hideSoon = () => {
    if (open?.pinned) return;
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(null), 160);
  };

  const [y, mo] = month.split("-").map(Number) as [number, number];
  const lead = (toDate(`${month}-01`).getUTCDay() + 6) % 7; // Monday first
  const inMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: inMonth }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`)];
  const shift = (n: number) => { setOpen(null); setMonth(new Date(Date.UTC(y, mo - 1 + n, 1)).toISOString().slice(0, 7)); };

  return (
    <WidgetCard title={`${MONTH[mo - 1]}${y !== Number(today.slice(0, 4)) ? ` ${y}` : ""}`}
      action={
        <span className="flex items-center gap-1">
          {month !== today.slice(0, 7) && <button type="button" onClick={() => { setOpen(null); setMonth(today.slice(0, 7)); }} className="rounded px-1.5 text-[12px] text-accent hover:bg-accent-soft">Today</button>}
          <button type="button" aria-label="Previous month" onClick={() => shift(-1)} className="h-6 w-6 rounded border border-line-2 text-[12px] text-ink-2 hover:text-ink">‹</button>
          <button type="button" aria-label="Next month" onClick={() => shift(1)} className="h-6 w-6 rounded border border-line-2 text-[12px] text-ink-2 hover:text-ink">›</button>
        </span>
      }>
      <div className="grid grid-cols-7 gap-[3px] text-center" onMouseLeave={hideSoon}>
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <span key={i} className="pb-0.5 text-[10.5px] font-semibold text-ink-3">{d}</span>)}
        {cells.map((day, i) => {
          if (!day) return <span key={`b${i}`} />;
          const list = byDay.get(day) ?? [];
          const isToday = day === today;
          const past = day < today;
          const late = list.some((d) => d.overdue);
          const active = open?.day === day;
          return (
            <button key={day} type="button" data-cal-day
              aria-label={`${dayName(day, today)}${list.length ? `, ${countLabel(list)}` : ""}`}
              onMouseEnter={(e) => show(day, e.currentTarget)}
              onFocus={(e) => show(day, e.currentTarget)}
              onBlur={hideSoon}
              onClick={(e) => (active && open?.pinned ? setOpen(null) : show(day, e.currentTarget, true))}
              className={`flex h-[34px] flex-col items-center justify-center gap-[3px] rounded-[7px] text-[12.5px] tabular-nums transition-colors ${
                isToday ? "bg-accent font-bold text-on-accent" : past ? "text-ink-3" : "text-ink"
              } ${active && !isToday ? "bg-sunken ring-1 ring-ink-3 ring-inset" : !isToday ? "hover:bg-sunken" : ""} ${list.length ? "cursor-pointer" : "cursor-default"}`}>
              {Number(day.slice(8))}
              <span className="flex h-[5px] gap-[2px]">
                {list.slice(0, 3).map((d) => (
                  <span key={d.key} className="h-[5px] w-[5px] rounded-full"
                    style={d.estimated || d.event
                      ? { border: `1px ${d.event ? "solid" : "dashed"} ${isToday ? "var(--on-accent)" : color(d.moduleId)}` }
                      : { background: isToday ? "var(--on-accent)" : late && d.overdue ? "var(--danger)" : color(d.moduleId), opacity: past && !d.overdue ? 0.5 : 1 }} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-auto flex min-w-0 items-baseline gap-2 pt-2 text-[12.5px] text-ink-2">
        {overdue.length > 0 && <Link href="/tasks" className="shrink-0 font-medium text-danger no-underline">{overdue.length} overdue</Link>}
        {next ? (
          <span className="truncate">Next: <b className="font-semibold text-ink">{next.code ? `${next.code} ` : ""}{next.title}</b> · {diffDays(today, next.day) === 0 ? `today ${next.time}` : diffDays(today, next.day) === 1 ? `tomorrow ${next.time}` : `${WD[toDate(next.day).getUTCDay()]} ${toDate(next.day).getUTCDate()} ${MON[toDate(next.day).getUTCMonth()]}`}</span>
        ) : overdue.length === 0 && <span className="text-ink-3">Nothing due. Enjoy it.</span>}
      </div>
      {open && typeof document !== "undefined" && createPortal(
        <DayCard day={open.day} rect={open.rect} today={today} list={byDay.get(open.day) ?? []} color={color}
          onEnter={() => closeTimer.current && clearTimeout(closeTimer.current)} onLeave={hideSoon} />,
        document.body,
      )}
    </WidgetCard>
  );
}

// "2 due", "1 event", "1 due · 1 event".
function countLabel(list: CalDue[]): string {
  const ev = list.filter((d) => d.event).length, due = list.length - ev;
  return [due ? `${due} due` : "", ev ? `${ev} event${ev === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");
}

function DayCard({ day, rect, today, list, color, onEnter, onLeave }: {
  day: string; rect: DOMRect; today: string; list: CalDue[]; color: (id: number | null) => string; onEnter: () => void; onLeave: () => void;
}) {
  const W = 300;
  const left = Math.max(8, Math.min(rect.left + rect.width / 2 - W / 2, window.innerWidth - W - 8));
  const below = window.innerHeight - rect.bottom > 260 || rect.top < 260;
  const style = below ? { left, top: rect.bottom + 6 } : { left, bottom: window.innerHeight - rect.top + 6 };
  const shown = list.slice(0, 4);
  return (
    <div data-cal-pop role="dialog" aria-label={dayName(day, today)} onMouseEnter={onEnter} onMouseLeave={onLeave}
      className="fixed z-50 max-w-[calc(100vw-16px)] rounded-xl border border-line-2 bg-panel p-3.5 text-[13px] shadow-[0_18px_40px_-12px_rgba(0,0,0,0.45)]"
      style={{ ...style, width: W }}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">{dayName(day, today)} · {countLabel(list)}</p>
      {shown.map((d, i) => (
        <div key={d.key} className={i > 0 ? "mt-3 border-t border-line pt-3" : "mt-1.5"}>
          <p className="text-[14px] font-semibold leading-snug text-ink">
            {d.code && <span className="mr-1.5 text-[12px] font-bold" style={{ color: color(d.moduleId) }}>{d.code}</span>}{d.title}
          </p>
          <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-ink-2">
            {d.schedule ? (
              <>
                <dt>When</dt>
                <dd className="text-right font-medium text-ink">{d.schedule.placed === "week" ? `during ${d.schedule.week ?? "this week"}` : d.schedule.placed === "slot" ? `${d.time}, in class (expected)` : d.time}</dd>
                {d.schedule.covers && <><dt>Covers</dt><dd className="text-right font-medium text-ink">{d.schedule.covers}</dd></>}
              </>
            ) : (
              <>
                <dt>{d.event ? "Starts" : d.overdue ? "Was due" : d.estimated ? "Expected" : "Due"}</dt>
                <dd className={`text-right font-medium ${d.overdue ? "text-danger" : "text-ink"}`}>{d.estimated ? `around ${d.time === "23:59" ? "this day" : d.time}` : d.time}{d.exam && " · exam"}</dd>
              </>
            )}
            {d.counts && <><dt>Counts toward</dt><dd className="text-right font-medium text-ink">{d.counts.name} · {d.counts.pct}%</dd></>}
            {d.event?.repeats && <><dt>Repeats</dt><dd className="text-right font-medium text-ink">{d.event.repeats} more this term</dd></>}
            {d.plan && <><dt>Your plan</dt><dd className="text-right font-medium text-ink">{d.plan.done} of {d.plan.total} steps{d.plan.minutesLeft ? ` · ${fmtMin(d.plan.minutesLeft)} left` : " · done"}</dd></>}
          </dl>
          {d.schedule && <p className="mt-1.5 text-[12.5px] leading-snug text-ink-2">From the course schedule ({d.schedule.source}). No task for it yet.</p>}
          {d.event && <p className="mt-1.5 text-[12.5px] leading-snug text-ink-2">{d.event.note ?? "A Canvas calendar event, not something to hand in."}</p>}
          {d.plan && <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-sunken"><div className="h-full bg-accent" style={{ width: `${Math.round((d.plan.done / d.plan.total) * 100)}%` }} /></div>}
          <Link href={d.href} className="mt-2 inline-block text-[12.5px] font-semibold text-accent no-underline hover:underline">{d.href.startsWith("/tasks") ? "Open in Tasks →" : d.href.includes("/files/") ? "Open the slide →" : "Open module →"}</Link>
        </div>
      ))}
      {list.length > shown.length && <Link href="/tasks" className="mt-3 block text-[12.5px] text-ink-3 no-underline">+{list.length - shown.length} more in Tasks</Link>}
    </div>
  );
}
