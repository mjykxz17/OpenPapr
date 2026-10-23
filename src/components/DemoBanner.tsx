"use client";

import { useRouter } from "next/navigation";
import { clearOfflineCaches } from "@/lib/offline";
import { DEMO_BANNER_ATTR, hideDemoBanner } from "./demo-banner-state";

const session = () => { try { return sessionStorage; } catch { return null; } };

// Shown on every page of the shared demo account. On a phone it is one short
// line; anywhere it can be put away for the rest of the visit. Putting it
// away marks <html> (see demoBannerBootScript), and CSS hides the banner from
// then on, so it doesn't flash back on the next page.
export function DemoBanner() {
  const router = useRouter();
  async function leave() {
    try { await fetch("/api/logout", { method: "POST" }); } catch { /* the sign-in page rejects a stale cookie anyway */ }
    await clearOfflineCaches();
    router.push("/login");
    router.refresh();
  }
  function hide() {
    hideDemoBanner(session());
    document.documentElement.dataset[DEMO_BANNER_ATTR] = "hidden";
  }
  return (
    <div className="mb-4 flex items-center justify-between gap-x-3 rounded-[10px] border border-accent/30 bg-accent-soft py-1.5 pl-3 pr-1.5 text-[13px] text-ink sm:mb-6 sm:gap-x-4 sm:py-2.5 sm:pl-4 [html[data-demo-banner=hidden]_&]:hidden">
      <span className="min-w-0">
        <span className="font-semibold">You&apos;re exploring the demo.</span>{" "}
        <span className="hidden text-ink-2 sm:inline">Made-up modules, shared with other visitors, and reset every night at midnight.</span>
      </span>
      <span className="flex shrink-0 items-center gap-1">
        <button type="button" onClick={leave} className="font-medium text-accent hover:underline">
          <span className="sm:hidden">Make your own →</span><span className="hidden sm:inline">Make your own account →</span>
        </button>
        <button type="button" onClick={hide} aria-label="Hide the demo notice" title="Hide for this visit"
          className="flex h-7 w-7 items-center justify-center rounded-md text-ink-3 hover:bg-ink/[0.06] hover:text-ink">
          <svg viewBox="0 0 16 16" width="11" height="11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><path d="M3 3l10 10M13 3L3 13" /></svg>
        </button>
      </span>
    </div>
  );
}
