import { getDb } from "@/server/db";
import { requireUserId } from "@/server/session";
import { getOverview } from "@/server/overview";
import { loadEnv } from "@/lib/env";
import { AppShell } from "@/components/AppShell";
import { SyncStatus } from "@/components/SyncStatus";
import { SyncButton } from "@/components/SyncButton";
import { ModuleGrid } from "@/components/ModuleGrid";
import { DueThisWeek } from "@/components/DueThisWeek";
import { getUser } from "@/db/repo";
import { weeklyPlanView } from "@/server/profiles";
import { canGenerateGuides } from "@/server/llm-access";
import { WeekPlan } from "@/components/profile/WeekPlan";

export const dynamic = "force-dynamic";

export default async function Home() {
  const userId = await requireUserId();
  const now = Date.now();
  const overview = getOverview(getDb(), userId, now, loadEnv().POLL_INTERVAL_MS);
  const user = getUser(getDb(), userId);
  const canvasTokenBroken = Boolean(user?.canvasTokenFailedAt && (!user.canvasVerifiedAt || user.canvasTokenFailedAt > user.canvasVerifiedAt));
  const dateLabel = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(now);

  return (
    <AppShell>
      {canvasTokenBroken && (
        <div className="mb-6 rounded-md border border-warn-line bg-warn-soft px-4 py-3 text-sm text-warn-ink">
          Canvas stopped accepting your access token, so syncing is paused —{" "}
          <a href="/account" className="font-medium underline underline-offset-2">
            paste a new one in Account
          </a>
        </div>
      )}
      {overview.graphAuthBroken && (
        <div className="mb-6 rounded-md border border-warn-line bg-warn-soft px-4 py-3 text-sm text-warn-ink">
          Microsoft sign-in has expired —{" "}
          <a href="/mail" className="font-medium underline underline-offset-2">
            reconnect on the Mail tab
          </a>
        </div>
      )}

      <header className="mb-9 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-[-0.01em] tabular-nums text-ink">{dateLabel}</h1>
          <p className="text-sm text-ink-2">AY26/27</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <SyncStatus syncStatus={overview.syncStatus} now={now} />
          <SyncButton />
        </div>
      </header>

      <div className="flex flex-col gap-9">
        <WeekPlan
          {...weeklyPlanView(getDb(), userId, now)}
          today={new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "Asia/Singapore" }).format(now)}
          moduleIdByCode={Object.fromEntries(overview.modules.map((m) => [m.code.toUpperCase(), m.id]))}
          hasModel={canGenerateGuides(getDb(), userId)}
        />
        <DueThisWeek todos={overview.todos} modules={overview.modules} now={now} />
        <ModuleGrid modules={overview.modules} />
      </div>
    </AppShell>
  );
}
