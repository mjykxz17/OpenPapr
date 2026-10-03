"use client";

import { useEffect } from "react";

// Marks the module read once its page has been on screen for a moment, so
// a quick bounce off a misclick doesn't clear the home card's "new" count.
export function MarkModuleSeen({ moduleId }: { moduleId: number }) {
  useEffect(() => {
    const t = setTimeout(() => { void fetch(`/api/modules/${moduleId}/seen`, { method: "POST" }).catch(() => {}); }, 1500);
    return () => clearTimeout(t);
  }, [moduleId]);
  return null;
}
