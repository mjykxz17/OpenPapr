import { redirect } from "next/navigation";
import { getDb } from "@/server/db";
import { requireUserId } from "@/server/session";
import { getOverview } from "@/server/overview";
import { loadEnv } from "@/lib/env";
import { AppShell } from "@/components/AppShell";
import { SyncStatus } from "@/components/SyncStatus";
import { SyncButton } from "@/components/SyncButton";
import { ModuleGrid } from "@/components/ModuleGrid";
import { getUser } from "@/db/repo";
import { weeklyPlanView } from "@/server/profiles";
import { canGenerateGuides } from "@/server/llm-access";
import { WeekPlan } from "@/components/profile/WeekPlan";
import { tasksView } from "@/server/tasks";
import { HomeBoard, type WidgetViews } from "@/components/home/HomeBoard";
import { DoneWidget, ModulesWidget, NextWidget, TodayWidget, UpcomingWidget, WeekWidget, type NextUp, type UpItem } from "@/components/home/Widgets";
import { findWeightBadge } from "@/lib/component-display";
import { parseLayout } from "@/lib/home-layout";
import { SetupChecklist } from "@/components/home/SetupChecklist";
import { sharedLlmConfig, userLlmConfig } from "@/lib/llm-provider";
import { semesterView } from "@/lib/acad-week";
import { calendarDues } from "@/server/calendar-dues";
import { MonthWidget } from "@/components/home/MonthWidget";
import { SemesterBar } from "@/components/home/SemesterBar";
import { shortDate, syncedLabel } from "@/lib/format-date";

export const dynamic = "force-dynamic";

