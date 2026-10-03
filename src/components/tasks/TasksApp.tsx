"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import type { TaskRow, WeekBand } from "@/server/task-rows";
import { moduleColors } from "@/lib/module-colors";
import { addDays, applyChange, type Change, type Mod, sendChange } from "./task-ui";
import { TableView } from "./TableView";
import { CalendarView } from "./CalendarView";
import { BoardView } from "./BoardView";
import { TaskPanel } from "./TaskPanel";
import { QuickAdd, type AddAt } from "./QuickAdd";

// The Tasks page: one list, three ways to look at it. Table to scan and tidy,
// Calendar to see and move dates, Board to see what's under way. Clicking
// anything opens it in the side panel (a sheet from the bottom on a phone).

type View = "table" | "calendar" | "board";
const VIEWS: { id: View; label: string; icon: React.ReactNode }[] = [
  { id: "table", label: "Table", icon: <path d="M2.5 3.5h11v9h-11zM2.5 6.5h11M2.5 9.5h11M6 6.5v6" /> },
  { id: "calendar", label: "Calendar", icon: <path d="M2.5 4h11v9h-11zM2.5 6.8h11M5.5 2.5V5M10.5 2.5V5" /> },
  { id: "board", label: "Board", icon: <path d="M2.5 3.5h3v9h-3zM6.5 3.5h3v6h-3zM10.5 3.5h3v4h-3z" /> },
];
const KEY = "openpapr.tasks.view";

export function TasksApp({ rows: initial, modules, today, weeks }: { rows: TaskRow[]; modules: Mod[]; today: string; weeks: WeekBand[] }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [rows, setRows] = useState(initial);
  useEffect(() => setRows(initial), [initial]);
  const [view, setView] = useState<View>("table");
  const [showDone, setShowDone] = useState(false);
  const [thisWeek, setThisWeek] = useState(false);
  const [mods, setMods] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState<AddAt | null>(null);
  const [failed, setFailed] = useState(false);
  const color = useMemo(() => moduleColors(modules), [modules]);

  // The view you used last, or the one a link asks for (?view=calendar).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("view");
    let v: string | null = q;
    if (!v) { try { v = localStorage.getItem(KEY); } catch { /* private mode */ } }
    if (v === "table" || v === "calendar" || v === "board") setView(v);
    // From search or the home calendar: /tasks#task-12 opens that task.
    const m = /^#task-(\d+)$/.exec(window.location.hash);
    if (m) setSelected(`t${m[1]}`);
  }, []);
  const pick = (v: View) => {
    setView(v);
    try { localStorage.setItem(KEY, v); } catch { /* private mode */ }
    const u = new URL(window.location.href);
    u.searchParams.set("view", v);
    window.history.replaceState(null, "", u);
  };

  const refresh = useCallback(() => start(() => router.refresh()), [router]);
  const change = useCallback(async (r: TaskRow, c: Change) => {
    setRows((all) => all.map((x) => (x.id === r.id ? applyChange(x, c) : x)));
    const ok = await sendChange(r, c);
    setFailed(!ok);
    if (!ok) setRows((all) => all.map((x) => (x.id === r.id ? r : x)));
    refresh();
    return ok;
  }, [refresh]);
  const drop = useCallback((id: string) => { setRows((all) => all.filter((x) => x.id !== id)); setSelected((s) => (s === id ? null : s)); refresh(); }, [refresh]);

  const end = addDays(today, 6);
  const visible = rows.filter((r) =>
    (showDone || r.status !== "done")
    && (!mods.size || (r.moduleId !== null && mods.has(r.moduleId)))
    && (!thisWeek || r.overdue || (r.day !== null && r.day >= today && r.day <= end)));
  const sel = rows.find((r) => r.id === selected) ?? null;
  const toggleMod = (id: number) => setMods((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const chip = (on: boolean) => `h-7 shrink-0 whitespace-nowrap rounded-full border px-3 text-[12.5px] transition-colors ${on ? "border-transparent bg-accent-soft font-semibold text-accent" : "border-line-2 text-ink-2 hover:border-ink-3 hover:text-ink"}`;

  return (
    <div className={sel ? "lg:pr-[392px]" : undefined}>
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="View" className="inline-flex rounded-[9px] bg-sunken p-[3px]">
          {VIEWS.map((v) => (
            <button key={v.id} type="button" role="tab" aria-selected={view === v.id} onClick={() => pick(v.id)}
              className={`inline-flex h-8 items-center gap-1.5 rounded-[7px] px-3 text-[13px] transition-colors ${view === v.id ? "bg-panel font-semibold text-ink shadow-sm" : "text-ink-2 hover:text-ink"}`}>
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden className="hidden sm:block">{v.icon}</svg>
              {v.label}
            </button>
          ))}
        </div>
        <button type="button" onClick={(e) => setAdding({ day: null, rect: e.currentTarget.getBoundingClientRect() })}
          className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-[13px] font-semibold text-on-accent hover:bg-accent-strong">
          <span aria-hidden className="text-[16px] leading-none">+</span> New
        </button>
      </div>

      <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]">
        <button type="button" className={chip(!showDone)} onClick={() => setShowDone((d) => !d)} aria-pressed={!showDone}>{showDone ? "Open + done" : "Open"}</button>
        <button type="button" className={chip(thisWeek)} onClick={() => setThisWeek((w) => !w)} aria-pressed={thisWeek}>Next 7 days</button>
        <span className="mx-1 w-px shrink-0 bg-line" aria-hidden />
        {modules.map((m) => (
          <button key={m.id} type="button" className={`${chip(mods.has(m.id))} shrink-0 font-mono`} onClick={() => toggleMod(m.id)} aria-pressed={mods.has(m.id)}
            style={mods.has(m.id) ? { color: color(m.id), background: `color-mix(in oklab, ${color(m.id)} 15%, transparent)` } : undefined}>{m.code}</button>
        ))}
      </div>
      {failed && <p role="alert" className="mt-2 text-[13px] text-danger">That change did not save. Check your connection and try again.</p>}

      <div className="mt-4">
        {view === "table" && <TableView rows={visible.filter((r) => !r.event)} today={today} weeks={weeks} color={color} selected={selected}
          onOpen={setSelected} onChange={change} onAdd={setAdding} />}
        {view === "calendar" && <CalendarView rows={visible} today={today} color={color} selected={selected}
          onOpen={setSelected} onChange={change} onAdd={setAdding} />}
        {view === "board" && <BoardView rows={rows.filter((r) => !r.event && (!mods.size || (r.moduleId !== null && mods.has(r.moduleId))))} today={today} color={color}
          selected={selected} onOpen={setSelected} onChange={change} />}
      </div>

      {sel && <TaskPanel key={sel.id} row={sel} today={today} modules={modules} color={color} onClose={() => setSelected(null)}
        onChange={change} onGone={drop} onRefresh={refresh} />}
      {adding && <QuickAdd at={adding} today={today} modules={modules} onClose={() => setAdding(null)} onAdded={() => { setAdding(null); refresh(); }} />}
    </div>
  );
}
