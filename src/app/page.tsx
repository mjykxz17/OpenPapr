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
import { tasksView } from "@/server/tasks";
import { HomeBoard, type WidgetViews } from "@/components/home/HomeBoard";
import { DoneWidget, DueWidget, ModulesWidget, NextWidget, TodayWidget, WeekWidget, type NextUp } from "@/components/home/Widgets";
import { parseLayout } from "@/lib/home-layout";

export const dynamic = "force-dynamic";

export default async function Home() {
  const userId = await requireUserId();
  const now = Date.now();
  const overview = getOverview(getDb(), userId, now, loadEnv().POLL_INTERVAL_MS);
  const user = getUser(getDb(), userId);
  const canvasTokenBroken = Boolean(user?.canvasTokenFailedAt && (!user.canvasVerifiedAt || user.canvasTokenFailedAt > user.canvasVerifiedAt));
  const db = getDb();
  const week = weeklyPlanView(db, userId, now);
  const tv = tasksView(db, userId, now);
  const todaySteps = { count: tv.today.length, minutes: tv.todayMinutes };
  const moduleIdByCode = Object.fromEntries(overview.modules.map((m) => [m.code.toUpperCase(), m.id]));
  const codeOf = (id: number | null) => overview.modules.find((m) => m.id === id)?.code ?? null;
  // Next up: dated Canvas work and the quizzes the planner expects, soonest first.
  const nextUp: NextUp[] = [
    ...overview.todos.filter((t) => t.category !== "routine" && t.dueAt !== null && t.dueAt >= now)
      .map((t) => ({ title: t.title, code: codeOf(t.moduleId), dueAt: t.dueAt!, estimated: false, href: null })),
    ...[...tv.soon, ...tv.later].filter((t) => t.anticipated && t.dueAt !== null && t.dueAt >= now)
      .map((t) => ({ title: t.title, code: t.code, dueAt: t.dueAt!, estimated: t.dueConfidence === "estimated", href: "/tasks" })),
  ].sort((a, b) => a.dueAt - b.dueAt);
  const overdue = overview.todos.filter((t) => t.category !== "routine" && t.dueAt !== null && t.dueAt < now).length;
  const views: WidgetViews = {
    week: {
      W: <WeekWidget plan={week.plan} today={todaySteps} size="W" />,
      L: <WeekWidget plan={week.plan} today={todaySteps} size="L" />,
      F: <WeekPlan {...week} todaySteps={todaySteps} moduleIdByCode={moduleIdByCode} hasModel={canGenerateGuides(db, userId)} />,
    },
    today: { S: <TodayWidget view={tv} size="S" />, W: <TodayWidget view={tv} size="W" />, L: <TodayWidget view={tv} size="L" /> },
    next: { S: <NextWidget items={nextUp} overdue={overdue} now={now} size="S" />, W: <NextWidget items={nextUp} overdue={overdue} now={now} size="W" /> },
    done: { S: <DoneWidget view={tv} size="S" />, W: <DoneWidget view={tv} size="W" /> },
    due: {
      W: <DueWidget todos={overview.todos} modules={overview.modules} now={now} size="W" />,
      L: <DueWidget todos={overview.todos} modules={overview.modules} now={now} size="L" />,
      F: <DueThisWeek todos={overview.todos} modules={overview.modules} now={now} />,
    },
    modules: {
      W: <ModulesWidget modules={overview.modules} size="W" />,
      L: <ModulesWidget modules={overview.modules} size="L" />,
      F: <ModuleGrid modules={overview.modules} />,
    },
  };
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

      <HomeBoard
        initial={parseLayout(user?.homeLayoutJson)}
        views={views}
        title={
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-[-0.01em] tabular-nums text-ink">{dateLabel}</h1>
            <SyncStatus syncStatus={overview.syncStatus} now={now} mailConnected={Boolean(user?.msRefreshTokenEnc)} />
          </div>
        }
        actions={<SyncButton lastSyncedAt={overview.syncStatus.find((x) => x.source === "canvas")?.lastOkAt ?? null} />}
      />
    </AppShell>
  );
}
