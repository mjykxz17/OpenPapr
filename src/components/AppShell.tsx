import type { ReactNode } from "react";
import { Rail } from "./Rail";

// `wide` opts a page out of the 1280px cap. Dashboard-style pages read better
// capped — a grid of tiles stretched across a 27" display looks sparse — but a
// long document wants the screen it is given.
export function AppShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="min-h-svh bg-surface text-ink">
      <Rail />
      <main className="pl-[52px]">
        <div className={`mx-auto px-6 py-10 ${wide ? "max-w-[1800px]" : "max-w-[1280px]"}`}>{children}</div>
      </main>
    </div>
  );
}
