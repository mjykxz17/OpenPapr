import type { Overview } from "@/server/overview";
import { findWeightBadge } from "@/lib/component-display";
import { DismissButton } from "@/components/DismissButton";

export function TodoList({
  todos,
  modules,
  now,
}: {
  todos: Overview["todos"];
  modules: Overview["modules"];
  now: number;
}) {
  if (todos.length === 0) return <p className="text-sm text-ink-3">No reminders.</p>;

  const main = todos.filter((t) => t.category !== "routine");
  const routine = todos.filter((t) => t.category === "routine");

  // Group by module, groups ordered by their most urgent reminder (todos are
  // already sorted overdue-first then by due date).
  const codeFor = (moduleId: number | null) =>
    moduleId === null ? "General" : modules.find((m) => m.id === moduleId)?.code ?? "General";
  const groups: { label: string; rows: Overview["todos"] }[] = [];
  for (const t of main) {
    const label = codeFor(t.moduleId);
    const g = groups.find((g) => g.label === label);
    if (g) g.rows.push(t);
    else groups.push({ label, rows: [t] });
  }

  return (
    <>
      {groups.map((g) => (
        <div key={g.label} className="mb-3">
          <div className="text-xs font-medium uppercase tracking-wide text-ink-2">{g.label}</div>
          {renderRows(g.rows, modules, now)}
        </div>
      ))}
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
          <li key={todo.id} className="group flex items-center justify-between gap-4 py-3">
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
            <div className="flex shrink-0 items-center gap-2">
              {badge != null && (
                <span className="border border-line px-2 py-0.5 text-xs tabular-nums text-ink-2">{badge}%</span>
              )}
              <DismissButton itemId={todo.id} compact />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
