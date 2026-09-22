import type { ReactNode } from "react";
import { Rail } from "./Rail";

// `wide` opts a page out of the 1280px cap. Dashboard-style pages read better
// capped — a grid of tiles stretched across a 27" display looks sparse — but a
// long document wants the screen it is given.
// `bleed` gives a tool page (the file viewer) the whole area beside the rail,
// with no padding or cap: it manages its own edges and scrolling.
export function AppShell({ children, wide = false, bleed = false }: { children: ReactNode; wide?: boolean; bleed?: boolean }) {
  return (
    <div className="min-h-svh bg-surface text-ink">
      <Rail />
      <main className="pl-14">
        {bleed ? children : <div className={`mx-auto px-10 py-9 ${wide ? "max-w-[1800px]" : "max-w-[1280px]"}`}>{children}</div>}
      </main>
    </div>
  );
}
