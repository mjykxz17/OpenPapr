"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Add something the planner could not know about: a title, and if you like a
// day and a module. It becomes a one-step task the planner leaves alone.
export function AddTask({ modules }: { modules: { id: number; code: string }[] }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [moduleId, setModuleId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await fetch("/api/tasks", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, due: due || null, moduleId: moduleId ? Number(moduleId) : null }),
    }).catch(() => null);
    setBusy(false);
    if (!r?.ok) { setError("Could not add it. Try again."); return; }
    setTitle(""); setDue(""); setModuleId(""); setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="h-9 rounded-md border border-line-2 bg-panel px-3 text-[13px] font-medium text-ink transition-colors hover:border-ink-3">
        + Add task
      </button>
    );
  }
  const field = "h-10 rounded-md border border-line-2 bg-surface px-3 text-[14px] text-ink outline-none focus:border-accent";
  return (
    <form onSubmit={submit} className="flex w-full flex-col gap-3 rounded-[10px] border border-line bg-panel p-4">
      <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What do you need to do?" aria-label="Task" maxLength={120} required className={field} />
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-[13px] text-ink-2">Due
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className={field} />
        </label>
        <label className="flex items-center gap-2 text-[13px] text-ink-2">Module
          <select value={moduleId} onChange={(e) => setModuleId(e.target.value)} className={field}>
            <option value="">None</option>
            {modules.map((m) => <option key={m.id} value={m.id}>{m.code}</option>)}
          </select>
        </label>
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={() => setOpen(false)} className="h-10 rounded-md px-3 text-[13px] text-ink-2 hover:text-ink">Cancel</button>
          <button type="submit" disabled={busy || title.trim().length < 2} className="h-10 rounded-md bg-accent px-4 text-sm font-medium text-on-accent hover:bg-accent-strong disabled:opacity-50">Add</button>
        </div>
      </div>
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      <p className="text-[12px] text-ink-3">Tip: you can also tell Papi “remind me to … by Friday”.</p>
    </form>
  );
}
