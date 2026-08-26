import { getDb } from "@/server/db";
import { requireUserId } from "@/server/session";
import { getOverview } from "@/server/overview";
import { loadEnv } from "@/lib/env";
import { AppShell } from "@/components/AppShell";
import { SyncStatus } from "@/components/SyncStatus";
import { SyncButton } from "@/components/SyncButton";
import { ModuleGrid } from "@/components/ModuleGrid";

export const dynamic = "force-dynamic";

export default async function Home() {
  const userId = await requireUserId();
  const now = Date.now();
  const overview = getOverview(getDb(), userId, now, loadEnv().POLL_INTERVAL_MS);
  const dateLabel = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(now);

  return (
    <AppShell>
      {overview.graphAuthBroken && (
        <div className="mb-6 border border-warn bg-warn/10 px-4 py-3 text-sm text-warn">
          Reconnect Microsoft — <a href="/mail" className="underline underline-offset-2">reconnect on the Mail tab</a>
        </div>
      )}

      <header className="mb-8 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b border-line pb-4">
        <div>
          <div className="text-lg font-medium tabular-nums text-ink">{dateLabel}</div>
          <div className="text-xs uppercase tracking-wide text-ink-3">AY26/27</div>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <SyncStatus syncStatus={overview.syncStatus} />
          <SyncButton />
        </div>
      </header>

      <ModuleGrid modules={overview.modules} />
    </AppShell>
  );
}
