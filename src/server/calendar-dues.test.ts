import { describe, expect, it } from "vitest";
import { eventTitle } from "./calendar-dues";

const mod = { code: "CS4238", name: "CS4238 Computer Security Practice [2610]" };

describe("eventTitle", () => {
  it("names an event that only repeats the course name a class session", () => {
    expect(eventTitle("CS4238 Computer Security Practice [2610]", mod)).toBe("Class session");
    expect(eventTitle("CS4238", mod)).toBe("Class session");
  });
  it("keeps a real title, without the term tag", () => {
    expect(eventTitle("CTF briefing [2610]", mod)).toBe("CTF briefing");
    expect(eventTitle("Guest talk: red teaming", mod)).toBe("Guest talk: red teaming");
  });
});

import { calendarDues } from "./calendar-dues";
import type { Overview } from "./overview";
import type { TasksView, TaskView } from "./tasks";

describe("calendarDues", () => {
  const NOW = Date.parse("2026-10-03T12:00:00+08:00");
  const ov = (todos: unknown[] = []) => ({ modules: [{ id: 1, code: "CS4238", name: "CS4238 Computer Security Practice [2610]", components: [] }], todos } as unknown as Overview);
  const task = (v: Partial<TaskView>): TaskView => ({ id: 1, moduleId: 1, code: "CS4238", title: "T", kind: "quiz", dueAt: null, dueConfidence: "exact", anticipated: false,
    weightPct: null, why: null, sources: [], steps: [], status: "open", done: 0, total: 0, dueText: "", overdue: false, missing: false, manual: false, notes: null, started: false, time: null, ...v });
  const tv = (open: TaskView[]): TasksView => ({ today: [], todayMinutes: 0, nextDay: null, soon: open, later: [], done: [] });

  it("shows a quiz task that cites the previous quiz as its pattern", () => {
    const q3 = task({ title: "Submit Quiz 3", dueAt: Date.parse("2026-10-06T23:59:00+08:00"), sources: [{ kind: "canvas", label: "Quiz-2", itemId: 330, href: null, external: false }] });
    const { dues } = calendarDues(ov(), tv([q3]), NOW);
    expect(dues.map((d) => [d.title, d.day])).toEqual([["Submit Quiz 3", "2026-10-06"]]);
  });

  it("fills in the semester from the course schedule, skipping what a task already covers", () => {
    const q3 = task({ title: "Submit Quiz 3", dueAt: Date.parse("2026-10-06T23:59:00+08:00") });
    const base = { moduleId: 1, kind: "quiz" as const, time: "18:30", placed: "slot" as const, weightPct: 40, covers: null, source: "CS4238-Lec01A p.7", fileId: 36, page: 7 };
    const roadmap = [
      { ...base, title: "Quiz 3 (Incident2, W6, W7)", at: Date.parse("2026-10-06T18:30:00+08:00"), week: "Week 8", weekFrom: Date.parse("2026-10-05T00:00:00+08:00"), weekTo: Date.parse("2026-10-11T23:59:59+08:00") },
      { ...base, title: "Quiz 4 (Incident3, W8, W9)", at: Date.parse("2026-10-20T18:30:00+08:00"), week: "Week 10", weekFrom: Date.parse("2026-10-19T00:00:00+08:00"), weekTo: Date.parse("2026-10-25T23:59:59+08:00") },
      { ...base, title: "CTF", kind: "project" as const, placed: "week" as const, time: null, at: Date.parse("2026-10-30T23:59:00+08:00"), week: "Week 11", weekFrom: Date.parse("2026-10-26T00:00:00+08:00"), weekTo: Date.parse("2026-11-01T23:59:59+08:00") },
    ];
    const { dues } = calendarDues(ov(), tv([q3]), NOW, { roadmap, allTasks: [{ moduleId: 1, title: "Submit Quiz 3", dueAt: q3.dueAt }] });
    expect(dues.map((d) => [d.title, d.day, d.schedule?.week ?? null])).toEqual([
      ["Submit Quiz 3", "2026-10-06", null], ["Quiz 4", "2026-10-20", "Week 10"], ["CTF", "2026-10-30", "Week 11"],
    ]);
  });
});
