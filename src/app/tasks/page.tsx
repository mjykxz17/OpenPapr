import Link from "next/link";
import { getDb } from "@/server/db";
import { requireUserId } from "@/server/session";
import { getOverview } from "@/server/overview";
import { taskPlanStatus, tasksView } from "@/server/tasks";
import { canGenerateGuides } from "@/server/llm-access";
import { sgtDate } from "@/enrich/tasks";
import { loadEnv } from "@/lib/env";
import { AppShell } from "@/components/AppShell";
import { TodoList } from "@/components/TodoList";
import { TaskBoard } from "@/components/tasks/TaskBoard";
import { RebuildButton } from "@/components/profile/RebuildButton";

export const dynamic = "force-dynamic";

// Everything the student has to do, found wherever it was posted and broken
// into steps with a day for each. The raw Canvas list stays underneath, so
// nothing the planner skipped is ever out of sight.
export default async function TasksPage() {
  const userId = await requireUserId();
  const db = getDb();
  const now = Date.now();
  const view = tasksView(db, userId, now);
  const hasModel = canGenerateGuides(db, userId);
  const overview = getOverview(db, userId, now, loadEnv().POLL_INTERVAL_MS);
  const empty = !view.today.length && !view.soon.length && !view.later.length && !view.done.length;

  return (
    <AppShell>
      <header className="mb-8 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b border-line pb-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-[-0.01em] text-ink">Tasks</h1>
          <p className="text-[13px] text-ink-3">From Canvas, announcements, discussions and your slides — one task each, in small steps.</p>
        </div>
        {hasModel
          ? <RebuildButton scope="tasks" status={taskPlanStatus(db, userId)} noun="tasks" />
          : <Link href="/account" className="text-[13px] text-accent hover:underline">Add an AI key to plan tasks</Link>}
      </header>

      <div className="flex max-w-3xl flex-col gap-10">
        {empty ? (
          <p className="text-sm text-ink-2">
            {hasModel ? "Your tasks are planned after the next sync — or press Build now." : "With an AI key, OpenPapr reads your announcements and slides, finds what you have to do, and breaks it into steps."}
          </p>
        ) : (
          <TaskBoard view={view} today={sgtDate(now)} />
        )}

        <details className="group" open={empty && overview.todos.length > 0}>
          <summary className="cursor-pointer text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-2 hover:text-ink">
            Everything from Canvas ({overview.todos.length})
          </summary>
          <div className="mt-3">
            <TodoList todos={overview.todos} modules={overview.modules} now={now} />
          </div>
        </details>
      </div>
    </AppShell>
  );
}
