import type { ReactNode } from "react";
import { Rail } from "./Rail";
import { currentUserId } from "@/server/session";
import { getDb } from "@/server/db";
import { getUser } from "@/db/repo";
import { loadEnv } from "@/lib/env";
import { Papi } from "./pet/Papi";
import { SearchPalette } from "./SearchPalette";
import { DemoBanner } from "./DemoBanner";
import { ChangesStrip } from "./ChangesBell";
import { openChangeCount } from "@/server/changes";
import { mailEnabled } from "./mail-access";

// `wide` opts a page out of the 1280px cap. Dashboard-style pages read better
// capped — a grid of tiles stretched across a 27" display looks sparse — but a
// long document wants the screen it is given.
// `bleed` gives a tool page (the file viewer) the whole area beside the rail,
// with no padding or cap: it manages its own edges and scrolling.
// Mail is offered only when this instance has Outlook set up; without it
// nothing can connect or sync (and the page is a 404).
export async function AppShell({ children, wide = false, bleed = false }: { children: ReactNode; wide?: boolean; bleed?: boolean }) {
  const showMail = mailEnabled(loadEnv());
  const uid = await currentUserId().catch(() => null);
  const demo = uid !== null && Boolean(getUser(getDb(), uid)?.isDemo);
  const changes = uid !== null ? openChangeCount(getDb(), uid) : 0;
  return (
    <div className="min-h-svh bg-surface text-ink">
      {/* First thing a keyboard reaches, so it needn't tab through the rail. */}
      <a href="#main" className="sr-only rounded-md bg-panel px-3 py-2 text-[14px] font-medium text-ink shadow-md ring-2 ring-accent focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50">
        Skip to content
      </a>
      <Rail showMail={showMail && !demo} changes={uid !== null ? changes : null} />
      {/* Room for the tab bar on a phone; for the rail beside. */}
      <main id="main" tabIndex={-1} className={`outline-none sm:pl-14 ${bleed ? "pb-[60px] sm:pb-0" : "pb-24 sm:pb-12"}`}>
        {bleed ? children : <div className={`mx-auto px-4 py-6 sm:px-10 sm:py-9 ${wide ? "max-w-[1800px]" : "max-w-[1280px]"}`}>{demo && <DemoBanner />}{uid !== null && <ChangesStrip count={changes} />}{children}</div>}
      </main>
      {/* The study buddy sits in the rail (the Ask tab on a phone), so it
          is on every page without covering any of it. */}
      <Papi />
      <SearchPalette />
    </div>
  );
}
