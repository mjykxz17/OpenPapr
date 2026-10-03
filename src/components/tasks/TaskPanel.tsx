"use client";

import { useEffect, useState } from "react";
import type { TaskRow } from "@/server/task-rows";
import { Check, createTask, deleteTask, EDIT_KINDS, fmtMin, hideItem, KIND, ORIGIN_LINE, StatusPill, whenText, type Change, type Mod, dayText } from "./task-ui";

// Everything about one row: its date and time, type, module, where it came
// from, its steps and the student's notes. A side panel on a computer, a
// sheet from the bottom on a phone.

type Props = {
  row: TaskRow; today: string; modules: Mod[]; color: (id: number | null) => string;
  onClose: () => void; onChange: (r: TaskRow, c: Change) => Promise<boolean>; onGone: (id: string) => void; onRefresh: () => void;
};

export function TaskPanel({ row: r, today, modules, color, onClose, onChange, onGone, onRefresh }: Props) {
  const [title, setTitle] = useState(r.title);
  const [notes, setNotes] = useState(r.notes ?? "");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !(e.target as HTMLElement).closest?.("input,textarea,select")) onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const saveTitle = () => { const t = title.trim(); if (t.length >= 2 && t !== r.title) onChange(r, { title: t }); else setTitle(r.title); };
  const saveNotes = () => { if ((notes.trim() || null) !== (r.notes ?? null)) onChange(r, { notes: notes.trim() || null }); };
  const field = "h-9 rounded-md border border-line-2 bg-surface px-2 text-[13.5px] text-ink outline-none focus:border-accent";
  const label = "w-[84px] shrink-0 text-[13px] text-ink-3";
  const rowCls = "flex min-h-[42px] items-center gap-3 border-b border-line py-1.5";
  const c = color(r.moduleId);

  const act = async (fn: () => Promise<boolean>, gone = true) => { setBusy(true); const ok = await fn(); setBusy(false); if (ok) { if (gone) onGone(r.id); else onRefresh(); } };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={onClose} aria-hidden />
      <aside role="dialog" aria-label={r.title}
        className="fixed inset-x-0 bottom-0 z-50 flex max-h-[86svh] flex-col overflow-y-auto rounded-t-2xl border-t border-line bg-panel px-5 pb-8 pt-2 shadow-2xl lg:inset-x-auto lg:bottom-0 lg:right-0 lg:top-0 lg:max-h-none lg:w-[380px] lg:rounded-none lg:border-l lg:border-t-0 lg:pt-5">
        <div className="mx-auto mb-2 h-1.5 w-10 shrink-0 rounded-full bg-line-2 lg:hidden" aria-hidden />
        <div className="flex items-start justify-between gap-3">
          <p className="text-[12px] text-ink-3">
            {r.code && <b className="font-mono font-semibold" style={{ color: c }}>{r.code}</b>}{r.code && " · "}{ORIGIN_LINE[r.origin]}
          </p>
          <button type="button" onClick={onClose} aria-label="Close" className="-mr-1 -mt-1 h-8 w-8 shrink-0 rounded-md text-ink-3 hover:bg-sunken hover:text-ink">✕</button>
        </div>
        {r.can.title ? (
          <input value={title} onChange={(e) => setTitle(e.target.value)} onBlur={saveTitle} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} maxLength={120} aria-label="Title"
            className="-mx-1.5 mt-1 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-[19px] font-semibold text-ink outline-none hover:border-line focus:border-accent" />
        ) : <h2 className="mt-1 text-[19px] font-semibold leading-snug text-ink">{r.title}</h2>}

        <div className="mt-3 flex flex-col">
          <div className={rowCls}>
            <span className={label}>{r.event ? "When" : "Due"}</span>
            {r.can.date ? (
              <span className="flex flex-wrap items-center gap-2">
                <input type="date" value={r.day ?? ""} aria-label="Date" className={field}
                  onChange={(e) => e.target.value ? onChange(r, { dueDate: e.target.value }) : r.origin === "you" && onChange(r, { noDate: true })} />
                {r.day && <input type="time" value={r.time ?? ""} aria-label="Time" className={`${field} w-[104px]`}
                  onChange={(e) => onChange(r, { time: e.target.value || null })} />}
              </span>
            ) : <span className={`text-[13.5px] ${r.overdue ? "text-danger" : "text-ink"}`}>{whenText(r, today)}{r.origin === "canvas" && !r.event && <span className="text-ink-3"> · set by Canvas</span>}</span>}
          </div>
          {r.estimated && r.can.date && <p className="border-b border-line py-1.5 text-[12px] text-ink-3">The date is a best guess{r.origin === "ai" ? ". Set the real one and the planner keeps it." : "."}</p>}
          {!r.event && (
            <div className={rowCls}>
              <span className={label}>Status</span>
              {r.taskId !== null ? (
                <span className="inline-flex rounded-lg bg-sunken p-[3px] text-[12.5px]">
                  {(["todo", "doing", "done"] as const).map((s) => (
                    <button key={s} type="button" onClick={() => onChange(r, s === "done" ? { status: "done" } : s === "doing" ? { started: true } : { status: "open", started: false })}
                      className={`rounded-md px-2.5 py-1 ${r.status === s ? "bg-panel font-semibold text-ink shadow-sm" : "text-ink-2 hover:text-ink"}`}>{s === "todo" ? "To do" : s === "doing" ? "Doing" : "Done"}</button>
                  ))}
                </span>
              ) : <StatusPill status={r.status} />}
            </div>
          )}
          <div className={rowCls}>
            <span className={label}>Type</span>
            {r.can.kind ? (
              <select value={r.kind} onChange={(e) => onChange(r, { kind: e.target.value })} className={field} aria-label="Type">
                {[...new Set([r.kind, ...EDIT_KINDS])].map((k) => <option key={k} value={k}>{KIND[k] ?? k}</option>)}
              </select>
            ) : <span className="text-[13.5px] text-ink">{KIND[r.kind] ?? r.kind}</span>}
          </div>
          {r.can.module && (
            <div className={rowCls}>
              <span className={label}>Module</span>
              <select value={r.moduleId ?? ""} onChange={(e) => onChange(r, { moduleId: e.target.value ? Number(e.target.value) : null })} className={field} aria-label="Module">
                <option value="">None</option>
                {modules.map((m) => <option key={m.id} value={m.id}>{m.code}</option>)}
              </select>
            </div>
          )}
          {(r.weightPct != null || r.counts) && (
            <div className={rowCls}><span className={label}>Weight</span>
              <span className="text-[13.5px] text-ink">{r.weightPct != null ? `${r.weightPct}%` : ""}{r.counts && <span className="text-ink-3">{r.weightPct != null ? " · " : ""}{r.counts}</span>}</span></div>
          )}
          {r.why && <div className={rowCls}><span className={label}>{r.event ? "Note" : r.origin === "schedule" ? "Covers" : "Why"}</span><span className="py-1 text-[13px] leading-snug text-ink-2">{r.why.replace(/^Covers /, "")}</span></div>}
          {(r.link || r.sources.length > 0) && (
            <div className={`${rowCls} items-start`}>
              <span className={`${label} pt-1`}>Source</span>
              <span className="flex min-w-0 flex-col gap-1 py-1 text-[13px]">
                {r.link && <a href={r.link.href} {...(r.link.external ? { target: "_blank", rel: "noreferrer" } : {})} className="truncate text-accent hover:underline">{r.link.label} ↗</a>}
                {r.sources.filter((s) => s.href && s.href !== r.link?.href).slice(0, 4).map((s, i) => (
                  <a key={i} href={s.href!} title={s.quote ?? undefined} {...(s.external ? { target: "_blank", rel: "noreferrer" } : {})} className="truncate text-ink-2 hover:text-accent">{s.label}</a>
                ))}
              </span>
            </div>
          )}
        </div>

        {r.steps.length > 0 && (
          <section className="mt-4">
            <h3 className="mb-1.5 text-[13px] font-semibold text-ink">Steps</h3>
            <ul className="flex flex-col gap-2">
              {r.steps.map((s) => (
                <li key={s.id} className="flex items-start gap-2.5 text-[13.5px]">
                  <span className="pt-0.5"><Check checked={s.done} label={s.text} onChange={() => onChange(r, { stepId: s.id, done: !s.done })} /></span>
                  <span className={`min-w-0 flex-1 ${s.done ? "text-ink-3 line-through" : "text-ink"}`}>{s.text} <span className="text-ink-3">· {fmtMin(s.minutes)}</span></span>
                  <span className="shrink-0 text-[12px] text-ink-3">{s.doBy === today ? "Today" : dayText(s.doBy).split(" ")[0]}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {r.taskId !== null && (
          <section className="mt-4">
            <h3 className="mb-1.5 text-[13px] font-semibold text-ink">Notes</h3>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={saveNotes} rows={3} maxLength={4000} placeholder="Add a note…"
              className="w-full resize-y rounded-lg border border-line-2 bg-surface px-3 py-2 text-[13.5px] text-ink outline-none placeholder:text-ink-3 focus:border-accent" />
          </section>
        )}

        <div className="mt-5 flex flex-wrap gap-2 text-[13px]">
          {r.can.makeTask && (
            <button type="button" disabled={busy} onClick={() => act(async () => (await createTask({ title: r.title, due: r.day, time: r.time, moduleId: r.moduleId, kind: r.kind, notes: r.why })) !== null)}
              className="h-9 rounded-md bg-accent px-3.5 font-semibold text-on-accent hover:bg-accent-strong disabled:opacity-50">Track as a task</button>
          )}
          {r.can.remove === "delete" && r.taskId !== null && (
            <button type="button" disabled={busy} onClick={() => act(() => deleteTask(r.taskId!))} className="h-9 rounded-md border border-line-2 px-3 text-ink-2 hover:border-danger hover:text-danger disabled:opacity-50">Delete</button>
          )}
          {r.can.remove === "dismiss" && r.status !== "done" && (
            <>
              <button type="button" disabled={busy} onClick={() => act(() => onChange(r, { status: "dismissed" }))} title="It's real, but you don't need to do it"
                className="h-9 rounded-md border border-line-2 px-3 text-ink-2 hover:text-ink disabled:opacity-50">Not needed</button>
              {r.origin === "ai" && (
                <button type="button" disabled={busy} onClick={() => act(() => onChange(r, { notTask: true }))} title="Removes it, and the planner won't suggest it again"
                  className="h-9 rounded-md px-2 text-ink-3 hover:text-danger disabled:opacity-50">Not a real task</button>
              )}
            </>
          )}
          {r.can.remove === "hide" && r.itemId !== null && (
            <button type="button" disabled={busy} onClick={() => act(() => hideItem(r.itemId!))} className="h-9 rounded-md border border-line-2 px-3 text-ink-2 hover:text-ink disabled:opacity-50">Hide</button>
          )}
        </div>
      </aside>
    </>
  );
}
