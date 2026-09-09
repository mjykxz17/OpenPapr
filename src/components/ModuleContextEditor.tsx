"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// The student's half of the module context document: what the model cannot
// see in the decks — the exam format, what the lecturer stresses in class,
// what to go deep on. Saved as markdown and put in front of the model on
// every guide run. Starts from a scaffold of headings so the useful
// questions are already asked; untouched sections cost nothing.
export function ModuleContextEditor({ moduleId, initialNotes, template }: { moduleId: number; initialNotes: string | null; template: string }) {
  const router = useRouter();
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [saved, setSaved] = useState(initialNotes ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const dirty = notes !== saved;

  async function save() {
    setPending(true);
    setError(false);
    let ok = false;
    try {
      ok = (await fetch(`/api/modules/${moduleId}/context`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      })).ok;
    } catch {
      ok = false;
    }
    setPending(false);
    if (!ok) {
      setError(true);
      return;
    }
    setSaved(notes);
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onFocus={() => { if (notes === "") setNotes(template); }}
        placeholder={template}
        rows={notes ? Math.min(28, Math.max(8, notes.split("\n").length + 1)) : 8}
        spellCheck={false}
        className="w-full resize-y border border-line bg-surface px-3 py-2 font-mono text-[13px] leading-[1.6] text-ink outline-none placeholder:text-ink-3 focus:border-accent"
      />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={pending || !dirty}
          className="border border-line bg-ink px-3 py-1.5 text-xs font-medium text-surface disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save notes"}
        </button>
        {dirty && !pending && <span className="text-xs text-ink-3">Unsaved changes</span>}
        {error && <span className="text-xs text-danger">Could not save.</span>}
      </div>
    </div>
  );
}
