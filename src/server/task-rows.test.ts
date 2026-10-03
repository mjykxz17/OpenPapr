import { describe, expect, it } from "vitest";
import { taskRows } from "./task-rows";
import type { Overview } from "./overview";
import type { TasksView, TaskView } from "./tasks";
import type { CalDue } from "./calendar-dues";

const ov = (todos: unknown[] = []) => ({ modules: [{ id: 1, code: "CS4238", name: "CS4238", components: [] }], todos } as unknown as Overview);
const task = (v: Partial<TaskView>): TaskView => ({ id: 1, moduleId: 1, code: "CS4238", title: "T", kind: "quiz", dueAt: null, dueConfidence: "exact", anticipated: false,
  weightPct: null, why: null, sources: [], steps: [], status: "open", done: 0, total: 0, dueText: "", overdue: false, missing: false,
  manual: false, notes: null, started: false, time: null, ...v });
const tv = (open: TaskView[], done: TaskView[] = []): TasksView => ({ today: [], todayMinutes: 0, nextDay: null, soon: open, later: [], done });
const due = (v: Partial<CalDue>): CalDue => ({ key: "i1", day: "2026-10-06", time: "23:59", title: "X", code: "CS4238", moduleId: 1, href: "/modules/1",
  counts: null, estimated: false, exam: false, overdue: false, plan: null, event: null, ...v });

describe("taskRows", () => {
  it("shows a Canvas item once, as the task planned for it, with Canvas's date locked", () => {
    const t = task({ id: 7, title: "Assignment-2", dueAt: Date.parse("2026-10-11T23:59:00+08:00"), sources: [{ kind: "canvas", label: "A2", itemId: 50, href: "https://canvas/a2", external: true }] });
    const rows = taskRows(ov([{ id: 50, url: "https://canvas/a2" }]), tv([t]), [due({ key: "i50", href: "/tasks#task-7" })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "t7", origin: "canvas", itemId: 50, day: "2026-10-11", link: { href: "https://canvas/a2" } });
    expect(rows[0]!.can.date).toBe(false);
  });

  it("lets the student change everything about their own task, and the planner's apart from the module", () => {
    const rows = taskRows(ov(), tv([task({ id: 1, manual: true, kind: "personal", title: "Dentist", dueAt: Date.parse("2026-10-08T15:00:00+08:00"), time: "15:00" }), task({ id: 2, title: "Quiz 3 (expected)" })]), []);
    const [mine, ai] = [rows.find((r) => r.taskId === 1)!, rows.find((r) => r.taskId === 2)!];
    expect(mine).toMatchObject({ origin: "you", time: "15:00", day: "2026-10-08", can: { module: true, remove: "delete" } });
    expect(ai).toMatchObject({ origin: "ai", title: "Quiz 3", day: null, can: { module: false, date: true, remove: "dismiss" } });
  });

  it("adds Canvas work nobody planned, classes for the calendar, and schedule entries that can become tasks", () => {
    const rows = taskRows(ov([{ id: 3, type: "event", url: null }, { id: 4, type: "assignment", url: "u" }]), tv([]), [
      due({ key: "i3", title: "Class session", time: "18:30", event: { note: null, repeats: 10 } }),
      due({ key: "i4", title: "Forms", day: "2026-10-09" }),
      due({ key: "r1-Incident 3-1", title: "Incident 3", day: "2026-10-09", estimated: true, schedule: { source: "Lec01A p.7", week: "Week 8", placed: "week", covers: null } }),
    ]);
    expect(rows.map((r) => [r.id, r.origin, r.event])).toEqual([["i3", "canvas", true], ["i4", "canvas", false], ["r1-Incident 3-1", "schedule", false]]);
    expect(rows[1]).toMatchObject({ time: null, can: { remove: "hide", date: false } });
    expect(rows[2]).toMatchObject({ week: "Week 8", time: null, can: { makeTask: true } });
  });

  it("files a started task under Doing and a finished one under Done", () => {
    const rows = taskRows(ov(), tv([task({ id: 1, started: true })], [task({ id: 2, status: "done" })]), []);
    expect(rows.map((r) => r.status).sort()).toEqual(["doing", "done"]);
  });
});
