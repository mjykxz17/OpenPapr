import type { ReactNode } from "react";
import { Rail } from "./Rail";
import { currentUserId } from "@/server/session";
import { getDb } from "@/server/db";
import { getUser } from "@/db/repo";
import { loadEnv } from "@/lib/env";
import { Papi } from "./pet/Papi";

// `wide` opts a page out of the 1280px cap. Dashboard-style pages read better
// capped — a grid of tiles stretched across a 27" display looks sparse — but a
// long document wants the screen it is given.
// `bleed` gives a tool page (the file viewer) the whole area beside the rail,
// with no padding or cap: it manages its own edges and scrolling.
// Mail is offered once it can work: when this instance has Outlook set up
// (so it can be connected) or the student has connected it.
async function mailAvailable(): Promise<boolean> {
  if (loadEnv().MS_CLIENT_ID) return true;
  const id = await currentUserId().catch(() => null);
  return Boolean(id && getUser(getDb(), id)?.msRefreshTokenEnc);
}

export async function AppShell({ children, wide = false, bleed = false }: { children: ReactNode; wide?: boolean; bleed?: boolean }) {
  const showMail = await mailAvailable();
  return (
    <div className="min-h-svh bg-surface text-ink">
      <Rail showMail={showMail} />
      {/* Room for the tab bar (and Papi above it) on a phone; for the rail beside. */}
      <main className={`sm:pl-14 ${bleed ? "pb-[60px] sm:pb-0" : "pb-24 sm:pb-16"}`}>
        {bleed ? children : <div className={`mx-auto px-4 py-6 sm:px-10 sm:py-9 ${wide ? "max-w-[1800px]" : "max-w-[1280px]"}`}>{children}</div>}
      </main>
      {/* The study buddy lives on every page except the file viewer, whose
          controls sit where it would. */}
      {!bleed && <Papi />}
    </div>
  );
}
