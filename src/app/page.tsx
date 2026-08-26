import { getDb } from "@/server/db";
import { getOverview } from "@/server/overview";
import { loadEnv } from "@/lib/env";
import { AppShell } from "@/components/AppShell";
import { SyncButton } from "@/components/SyncButton";
import { SyncStatus } from "@/components/SyncStatus";
import { ModuleGrid } from "@/components/ModuleGrid";

export const dynamic = "force-dynamic";

export default function Home() {
  const now = Date.now();
  const overview = getOverview(getDb(), 1, now, loadEnv().POLL_INTERVAL_MS);
  const dateLabel = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(now);

  return (
    <AppShell>
      {overview.graphAuthBroken && (
        <div className="mb-6 border border-warn bg-warn/10 px-4 py-3 text-sm text-warn">
          Reconnect Microsoft — run scripts/connect-microsoft.ts
        </div>
      )}

      <header className="mb-8 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b border-line pb-4">
        <div>
          <div className="text-lg font-medium tabular-nums text-ink">{dateLabel}</div>
          <div className="text-xs uppercase tracking-wide text-ink-3">AY26/27</div>
        </div>
        <div className="flex items-center gap-4">
          <SyncStatus syncStatus={overview.syncStatus} />
          <SyncButton />
        </div>
      </header>

      <ModuleGrid modules={overview.modules} />
    </AppShell>
  );
}
