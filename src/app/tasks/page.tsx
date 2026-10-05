import Link from "next/link";
import { getDb } from "@/server/db";
import { requireUserId } from "@/server/session";
import { getOverview } from "@/server/overview";
import { taskPlanStatus, tasksView } from "@/server/tasks";
import { canGenerateGuides } from "@/server/llm-access";
import { sgtDate } from "@/enrich/tasks";
import { loadEnv } from "@/lib/env";
import { semesterWeeks } from "@/lib/acad-week";
import { calendarDues } from "@/server/calendar-dues";
import { taskRows, weekBands } from "@/server/task-rows";
import { AppShell } from "@/components/AppShell";
import { TodoList } from "@/components/TodoList";
import { TodaySteps } from "@/components/tasks/TodaySteps";
import { TasksApp } from "@/components/tasks/TasksApp";
import { RebuildButton } from "@/components/profile/RebuildButton";

export const dynamic = "force-dynamic";

// Everything the student has to do, wherever it came from — Canvas, the
// planner, the course's own schedule, or added by hand — as one list with
// table, calendar and board views.
export default async function TasksPage() {
  const userId = await requireUserId();
  const db = getDb();
  const now = Date.now();
  const view = tasksView(db, userId, now);
  const hasModel = canGenerateGuides(db, userId);
  const overview = getOverview(db, userId, now, loadEnv().POLL_INTERVAL_MS);
  const cal = calendarDues(overview, view, now);
  const rows = taskRows(overview, view, cal.dues);
  const modules = overview.modules.filter((m) => !m.hidden).map((m) => ({ id: m.id, code: m.code }));
  const today = sgtDate(now);

  return (
    <AppShell wide>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-[-0.01em] text-ink">Tasks</h1>
          <p className="text-[13px] text-ink-3">What your courses have posted and what you've added, in one list.</p>
        </div>
        {hasModel
          ? <RebuildButton scope="tasks" status={taskPlanStatus(db, userId)} noun="tasks" />
          : <Link href="/account" className="text-[13px] text-accent hover:underline">Add an AI key to plan tasks</Link>}
      </header>

      {view.today.length > 0 && (
        <>
          <div className="mb-6 hidden max-w-3xl sm:block"><TodaySteps view={view} today={today} /></div>
          {/* On a phone today's steps fold away, so the views start on screen. */}
          <details className="mb-4 rounded-[10px] border border-line bg-panel sm:hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-[14px] [&::-webkit-details-marker]:hidden">
              <b className="font-semibold text-ink">Today’s steps</b>
              <span className="text-ink-2">{view.today.length} · {view.todayMinutes < 60 ? `${view.todayMinutes}m` : `${Math.floor(view.todayMinutes / 60)}h${view.todayMinutes % 60 ? ` ${view.todayMinutes % 60}m` : ""}`} ▾</span>
            </summary>
            <div className="border-t border-line p-2"><TodaySteps view={view} today={today} /></div>
          </details>
        </>
      )}

      <TasksApp rows={rows} modules={modules} today={today} weeks={weekBands(semesterWeeks(now).weeks)} />

      <details className="group mt-10 max-w-3xl">
        <summary className="cursor-pointer text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-2 hover:text-ink">
          Everything from Canvas ({overview.todos.length})
        </summary>
        <div className="mt-3">
          <TodoList todos={overview.todos} modules={overview.modules} now={now} />
        </div>
      </details>
    </AppShell>
  );
}
