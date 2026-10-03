"use client";

import { useState } from "react";
import type { TaskRow, WeekBand } from "@/server/task-rows";
import { addDays, Check, EDIT_KINDS, KIND, ModTag, mondayOf, ORIGIN, Progress, rangeText, StatusPill, whenText, type Change } from "./task-ui";
import type { AddAt } from "./QuickAdd";

// Grouped by week like a Notion table. Name, due date, type and status edit
// in place where the row allows it; anything else opens the side panel.

type Group = { key: string; label: string; addDay: string | null; rows: TaskRow[] };

export function groupRows(rows: TaskRow[], weeks: WeekBand[], today: string): Group[] {
  const out = new Map<string, Group>();
  const put = (key: string, label: string, addDay: string | null, r: TaskRow) => {
    const g = out.get(key) ?? { key, label, addDay, rows: [] };
    g.rows.push(r);
    out.set(key, g);
  };
  for (const r of rows) {
    if (r.overdue) { put("overdue", "Overdue", null, r); continue; }
    if (!r.day) { put("none", "No date", null, r); continue; }
    const w = weeks.find((b) => r.day! >= b.from && r.day! <= b.to);
    const mon = w ? w.from : mondayOf(r.day);
    const sun = w ? w.to : addDays(mon, 6);
    const addDay = today > mon && today <= sun ? today : mon;
    put(`w${mon}`, `${w ? w.label : "Week of"} · ${rangeText(mon, sun)}`, addDay, r);
  }
  const order = (k: string) => (k === "overdue" ? "0" : k === "none" ? "z" : k);
  return [...out.values()].sort((a, b) => order(a.key).localeCompare(order(b.key)));
}

type Props = {
  rows: TaskRow[]; today: string; weeks: WeekBand[]; color: (id: number | null) => string; selected: string | null;
  onOpen: (id: string) => void; onChange: (r: TaskRow, c: Change) => Promise<boolean>; onAdd: (a: AddAt) => void;
};