export default async function Home() {
  const userId = await requireUserId();
  const now = Date.now();
  const overview = getOverview(getDb(), userId, now, loadEnv().POLL_INTERVAL_MS);
  const user = getUser(getDb(), userId);
  // New accounts go through the welcome steps first (or skip them).
  if (user && user.onboardedAt === null && !user.isDemo) redirect("/welcome");
  const canvasTokenBroken = Boolean(user?.canvasTokenFailedAt && (!user.canvasVerifiedAt || user.canvasTokenFailedAt > user.canvasVerifiedAt));
  const db = getDb();
  const week = weeklyPlanView(db, userId, now);
  const tv = tasksView(db, userId, now);
  const layout = parseLayout(user?.homeLayoutJson);
  // Today's steps are said once: by the Today widget when it is on the home
  // screen, otherwise by the This week card.
  const todayShown = layout.some((s) => s.id === "today" && !s.hidden);
  const todaySteps = todayShown ? null : { count: tv.today.length, minutes: tv.todayMinutes };
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
  // Coming up: everything dated in the next two weeks, overdue first, then
  // soonest; quizzes the planner expects are marked as such.
  const D = 86_400_000;
  const upcoming: UpItem[] = [
    ...overview.todos.filter((t) => t.category !== "routine" && t.dueAt !== null && t.dueAt < now + 14 * D)
      .map((t) => ({ key: `i${t.id}`, title: t.title, code: codeOf(t.moduleId), dueAt: t.dueAt!, overdue: t.dueAt! < now, estimated: false, worth: findWeightBadge(t, overview.modules), href: t.moduleId ? `/modules/${t.moduleId}` : "/tasks" })),
    ...[...tv.soon, ...tv.later].filter((t) => t.anticipated && t.dueAt !== null && t.dueAt >= now && t.dueAt < now + 21 * D)
      .map((t) => ({ key: `t${t.id}`, title: t.title.replace(/\s*\(expected\)$/i, ""), code: t.code, dueAt: t.dueAt!, overdue: false, estimated: t.dueConfidence === "estimated", worth: t.weightPct, href: `/tasks#task-${t.id}` })),
  ].sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.dueAt - b.dueAt);
  const cal = calendarDues(overview, tv, now);
  const calModules = overview.modules.filter((m) => !m.hidden).map((m) => ({ id: m.id, code: m.code }));
  const views: WidgetViews = {
    week: {
      W: <WeekWidget plan={week.plan} today={todaySteps} size="W" />,
      L: <WeekWidget plan={week.plan} today={todaySteps} size="L" />,
      F: <WeekPlan {...week} todaySteps={todaySteps} moduleIdByCode={moduleIdByCode} hasModel={canGenerateGuides(db, userId)} />,
    },
    today: { S: <TodayWidget view={tv} size="S" />, W: <TodayWidget view={tv} size="W" />, L: <TodayWidget view={tv} size="L" tomorrow={new Date(now + 8 * 3_600_000 + 86_400_000).toISOString().slice(0, 10)} /> },
    next: { S: <NextWidget items={nextUp} overdue={overdue} now={now} size="S" />, W: <NextWidget items={nextUp} overdue={overdue} now={now} size="W" /> },
    done: { S: <DoneWidget view={tv} size="S" />, W: <DoneWidget view={tv} size="W" /> },
    due: {
      W: <UpcomingWidget items={upcoming} now={now} size="W" />,
      // Large and full width: the month, with a card per day on hover or tap.
      L: <MonthWidget today={cal.today} dues={cal.dues} modules={calModules} />,
      F: <MonthWidget today={cal.today} dues={cal.dues} modules={calModules} />,
    },
    modules: {
      W: <ModulesWidget modules={overview.modules} size="W" />,
      L: <ModulesWidget modules={overview.modules} size="L" />,
      F: <ModuleGrid modules={overview.modules} />,
    },
  };
  const env = loadEnv();
  const ownAi = Boolean(user && userLlmConfig(user, env.SECRET_KEY));
  const setup = [
    { id: "canvas", label: "Link Canvas", hint: "Your modules, deadlines and slides", href: "/account#acct-canvas", done: Boolean(user?.canvasTokenEnc) && !canvasTokenBroken },
    { id: "password", label: "Set a sign-in password", hint: "So you can sign in without the Canvas token", href: "/account#acct-signin", done: Boolean(user?.passwordHash) },
    { id: "ai", label: ownAi ? "AI is on (your key)" : sharedLlmConfig(env) ? "AI is on (shared key)" : "Turn on AI", hint: "Guides, task plans and Papi's answers need it", href: "/account#acct-llm", done: ownAi || Boolean(sharedLlmConfig(env)) },
    { id: "about", label: "Tell OpenPapr about you", hint: "Your major and year shape the advice", href: "/account#acct-about", done: Boolean(user?.major || user?.studyYear || user?.profileJson) },
    { id: "calendar", label: "Add deadlines to your calendar", hint: "Google or Apple Calendar, kept up to date", href: "/account#acct-calendar", done: Boolean(user?.calendarToken) },
  ];
  const dateLabel = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(now);
  // The header: which week of the NUS semester it is, and whether anything
  // is due today.
  const sem = env.ACADEMIC_CALENDAR === "nus" ? semesterView(now) : null;
  const todayKey = new Date(now + 8 * 3_600_000).toISOString().slice(0, 10);
  const dueToday = overview.todos.filter((t) => t.category !== "routine" && t.dueAt !== null && t.dueAt >= now && new Date(t.dueAt + 8 * 3_600_000).toISOString().slice(0, 10) === todayKey).length;
  // Under the bar: only whether anything is due today; the week is the title.
  const semLine = dueToday ? `${dueToday} due today` : "Nothing due today";
  const canvasOkAt = overview.syncStatus.find((x) => x.source === "canvas")?.lastOkAt ?? null;
  // The server sleeps when nobody is using it, so data a few hours old on
  // opening is normal (the Sync button catches up straight away). Only a
  // source that hasn't synced for a day is worth a warning.
  const syncStale = overview.syncStatus.some((x) => (x.source === "canvas" || (x.source === "graph" && user?.msRefreshTokenEnc)) && x.stale
    && (x.lastOkAt === null || now - x.lastOkAt > 24 * 3_600_000));

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

      {!user?.isDemo && <SetupChecklist steps={setup} />}
      {overview.modules.length === 0 && !user?.canvasTokenEnc && (
        <div className="mb-6 rounded-[10px] border border-line bg-panel px-5 py-4">
          <p className="text-[15px] font-medium text-ink">No modules yet</p>
          <p className="mt-1 text-[14px] text-ink-2">Connect Canvas and your modules, deadlines and slides arrive within a couple of minutes.</p>
          <a href="/account#acct-canvas" className="mt-3 inline-flex h-9 items-center rounded-md bg-accent px-3.5 text-[13px] font-medium text-on-accent no-underline hover:bg-accent-strong">Connect Canvas</a>
        </div>
      )}
      <HomeBoard
        initial={layout}
        views={views}
        title={
          <div className="flex max-w-3xl flex-col">
            {sem ? (
              <>
                <h1 className="text-2xl font-semibold tracking-[-0.01em] tabular-nums text-ink">
                  {sem.title}{sem.weekOf && <span className="ml-1.5 text-[16px] font-medium text-ink-3">of {sem.weekOf}</span>}
                </h1>
                <p className="mt-0.5 text-[14px] text-ink-2">{dateLabel}{sem.phase === "vacation" && sem.nextSemStart ? ` · Semester ${sem.sem === 1 ? 2 : 1} starts ${shortDate(sem.nextSemStart)}` : ""}</p>
                <SemesterBar v={sem} />
                <p className="mt-2 text-[13.5px] text-ink-2">{semLine}</p>
              </>
            ) : (
              <h1 className="text-2xl font-semibold tracking-[-0.01em] tabular-nums text-ink">{dateLabel}</h1>
            )}
            {/* Sync is the icon on the right; this line only speaks up when something is stale. */}
            {user?.canvasTokenEnc && syncStale && <div className="mt-2"><SyncStatus syncStatus={overview.syncStatus} now={now} mailConnected={Boolean(user?.msRefreshTokenEnc)} /></div>}
          </div>
        }
        actions={user?.canvasTokenEnc ? <SyncButton lastSyncedAt={canvasOkAt} label={canvasOkAt ? `Synced ${syncedLabel(canvasOkAt, now)}` : "Not synced yet"} /> : null}
      />
    </AppShell>
  );
}
