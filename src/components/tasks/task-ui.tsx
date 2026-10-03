"use client";

import type { Origin, RowStatus, TaskRow } from "@/server/task-rows";

// Pieces every Tasks view shares: labels, date words, and the one function
// that sends a change for a row.

export type Mod = { id: number; code: string };
export type Change = {
  title?: string; kind?: string; moduleId?: number | null; notes?: string | null;
  dueDate?: string; time?: string | null; noDate?: boolean;
  status?: "open" | "done" | "dismissed"; started?: boolean; stepId?: string; done?: boolean; notTask?: boolean;
};

export const KIND: Record<string, string> = {
  exam: "Exam", quiz: "Quiz", submission: "Submission", project: "Project", presentation: "Presentation", prep: "Prep",
  reading: "Reading", admin: "Admin", meeting: "Meeting", personal: "Personal", class: "Class",
};
export const EDIT_KINDS = ["submission", "quiz", "exam", "project", "presentation", "prep", "reading", "admin", "meeting", "personal"];
export const STATUS: Record<RowStatus, string> = { todo: "To do", doing: "Doing", done: "Done" };
export const ORIGIN: Record<Origin, string> = { canvas: "Canvas", ai: "AI plan", schedule: "Schedule", you: "You" };
export const ORIGIN_LINE: Record<Origin, string> = {
  canvas: "from Canvas", ai: "planned by OpenPapr", schedule: "from the course schedule", you: "added by you",
};

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const toDate = (day: string) => new Date(`${day}T12:00:00Z`);
export const addDays = (day: string, n: number) => new Date(toDate(day).getTime() + n * 86_400_000).toISOString().slice(0, 10);
export const diffDays = (a: string, b: string) => Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86_400_000);
export const mondayOf = (day: string) => addDays(day, -((toDate(day).getUTCDay() + 6) % 7));
export const fmtMin = (m: number) => (m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}`);

// "Tue 6 Oct"
export function dayText(day: string): string {
  const d = toDate(day);
  return `${WD[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
}
// "5–11 Oct" / "28 Sep – 4 Oct"
export function rangeText(from: string, to: string): string {
  const a = toDate(from), b = toDate(to);
  return a.getUTCMonth() === b.getUTCMonth() ? `${a.getUTCDate()}–${b.getUTCDate()} ${MON[b.getUTCMonth()]}` : `${a.getUTCDate()} ${MON[a.getUTCMonth()]} – ${b.getUTCDate()} ${MON[b.getUTCMonth()]}`;
}
// What the Due cell says.
export function whenText(r: TaskRow, today: string): string {
  if (r.week) return `during ${r.week}`;
  if (!r.day) return r.origin === "you" ? "No date" : "Date not announced";
  const n = diffDays(today, r.day);
  const d = n === 0 ? "Today" : n === 1 ? "Tomorrow" : dayText(r.day);
  return `${r.estimated ? "around " : ""}${d}${r.time ? `, ${r.time}` : ""}`;
}

export async function sendChange(r: TaskRow, change: Change): Promise<boolean> {
  if (r.taskId === null) return false;
  try {
    const res = await fetch(`/api/tasks/${r.taskId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(change) });
    return res.ok;
  } catch { return false; }
}
export async function createTask(input: { title: string; due: string | null; time: string | null; moduleId: number | null; kind: string; notes?: string | null }): Promise<number | null> {
  try {
    const res = await fetch("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
    if (!res.ok) return null;
    return ((await res.json()) as { id: number }).id;
  } catch { return null; }
}
export async function deleteTask(taskId: number): Promise<boolean> {
  try { return (await fetch(`/api/tasks/${taskId}`, { method: "DELETE" })).ok; } catch { return false; }
}
export async function hideItem(itemId: number): Promise<boolean> {
  try { return (await fetch(`/api/items/${itemId}/dismiss`, { method: "POST" })).ok; } catch { return false; }
}

// A row as it will look once a change lands, so the views move at once.
export function applyChange(r: TaskRow, c: Change): TaskRow {
  const n = { ...r };
  if (c.title !== undefined) n.title = c.title;
  if (c.kind !== undefined) n.kind = c.kind;
  if (c.notes !== undefined) n.notes = c.notes;
  if (c.noDate) { n.day = null; n.time = null; }
  if (c.dueDate !== undefined) { n.day = c.dueDate; n.estimated = false; n.week = null; n.overdue = false; }
  if (c.time !== undefined) n.time = c.time;
  if (c.started !== undefined) n.status = c.started ? "doing" : "todo";
  if (c.status === "done") n.status = "done";
  if (c.status === "open" && n.status === "done") n.status = "todo";
  if (c.stepId !== undefined) n.steps = r.steps.map((s) => (s.id === c.stepId ? { ...s, done: Boolean(c.done) } : s));
  return n;
}

export function ModTag({ code, color }: { code: string | null; color: string }) {
  if (!code) return <span className="text-ink-3">—</span>;
  return (
    <span className="inline-flex rounded-[5px] px-1.5 py-px font-mono text-[11.5px] font-semibold"
      style={{ color, background: `color-mix(in oklab, ${color} 16%, transparent)` }}>{code}</span>
  );
}

export function StatusPill({ status }: { status: RowStatus }) {
  const cls = status === "done" ? "border-ok/50 text-ok" : status === "doing" ? "border-warn/60 text-warn" : "border-line-2 text-ink-2";
  return <span className={`inline-flex rounded-full border px-2 text-[11.5px] leading-[18px] ${cls}`}>{STATUS[status]}</span>;
}

export function Check({ checked, onChange, label, disabled }: { checked: boolean; onChange: () => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} aria-label={label} onClick={(e) => { e.stopPropagation(); onChange(); }} disabled={disabled}
      className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors disabled:opacity-40 ${checked ? "border-accent bg-accent text-on-accent" : "border-ink-3/60 hover:border-accent"}`}>
      {checked && <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden><path d="m3.5 8.5 3 3 6-7" /></svg>}
    </button>
  );
}

export function Progress({ steps }: { steps: TaskRow["steps"] }) {
  if (!steps.length) return <span className="text-ink-3">—</span>;
  const done = steps.filter((s) => s.done).length;
  return (
    <span className="inline-flex items-center gap-2 tabular-nums text-ink-2">
      <span className="h-1 w-12 overflow-hidden rounded-full bg-line" aria-hidden><span className="block h-full rounded-full bg-accent" style={{ width: `${(done / steps.length) * 100}%` }} /></span>
      {done}/{steps.length}
    </span>
  );
}
