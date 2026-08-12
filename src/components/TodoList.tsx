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
                <span className={`truncate text-sm ${overdue ? "text-danger" : "text-ink"}`}>{todo.title}</span>
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
