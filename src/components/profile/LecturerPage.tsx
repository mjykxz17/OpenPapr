"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

// Lets the student point OpenPapr at a lecturer's public NUS staff page, the
// only outside source a lecturer profile draws on.
// With no name, it adds a lecturer Canvas does not list.
export function LecturerPage({ moduleId, name, staffUrl }: { moduleId: number; name: string | null; staffUrl: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState(staffUrl ?? "");
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true); setError(null);
    const res = await fetch(`/api/modules/${moduleId}/lecturers`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name ?? newName, staffUrl: url }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) { const b = await res?.json().catch(() => null); setError(b?.error ?? "could not save"); return; }
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-[12px] text-accent hover:underline">
        {name === null ? "+ Add a lecturer" : staffUrl ? "Change staff page" : "Add staff page"}
      </button>
    );
  }
  return (
    <form onSubmit={save} className="mt-1.5 flex flex-col gap-1.5">
      {name === null && (
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Lecturer's name" required autoFocus aria-label="Lecturer's name"
          className="h-8 w-full rounded-md border border-line-2 bg-surface px-2 text-[13px] text-ink outline-none focus:border-accent" />
      )}
      <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.comp.nus.edu.sg/… (optional)" autoFocus={name !== null}
        aria-label={`Staff page for ${name ?? "the lecturer"}`} spellCheck={false}
        className="h-8 w-full rounded-md border border-line-2 bg-surface px-2 font-mono text-[12px] text-ink outline-none focus:border-accent" />
      {error && <span className="text-[12px] text-danger">{error}</span>}
      <span className="flex gap-2">
        <button type="submit" disabled={saving} className="h-7 rounded-md bg-accent px-2.5 text-[12px] font-medium text-on-accent hover:bg-accent-strong disabled:opacity-50">{saving ? "Saving…" : "Save"}</button>
        <button type="button" onClick={() => { setOpen(false); setError(null); }} className="h-7 rounded-md px-2 text-[12px] text-ink-2 hover:bg-ink/[0.05]">Cancel</button>
      </span>
    </form>
  );
}
