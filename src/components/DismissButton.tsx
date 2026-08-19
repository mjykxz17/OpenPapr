"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function DismissButton({ itemId, compact = false }: { itemId: number; compact?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onClick() {
    setPending(true);
    await fetch(`/api/items/${itemId}/dismiss`, { method: "POST" });
    setPending(false);
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-label="Dismiss"
      className={compact
        ? "shrink-0 px-1 text-sm leading-none text-ink-3 opacity-0 transition-opacity hover:text-accent group-hover:opacity-100 disabled:opacity-50"
        : "shrink-0 border border-line px-2 py-1 text-xs text-ink-2 hover:text-accent disabled:opacity-50"}
    >
      {pending ? "…" : compact ? "×" : "Dismiss"}
    </button>
  );
}
