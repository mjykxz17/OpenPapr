import type { ReactNode } from "react";
import { Rail } from "./Rail";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-svh bg-surface text-ink">
      <Rail />
      <main className="pl-[52px]">
        <div className="mx-auto max-w-[1280px] px-6 py-10">{children}</div>
      </main>
    </div>
  );
}
