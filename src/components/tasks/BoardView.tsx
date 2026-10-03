"use client";

import { useState } from "react";
import type { RowStatus, TaskRow } from "@/server/task-rows";
import { ModTag, Progress, STATUS, whenText, type Change } from "./task-ui";

// To do, Doing, Done. Drag a card across to start it or finish it; ticking a
// step moves it to Doing by itself.

type Props = {
  rows: TaskRow[]; today: string; color: (id: number | null) => string; selected: string | null;
  onOpen: (id: string) => void; onChange: (r: TaskRow, c: Change) => Promise<boolean>;
};
const COLS: RowStatus[] = ["todo", "doing", "done"];
const MOVE: Record<RowStatus, Change> = { todo: { status: "open", started: false }, doing: { started: true }, done: { status: "done" } };

export function BoardView({ rows, today, color, selected, onOpen, onChange }: Props) {
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<RowStatus | null>(null);
  const dragged = drag ? rows.find((r) => r.id === drag) : null;
  return (
    <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0">
      {COLS.map((col) => {
        const list = rows.filter((r) => r.status === col);
        return (
          <section key={col} aria-label={STATUS[col]}
            onDragOver={(e) => { if (dragged && dragged.taskId !== null && dragged.status !== col) { e.preventDefault(); setOver(col); } }}
            onDragLeave={() => setOver((o) => (o === col ? null : o))}
            onDrop={(e) => { e.preventDefault(); setOver(null); setDrag(null); const r = rows.find((x) => x.id === e.dataTransfer.getData("text/plain")); if (r && r.taskId !== null && r.status !== col) onChange(r, MOVE[col]); }}
            className={`flex w-[82vw] shrink-0 snap-start flex-col gap-2 rounded-xl border p-2.5 transition-colors sm:w-auto ${over === col ? "border-accent bg-accent-soft" : "border-line bg-sunken/50"}`}>
            <h3 className="flex items-center gap-2 px-1 text-[12.5px] font-semibold text-ink-2">
              <span className={`h-2 w-2 rounded-full ${col === "done" ? "bg-ok" : col === "doing" ? "bg-warn" : "bg-ink-3"}`} aria-hidden />
              {STATUS[col]} <span className="font-normal text-ink-3">{list.length}</span>
            </h3>
            {list.map((r) => (
              <div key={r.id} role="button" tabIndex={0} draggable={r.taskId !== null}
                onDragStart={(e) => { e.dataTransfer.setData("text/plain", r.id); setDrag(r.id); }} onDragEnd={() => { setDrag(null); setOver(null); }}
                onClick={() => onOpen(r.id)} onKeyDown={(e) => e.key === "Enter" && onOpen(r.id)}
                className={`flex flex-col gap-1.5 rounded-lg border bg-panel px-3 py-2.5 text-[13px] ${r.taskId !== null ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"} ${r.origin === "schedule" ? "border-dashed border-line-2" : "border-line"} ${selected === r.id ? "ring-1 ring-accent" : ""} ${drag === r.id ? "opacity-40" : ""}`}>
                <b className={`font-semibold leading-snug ${col === "done" ? "text-ink-3 line-through" : "text-ink"}`}>{r.title}</b>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-2">
                  <ModTag code={r.code} color={color(r.moduleId)} />
                  <span className={r.overdue ? "text-danger" : ""}>{whenText(r, today)}</span>
                  {r.weightPct != null && <span className="text-ink-3">· {r.weightPct}%</span>}
                </div>
                {r.steps.length > 0 && <div className="text-[12px]"><Progress steps={r.steps} /></div>}
              </div>
            ))}
            {!list.length && <p className="px-1 py-3 text-[12.5px] text-ink-3">{col === "doing" ? "Drag something here when you start it." : col === "done" ? "Finished work from the last week." : "Nothing to do."}</p>}
          </section>
        );
      })}
    </div>
  );
}
