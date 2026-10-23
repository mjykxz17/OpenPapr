"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { clearOfflineCaches } from "@/lib/offline";
import { demoBannerHidden, hideDemoBanner } from "./demo-banner-state";

const session = () => { try { return sessionStorage; } catch { return null; } };

// Shown on every page of the shared demo account. On a phone it is one short
// line; anywhere it can be put away for the rest of the visit.
export function DemoBanner() {
  const router = useRouter();
  const [hidden, setHidden] = useState(false);
  useEffect(() => { setHidden(demoBannerHidden(session())); }, []);
  async function leave() {
    try { await fetch("/api/logout", { method: "POST" }); } catch { /* the sign-in page rejects a stale cookie anyway */ }
    await clearOfflineCaches();
    router.push("/login");
    router.refresh();
  }
  if (hidden) return null;
  return (
    <div className="mb-4 flex items-center justify-between gap-x-3 rounded-[10px] border border-accent/30 bg-accent-soft py-1.5 pl-3 pr-1.5 text-[13px] text-ink sm:mb-6 sm:gap-x-4 sm:py-2.5 sm:pl-4">
      <span className="min-w-0">
        <span className="font-semibold">You&apos;re exploring the demo.</span>{" "}
        <span className="hidden text-ink-2 sm:inline">Made-up modules, shared with other visitors, and reset every night at midnight.</span>
      </span>
      <span className="flex shrink-0 items-center gap-1">
        <button type="button" onClick={leave} className="font-medium text-accent hover:underline">
          <span className="sm:hidden">Make your own →</span><span className="hidden sm:inline">Make your own account →</span>
        </button>
        <button type="button" onClick={() => { hideDemoBanner(session()); setHidden(true); }} aria-label="Hide the demo notice" title="Hide for this visit"
          className="flex h-7 w-7 items-center justify-center rounded-md text-ink-3 hover:bg-ink/[0.06] hover:text-ink">
          <svg viewBox="0 0 16 16" width="11" height="11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><path d="M3 3l10 10M13 3L3 13" /></svg>
        </button>
      </span>
    </div>
  );
}
