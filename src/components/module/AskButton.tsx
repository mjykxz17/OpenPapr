"use client";

import { OPEN_ASK } from "@/components/pet/Papi";

// Opens Papi on this module's material.
export function AskButton() {
  return (
    <button type="button" onClick={() => window.dispatchEvent(new CustomEvent(OPEN_ASK, { detail: {} }))}
      className="inline-flex h-10 items-center gap-2 rounded-md border border-line-2 bg-panel px-3.5 text-sm font-medium text-ink transition-colors hover:border-ink-3"
      title="Ask about this module's slides, guide and announcements">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></svg>
      Ask
    </button>
  );
}
