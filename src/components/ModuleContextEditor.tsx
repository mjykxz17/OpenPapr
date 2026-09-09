"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

// How long after the last keystroke the notes are written. Long enough not to
// post on every character, short enough that looking away and coming back
// never loses a sentence — a blur saves immediately regardless.
const AUTOSAVE_MS = 1200;

type State = "clean" | "dirty" | "saving" | "saved" | "error";

const LABEL: Record<State, string> = {
  clean: "", dirty: "Saving…", saving: "Saving…", saved: "Saved", error: "Could not save — keep typing to retry",
};

// The student's half of the module context: what the model cannot see in the
// decks — the exam format, what the lecturer stresses in class, what to go
// deep on. It saves itself as you type, because a note you meant to keep and
// a note you forgot to submit should not be different things.
export function ModuleContextEditor({ moduleId, initialNotes, template }: { moduleId: number; initialNotes: string | null; template: string }) {
  const router = useRouter();
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [state, setState] = useState<State>("clean");
  const savedRef = useRef(initialNotes ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = useCallback(async (value: string) => {
    if (timer.current) clearTimeout(timer.current);
    if (value === savedRef.current) return;
    setState("saving");
    try {
      const res = await fetch(`/api/modules/${moduleId}/context`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: value }),
      });
      if (!res.ok) throw new Error(String(res.status));
      savedRef.current = value;
      setState("saved");
      // So "What the model sees" below shows what was just written.
      router.refresh();
    } catch {
      setState("error");
    }
  }, [moduleId, router]);

  // A pending save must not be lost to a navigation or a closed tab.
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    const flush = () => {
      if (notes === savedRef.current) return;
      navigator.sendBeacon?.(
        `/api/modules/${moduleId}/context`,
        new Blob([JSON.stringify({ notes })], { type: "application/json" }),
      );
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [moduleId, notes]);

  function onChange(value: string) {
    setNotes(value);
    setState("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(value), AUTOSAVE_MS);
  }

  return (
    <div className="space-y-2">
      <textarea
        value={notes}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => void save(notes)}
        onFocus={() => { if (notes === "") onChange(template); }}
        placeholder={template}
        rows={notes ? Math.min(28, Math.max(8, notes.split("\n").length + 1)) : 8}
        spellCheck={false}
        className="w-full resize-y border border-line bg-surface px-3 py-2 font-mono text-[13px] leading-[1.6] text-ink outline-none placeholder:text-ink-3 focus:border-accent"
      />
      {/* Height is held whatever the state, so the textarea never shifts as
          the word under it changes. */}
      <p className={`h-4 text-xs ${state === "error" ? "text-danger" : "text-ink-3"}`}>{LABEL[state]}</p>
    </div>
  );
}
