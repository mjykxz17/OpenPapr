"use client";

import { useState } from "react";
import type { ComponentRow } from "@/server/overview";

// Where a weighting came from, as a real control. Canvas and manual rows are
// plain text; an LLM-extracted row is a button that reveals the syllabus
// sentence it was read from, in place — no tooltip, so it works by keyboard
// and on touch.
export function SourceChip({ source, evidence, name }: { source: ComponentRow["source"]; evidence: string | null; name: string }) {
  const [open, setOpen] = useState(false);
  if (source === "canvas_api") return <span className="text-[13px] text-ink-2">Canvas</span>;
  if (source === "manual") return <span className="text-[13px] text-ink-2">Added by you</span>;
  if (!evidence) return <span className="text-[13px] text-warn-ink">From syllabus</span>;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`rounded-md border px-2 py-0.5 text-xs font-medium transition-colors ${
          open ? "border-warn-ink bg-warn-soft text-warn-ink" : "border-warn-line bg-warn-soft text-warn-ink hover:border-warn-ink"
        }`}
      >
        From syllabus · quote
      </button>
      {open && (
        <blockquote className="mt-2 flex flex-col gap-1 rounded-md border border-warn-line bg-warn-soft px-3.5 py-3 text-left text-[13px] leading-[1.55] text-ink-2">
          <span className="font-semibold text-ink">{name} — from the syllabus page</span>
          <span>&ldquo;{evidence}&rdquo;</span>
        </blockquote>
      )}
    </>
  );
}
