import type { Overview } from "@/server/overview";
import { findWeightBadge } from "@/lib/component-display";

export function TodoList({
  todos,
  modules,
  now,
}: {
  todos: Overview["todos"];
  modules: Overview["modules"];
  now: number;
}) {
  if (todos.length === 0) return <p className="text-sm text-ink-3">No to-dos.</p>;

  const main = todos.filter((t) => t.category !== "routine");
  const routine = todos.filter((t) => t.category === "routine");

  return (
    <>
      {renderRows(main, modules, now)}
      {routine.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs uppercase tracking-wide text-ink-3">
            Routine ({routine.length})
          </summary>
          {renderRows(routine, modules, now)}
        </details>
      )}
    </>
  );
}

function renderRows(todos: Overview["todos"], modules: Overview["modules"], now: number) {
  return (
    <ul className="divide-y divide-line">
      {todos.map((todo) => {
        const overdue = todo.dueAt !== null && todo.dueAt < now;
        const badge = findWeightBadge(todo, modules);
        return (
          <li key={todo.id} className="flex items-center justify-between gap-4 py-3">
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                {overdue && (
                  <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-danger">Overdue</span>
                )}
                <span
                  className={`truncate text-sm ${overdue ? "text-danger" : "text-ink"}`}
                  title={todo.type === "deadline" ? (todo.body ?? undefined) : undefined}
                >
                  {todo.title}
                </span>
                {todo.type === "deadline" && (
                  <span className="shrink-0 text-xs text-ink-3">extracted</span>
                )}
                {todo.seriesCount !== undefined && todo.seriesCount > 1 && (
                  <span className="shrink-0 text-xs tabular-nums text-ink-3">×{todo.seriesCount} sessions</span>
                )}
              </div>
              <div className="mt-0.5 text-xs tabular-nums text-ink-3">
                {todo.dueAt !== null ? new Date(todo.dueAt).toLocaleString() : "No due date"}
              </div>
            </div>
            {badge != null && (
              <span className="shrink-0 border border-line px-2 py-0.5 text-xs tabular-nums text-ink-2">{badge}%</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
