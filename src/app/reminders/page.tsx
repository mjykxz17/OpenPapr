import { getDb } from "@/server/db";
import { getOverview } from "@/server/overview";
import { loadEnv } from "@/lib/env";
import { AppShell } from "@/components/AppShell";
import { TodoList } from "@/components/TodoList";

export const dynamic = "force-dynamic";

export default function RemindersPage() {
  const now = Date.now();
  const overview = getOverview(getDb(), 1, now, loadEnv().POLL_INTERVAL_MS);
  const overdue = overview.todos.filter((t) => t.dueAt !== null && t.dueAt < now).length;

  return (
    <AppShell>
      <header className="mb-8 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-line pb-4">
        <h1 className="text-lg font-medium text-ink">Reminders</h1>
        <span className="text-xs tabular-nums text-ink-3">
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
