"use client";

import { useEffect, useRef, useState } from "react";
import { createTask, dayText, type Mod } from "./task-ui";

// Add something: a title, and if you like a day, a time, a module and what
// kind of thing it is. Opens next to where you clicked; on a phone it comes
// up from the bottom.

export type AddAt = { day: string | null; rect: DOMRect };
const KINDS: [string, string][] = [["admin", "To do"], ["submission", "Submission"], ["personal", "Personal"], ["meeting", "Meeting"], ["prep", "Study"], ["exam", "Exam"], ["quiz", "Quiz"]];

export function QuickAdd({ at, today, modules, onClose, onAdded }: { at: AddAt; today: string; modules: Mod[]; onClose: () => void; onAdded: () => void }) {
  const [title, setTitle] = useState("");
  const [day, setDay] = useState(at.day ?? "");
  const [time, setTime] = useState("");
  const [moduleId, setModuleId] = useState("");
  const [kind, setKind] = useState("admin");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const box = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent) { if (e.key === "Escape") onClose(); return; }
      if (box.current && !box.current.contains(e.target as Node)) onClose();
    };
    // After the click that opened it.
    const t = setTimeout(() => window.addEventListener("pointerdown", close), 0);
    window.addEventListener("keydown", close);
    return () => { clearTimeout(t); window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", close); };
  }, [onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (title.trim().length < 2) return;
    setBusy(true);
    const id = await createTask({ title: title.trim(), due: day || null, time: day && time ? time : null, moduleId: moduleId ? Number(moduleId) : null, kind });
    setBusy(false);
    if (id === null) { setError(true); return; }
    onAdded();
  }

  // Beside the spot on a computer, kept on screen.
  const W = 340;
  const vw = typeof window === "undefined" ? 1200 : window.innerWidth;
  const vh = typeof window === "undefined" ? 800 : window.innerHeight;
  const left = Math.max(12, Math.min(at.rect.left, vw - W - 12));
  const below = at.rect.bottom + 6;
  const top = below + 300 > vh ? Math.max(12, at.rect.top - 306) : below;
  const field = "h-9 rounded-md border border-line-2 bg-surface px-2 text-[13px] text-ink outline-none focus:border-accent";

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 sm:hidden" aria-hidden />
      <form ref={box} onSubmit={submit} aria-label="New task"
        className="fixed inset-x-0 bottom-0 z-50 flex flex-col gap-2.5 rounded-t-2xl border border-line bg-panel p-4 pb-8 shadow-2xl sm:inset-x-auto sm:bottom-auto sm:w-[340px] sm:rounded-xl sm:pb-4"
        style={vw >= 640 ? { left, top } : undefined}>
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">New{day ? ` on ${day === today ? "today" : dayText(day)}` : ""}</p>
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What is it?" maxLength={120} aria-label="Title"
          className="h-10 rounded-md border border-line-2 bg-surface px-3 text-[14px] text-ink outline-none focus:border-accent" />
        <div className="flex flex-wrap gap-2">
          <input type="date" value={day} onChange={(e) => setDay(e.target.value)} aria-label="Date" className={`${field} flex-1`} />
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={!day} aria-label="Time (optional)" className={`${field} w-[100px] disabled:opacity-40`} />
        </div>
        <div className="flex gap-2">
          <select value={moduleId} onChange={(e) => setModuleId(e.target.value)} aria-label="Module" className={`${field} flex-1`}>
            <option value="">No module</option>
            {modules.map((m) => <option key={m.id} value={m.id}>{m.code}</option>)}
          </select>
          <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Type" className={`${field} flex-1`}>
            {KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        {error && <p role="alert" className="text-[12.5px] text-danger">Could not add it. Try again.</p>}
        <div className="flex items-center justify-between pt-0.5">
          <span className="hidden text-[12px] text-ink-3 sm:inline">Enter to add · Esc to cancel</span>
          <span className="flex gap-2 sm:ml-auto">
            <button type="button" onClick={onClose} className="h-9 rounded-md px-3 text-[13px] text-ink-2 hover:text-ink sm:hidden">Cancel</button>
            <button type="submit" disabled={busy || title.trim().length < 2} className="h-9 rounded-md bg-accent px-4 text-[13px] font-semibold text-on-accent hover:bg-accent-strong disabled:opacity-50">Add</button>
          </span>
        </div>
      </form>
    </>
  );
}
