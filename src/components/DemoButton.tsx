"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Opens the shared demo account: a made-up semester to click around in, no
// sign-up needed.
export function DemoButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    setBusy(true);
    setError(null);
    const r = await fetch("/api/demo", { method: "POST" }).catch(() => null);
    if (r?.ok) { router.push("/"); router.refresh(); return; }
    const d = (await r?.json().catch(() => null)) as { error?: string } | null;
    setError(d?.error ?? "Couldn't open the demo. Try again.");
    setBusy(false);
  }
  return (
    <div className="flex flex-col gap-1.5">
      <button type="button" onClick={go} disabled={busy}
        className="h-10 w-full rounded-md border border-line-2 bg-panel text-sm font-medium text-ink transition-colors hover:border-accent hover:text-accent disabled:opacity-60">
        {busy ? "Opening the demo…" : "Try the demo, no sign-up"}
      </button>
      <p className="text-center text-[12px] text-ink-3">A made-up semester to explore. It resets every night.</p>
      {error && <p role="alert" className="text-center text-[13px] text-danger">{error}</p>}
    </div>
  );
}
