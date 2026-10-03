"use client";

import { useMemo, useState } from "react";
import type { TaskRow } from "@/server/task-rows";
import { addDays, dayText, MONTH, mondayOf, toDate, type Change } from "./task-ui";
import type { AddAt } from "./QuickAdd";

// A month like any calendar app. Drag something to another day to move it
// (Canvas's own dates stay put); click an empty spot to add something there.
// On a phone the month shows dots, and tapping a day lists it underneath.

type Props = {
  rows: TaskRow[]; today: string; color: (id: number | null) => string; selected: string | null;
  onOpen: (id: string) => void; onChange: (r: TaskRow, c: Change) => Promise<boolean>; onAdd: (a: AddAt) => void;
};
const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function CalendarView({ rows, today, color, selected, onOpen, onChange, onAdd }: Props) {
  const [month, setMonth] = useState(today.slice(0, 7));
  const [classes, setClasses] = useState(true);
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [picked, setPicked] = useState(today);

  const shown = rows.filter((r) => r.day && (classes || !r.event));
  const byDay = useMemo(() => {
    const m = new Map<string, TaskRow[]>();
    for (const r of shown) m.set(r.day!, [...(m.get(r.day!) ?? []), r]);
    for (const list of m.values()) list.sort((a, b) => Number(b.event) - Number(a.event) || (a.time ?? "99").localeCompare(b.time ?? "99"));
    return m;
  }, [shown]);
  const first = `${month}-01`;
  const start = mondayOf(first);
  const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).toISOString().slice(0, 10);
  const weeks = Math.ceil((Number(lastDay.slice(8)) + ((toDate(first).getUTCDay() + 6) % 7)) / 7);
  const days = Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i));
  const shift = (n: number) => {
    const d = toDate(first);
    d.setUTCMonth(d.getUTCMonth() + n);
    setMonth(d.toISOString().slice(0, 7));
  };
  const dragged = drag ? rows.find((r) => r.id === drag) : null;
  const undated = rows.filter((r) => !r.day && !r.event && r.status !== "done");

  const chip = (r: TaskRow) => {
    const c = color(r.moduleId);
    const dashed = r.origin === "schedule" || r.estimated || r.week;
    return (
      <button key={r.id} type="button" draggable={r.can.date}
        onDragStart={(e) => { e.dataTransfer.setData("text/plain", r.id); e.dataTransfer.effectAllowed = "move"; setDrag(r.id); }}
        onDragEnd={() => { setDrag(null); setOver(null); }}
        onClick={(e) => { e.stopPropagation(); onOpen(r.id); }}
        title={`${r.code ? `${r.code} · ` : ""}${r.title}${r.week ? ` (during ${r.week})` : ""}${r.can.date ? "" : r.origin === "canvas" ? " · date set by Canvas" : ""}`}
        className={`flex w-full min-w-0 items-center gap-1 rounded-[5px] px-1.5 py-[3px] text-left text-[12px] leading-tight transition-opacity ${r.can.date ? "cursor-grab active:cursor-grabbing" : ""} ${drag === r.id ? "opacity-40" : ""} ${selected === r.id ? "ring-1 ring-accent" : ""} ${r.event ? "border border-line-2 text-ink-2" : "bg-sunken text-ink"} ${r.status === "done" ? "line-through opacity-60" : ""}`}
        style={{ boxShadow: r.event ? undefined : `inset 2.5px 0 0 ${c}`, borderStyle: dashed ? "dashed" : undefined, ...(dashed && !r.event ? { border: `1px dashed ${c}`, background: "transparent" } : {}) }}>
        {r.time && <span className="shrink-0 tabular-nums text-ink-3">{r.time}</span>}
        <span className={`min-w-0 truncate ${r.overdue ? "text-danger" : ""}`}>{r.title}</span>
      </button>
    );
  };

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-[17px] font-semibold text-ink">{MONTH[Number(month.slice(5)) - 1]} <span className="font-normal text-ink-3">{month.slice(0, 4)}</span></h2>
        <div className="ml-1 flex">
          <button type="button" onClick={() => shift(-1)} aria-label="Previous month" className="h-8 w-8 rounded-md text-ink-2 hover:bg-sunken hover:text-ink">‹</button>
          <button type="button" onClick={() => shift(1)} aria-label="Next month" className="h-8 w-8 rounded-md text-ink-2 hover:bg-sunken hover:text-ink">›</button>
        </div>
        {month !== today.slice(0, 7) && <button type="button" onClick={() => { setMonth(today.slice(0, 7)); setPicked(today); }} className="h-8 rounded-md border border-line-2 px-2.5 text-[12.5px] text-ink-2 hover:text-ink">Today</button>}
        <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-[12.5px] text-ink-2">
          <input type="checkbox" checked={classes} onChange={(e) => setClasses(e.target.checked)} className="accent-[var(--accent)]" /> Classes
        </label>
      </div>

      {/* Desktop month */}
      <div className="hidden sm:block">
        <div className="grid grid-cols-7 border-l border-t border-line text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-3">
          {WD.map((d) => <div key={d} className="border-b border-r border-line px-2 py-1.5">{d}</div>)}
          {days.map((day) => {
            const list = byDay.get(day) ?? [];
            const inMonth = day.startsWith(month);
            const isToday = day === today;
            return (
              <div key={day} role="gridcell" aria-label={dayText(day)}
                onClick={(e) => onAdd({ day, rect: (e.currentTarget as HTMLElement).getBoundingClientRect() })}
                onDragOver={(e) => { if (dragged?.can.date) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setOver(day); } }}
                onDragLeave={() => setOver((o) => (o === day ? null : o))}
                onDrop={(e) => { e.preventDefault(); const r = rows.find((x) => x.id === e.dataTransfer.getData("text/plain")); setOver(null); setDrag(null); if (r?.can.date && r.day !== day) onChange(r, { dueDate: day }); }}
                className={`group relative flex min-h-[104px] cursor-cell flex-col gap-[3px] border-b border-r border-line p-1.5 normal-case tracking-normal transition-colors ${inMonth ? "" : "bg-sunken/40"} ${over === day ? "bg-accent-soft outline-dashed outline-1 outline-accent" : "hover:bg-sunken/50"}`}>
                <span className={`mb-0.5 inline-flex h-[22px] min-w-[22px] items-center justify-center self-start rounded-full px-1 text-[12px] font-semibold tabular-nums ${isToday ? "bg-accent text-on-accent" : inMonth ? "text-ink" : "text-ink-3"}`}>
                  {Number(day.slice(8))}
                </span>
                {list.map(chip)}
                <span aria-hidden className="pointer-events-none absolute right-1.5 top-1.5 text-[14px] leading-none text-ink-3 opacity-0 group-hover:opacity-100">+</span>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-[12px] text-ink-3">Drag to move · click a day to add · dashed = expected from the course schedule · outlined = a class</p>
      </div>

      {/* Phone month: dots, and the picked day underneath */}
      <div className="sm:hidden">
        <div className="grid grid-cols-7 text-center text-[11px] font-semibold text-ink-3">
          {WD.map((d) => <div key={d} className="py-1">{d[0]}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-y-1">
          {days.map((day) => {
            const list = (byDay.get(day) ?? []).filter((r) => !r.event);
            const inMonth = day.startsWith(month);
            return (
              <button key={day} type="button" onClick={() => setPicked(day)}
                className={`flex h-11 flex-col items-center justify-center gap-1 rounded-lg text-[13px] tabular-nums ${day === picked ? "bg-sunken" : ""} ${inMonth ? "text-ink" : "text-ink-3/60"}`}>
                <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 ${day === today ? "bg-accent font-semibold text-on-accent" : ""}`}>{Number(day.slice(8))}</span>
                <span className="flex h-1.5 gap-[3px]">
                  {list.slice(0, 4).map((r) => <span key={r.id} className="h-1.5 w-1.5 rounded-full"
                    style={r.origin === "schedule" || r.estimated ? { border: `1px solid ${color(r.moduleId)}` } : { background: r.overdue ? "var(--danger)" : color(r.moduleId) }} />)}
                </span>
              </button>
            );
          })}
        </div>
        <div className="mt-3 rounded-xl border border-line bg-panel p-3">
          <div className="mb-2 flex items-center justify-between">
            <b className="text-[14px] text-ink">{picked === today ? "Today" : dayText(picked)}</b>
            <button type="button" onClick={(e) => onAdd({ day: picked, rect: e.currentTarget.getBoundingClientRect() })} className="text-[13px] font-medium text-accent">+ Add</button>
          </div>
          <div className="flex flex-col gap-1.5">
            {(byDay.get(picked) ?? []).map(chip)}
            {!(byDay.get(picked) ?? []).length && <p className="text-[13px] text-ink-3">Nothing on this day.</p>}
          </div>
        </div>
      </div>

      {undated.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-[0.05em] text-ink-3">No date yet · drag onto a day</h3>
          <div className="flex flex-wrap gap-1.5">
            {undated.map((r) => <div key={r.id} className="w-[200px] max-w-full">{chip(r)}</div>)}
          </div>
        </div>
      )}
    </div>
  );
}
