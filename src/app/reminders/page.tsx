import { getDb } from "@/server/db";
import { requireUserId } from "@/server/session";
import { getOverview } from "@/server/overview";
import { loadEnv } from "@/lib/env";
import { AppShell } from "@/components/AppShell";
import { TodoList } from "@/components/TodoList";

export const dynamic = "force-dynamic";

export default async function RemindersPage() {
  const userId = await requireUserId();
  const now = Date.now();
  const overview = getOverview(getDb(), userId, now, loadEnv().POLL_INTERVAL_MS);
  const overdue = overview.todos.filter((t) => t.dueAt !== null && t.dueAt < now).length;

  return (
    <AppShell>
      <header className="mb-8 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-line pb-4">
        <h1 className="text-2xl font-semibold tracking-[-0.01em] text-ink">Reminders</h1>
        <span className="text-[13px] tabular-nums text-ink-2">
          {overview.todos.length} open
          {overdue > 0 && <span className="text-danger"> · {overdue} overdue</span>}
        </span>
      </header>

      <div className="max-w-3xl">
        <TodoList todos={overview.todos} modules={overview.modules} now={now} />
      </div>
    </AppShell>
  );
}