export function TableView({ rows, today, weeks, color, selected, onOpen, onChange, onAdd }: Props) {
  const groups = groupRows(rows, weeks, today);
  if (!groups.length) return <p className="py-10 text-center text-[14px] text-ink-2">Nothing here. Press <b>+ New</b> to add something.</p>;
  return (
    <>
      {/* Desktop: the table. */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[860px] border-collapse text-[13.5px]">
          <thead>
            <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
              <th className="w-8 border-b border-line py-2" aria-label="Done" />
              <th className="border-b border-line py-2 pr-3">Name</th>
              <th className="w-[96px] border-b border-line py-2 pr-3">Module</th>
              <th className="w-[170px] border-b border-line py-2 pr-3">Due</th>
              <th className="w-[118px] border-b border-line py-2 pr-3">Type</th>
              <th className="w-[92px] border-b border-line py-2 pr-3">Status</th>
              <th className="w-[64px] border-b border-line py-2 pr-3">Weight</th>
              <th className="w-[104px] border-b border-line py-2 pr-3">Progress</th>
              <th className="w-[80px] border-b border-line py-2">From</th>
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.key}>
              <tr><td colSpan={9} className={`pb-1.5 pt-5 text-[12.5px] font-semibold ${g.key === "overdue" ? "text-danger" : "text-ink-2"}`}>{g.label} <span className="font-normal text-ink-3">{g.rows.length}</span></td></tr>
              {g.rows.map((r) => <Row key={r.id} r={r} today={today} color={color} on={selected === r.id} onOpen={onOpen} onChange={onChange} />)}
              {g.key !== "overdue" && (
                <tr><td colSpan={9} className="py-1.5">
                  <button type="button" onClick={(e) => onAdd({ day: g.addDay, rect: e.currentTarget.getBoundingClientRect() })}
                    className="pl-8 text-[13px] text-ink-3 hover:text-accent">+ New{g.addDay ? "" : " without a date"}</button>
                </td></tr>
              )}
            </tbody>
          ))}
        </table>
      </div>

      {/* Phone: cards, by the same groups. */}
      <div className="flex flex-col gap-1 sm:hidden">
        {groups.map((g) => (
          <section key={g.key}>
            <h3 className={`mb-1.5 mt-3 text-[12px] font-bold uppercase tracking-[0.05em] ${g.key === "overdue" ? "text-danger" : "text-ink-2"}`}>{g.label}</h3>
            <ul className="flex flex-col gap-2">
              {g.rows.map((r) => (
                <li key={r.id}>
                  <div role="button" tabIndex={0} onClick={() => onOpen(r.id)} onKeyDown={(e) => e.key === "Enter" && onOpen(r.id)}
                    className={`flex items-start gap-3 rounded-xl border bg-panel px-3.5 py-3 ${r.origin === "schedule" ? "border-dashed border-line-2" : "border-line"} ${selected === r.id ? "border-accent" : ""}`}>
                    <span className="pt-0.5"><Check checked={r.status === "done"} disabled={!r.can.done} label={`Done: ${r.title}`}
                      onChange={() => onChange(r, { status: r.status === "done" ? "open" : "done" })} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <b className={`min-w-0 truncate text-[14.5px] font-semibold ${r.status === "done" ? "text-ink-3 line-through" : "text-ink"}`}>{r.title}</b>
                        <span className={`shrink-0 text-[12.5px] tabular-nums ${r.overdue ? "text-danger" : "text-ink-3"}`}>{r.week ?? (r.time || "")}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-ink-2">
                        <ModTag code={r.code} color={color(r.moduleId)} />
                        <span>{whenText(r, today).replace(/, \d\d:\d\d$/, "")}</span>
                        {r.weightPct != null && <span>· {r.weightPct}%</span>}
                        {r.steps.length > 0 && <span>· {r.steps.filter((s) => s.done).length}/{r.steps.length} steps</span>}
                        {r.status === "doing" && <StatusPill status="doing" />}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}

function Row({ r, today, color, on, onOpen, onChange }: { r: TaskRow; today: string; color: (id: number | null) => string; on: boolean; onOpen: (id: string) => void; onChange: Props["onChange"] }) {
  const [edit, setEdit] = useState<"title" | "due" | null>(null);
  const [title, setTitle] = useState(r.title);
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const saveTitle = () => { setEdit(null); const t = title.trim(); if (t.length >= 2 && t !== r.title) onChange(r, { title: t }); else setTitle(r.title); };
  const cell = "border-b border-line/70 py-2 pr-3 align-middle";
  const done = r.status === "done";
  return (
    <tr onClick={() => onOpen(r.id)} className={`group cursor-pointer transition-colors ${on ? "bg-accent-soft" : "hover:bg-sunken/60"}`}>
      <td className={`${cell} pl-1.5`}><Check checked={done} disabled={!r.can.done} label={`Done: ${r.title}`} onChange={() => onChange(r, { status: done ? "open" : "done" })} /></td>
      <td className={cell}>
        {edit === "title" ? (
          <input autoFocus value={title} onClick={stop} onChange={(e) => setTitle(e.target.value)} onBlur={saveTitle} maxLength={120}
            onKeyDown={(e) => { if (e.key === "Enter") saveTitle(); if (e.key === "Escape") { setTitle(r.title); setEdit(null); } }}
            className="w-full rounded-md border border-accent bg-surface px-2 py-1 text-[13.5px] text-ink outline-none" />
        ) : (
          <span className="flex items-center gap-1.5">
            <span className={`min-w-0 truncate font-medium ${done ? "text-ink-3 line-through" : "text-ink"}`}>{r.title}</span>
            {r.missing && <span className="shrink-0 rounded-full bg-danger/15 px-1.5 text-[11px] font-semibold text-danger">Missing</span>}
            {r.can.title && (
              <button type="button" aria-label="Rename" onClick={(e) => { stop(e); setEdit("title"); }}
                className="shrink-0 rounded px-1 text-ink-3 opacity-0 hover:text-accent focus:opacity-100 group-hover:opacity-100">
                <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden><path d="m10.5 2.5 3 3-8 8h-3v-3z" /></svg>
              </button>
            )}
          </span>
        )}
      </td>
      <td className={cell}><ModTag code={r.code} color={color(r.moduleId)} /></td>
      <td className={`${cell} tabular-nums`}>
        {edit === "due" ? (
          <input type="date" autoFocus defaultValue={r.day ?? ""} onClick={stop} onBlur={() => setEdit(null)}
            onChange={(e) => { if (e.target.value) { onChange(r, { dueDate: e.target.value }); setEdit(null); } }}
            className="rounded-md border border-accent bg-surface px-1.5 py-0.5 text-[13px] text-ink outline-none" />
        ) : r.can.date ? (
          <button type="button" onClick={(e) => { stop(e); setEdit("due"); }} title="Change the date"
            className={`rounded px-1 -mx-1 text-left hover:bg-sunken ${r.overdue ? "text-danger" : r.estimated || r.week ? "text-ink-2" : "text-ink"}`}>{whenText(r, today)}</button>
        ) : <span className={r.overdue ? "text-danger" : r.estimated || r.week ? "text-ink-2" : "text-ink"} title={r.origin === "canvas" ? "Canvas sets this date" : undefined}>{whenText(r, today)}</span>}
      </td>
      <td className={cell}>
        {r.can.kind ? (
          <select value={r.kind} onClick={stop} onChange={(e) => onChange(r, { kind: e.target.value })} aria-label="Type"
            className="-ml-1 cursor-pointer rounded bg-transparent px-0.5 py-0.5 text-[13.5px] text-ink hover:bg-sunken">
            {[...new Set([r.kind, ...EDIT_KINDS])].map((k) => <option key={k} value={k}>{KIND[k] ?? k}</option>)}
          </select>
        ) : <span className="text-ink-2">{KIND[r.kind] ?? r.kind}</span>}
      </td>
      <td className={cell}>
        {r.taskId !== null ? (
          <select value={r.status} onClick={stop} aria-label="Status"
            onChange={(e) => onChange(r, e.target.value === "done" ? { status: "done" } : e.target.value === "doing" ? { started: true } : { status: "open", started: false })}
            className="-ml-1 cursor-pointer rounded bg-transparent px-0.5 py-0.5 text-[13px] text-ink-2 hover:bg-sunken">
            <option value="todo">To do</option><option value="doing">Doing</option><option value="done">Done</option>
          </select>
        ) : <StatusPill status={r.status} />}
      </td>
      <td className={`${cell} tabular-nums text-ink-2`}>{r.weightPct != null ? `${r.weightPct}%` : "—"}</td>
      <td className={cell}><Progress steps={r.steps} /></td>
      <td className={`border-b border-line/70 py-2 text-[12px] ${r.origin === "you" ? "text-accent" : "text-ink-3"}`}>{ORIGIN[r.origin]}</td>
    </tr>
  );
}
