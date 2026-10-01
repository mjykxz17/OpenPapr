"use client";

import { useRouter } from "next/navigation";
import { clearOfflineCaches } from "@/lib/offline";

// Shown on every page of the shared demo account.
export function DemoBanner() {
  const router = useRouter();
  async function leave() {
    try { await fetch("/api/logout", { method: "POST" }); } catch { /* the sign-in page rejects a stale cookie anyway */ }
    await clearOfflineCaches();
    router.push("/login");
    router.refresh();
  }
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-[10px] border border-accent/30 bg-accent-soft px-4 py-2.5 text-[13px] text-ink">
      <span><span className="font-semibold">You&apos;re exploring the demo.</span> <span className="text-ink-2">Made-up modules, shared with other visitors, and reset every night at midnight.</span></span>
      <button type="button" onClick={leave} className="font-medium text-accent hover:underline">Make your own account →</button>
    </div>
  );
}
