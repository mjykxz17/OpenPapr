"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function DismissButton({ itemId }: { itemId: number }) {
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
      className="shrink-0 border border-line px-2 py-1 text-xs text-ink-2 hover:text-accent disabled:opacity-50"
    >
      {pending ? "…" : "Dismiss"}
    </button>
  );
}
