import { describe, expect, it } from "vitest";
import type { TaskRow } from "@/server/task-rows";
import { legendFor } from "./CalendarView";
import { taskFromUrl, taskHref } from "./TasksApp";
import { KIND } from "./task-ui";

const row = (over: Partial<TaskRow>): TaskRow => ({
  id: "t1", taskId: 1, itemId: null, origin: "you", title: "Lab 3", code: null, moduleId: null, kind: "admin",
  day: "2026-10-08", time: null, estimated: false, week: null, overdue: false, missing: false, status: "todo",
  weightPct: null, counts: null, steps: [], why: null, notes: null, sources: [], link: null, event: false,
  can: { title: true, date: true, kind: true, module: true, done: true, remove: "delete", makeTask: false }, ...over,
});
const canvas = { title: false, date: false, kind: false, module: false, done: false, remove: null, makeTask: false } as const;

describe("the calendar's legend", () => {
  const from = "2026-09-28", to = "2026-11-01";
  it("explains only what the month on screen has", () => {
    expect(legendFor([row({})], from, to)).toBe("Drag to move · click a day to add");
    expect(legendFor([row({ origin: "schedule", can: canvas })], from, to)).toBe("Click a day to add · dashed = date not final yet");
    expect(legendFor([row({ estimated: true }), row({ id: "c", event: true, can: canvas })], from, to))
      .toBe("Drag to move · click a day to add · dashed = date not final yet · outlined = a class");
  });
  it("ignores what is in other months or has no date", () => {
    expect(legendFor([row({ day: "2026-12-01", estimated: true }), row({ day: null, event: true, can: canvas })], from, to)).toBe("Click a day to add");
  });
});

describe("a task in the address", () => {
  it("adds and removes ?task= without touching the rest", () => {
    expect(taskHref("https://op.app/tasks?view=calendar", "t12")).toBe("/tasks?view=calendar&task=t12");
    expect(taskHref("https://op.app/tasks?view=calendar&task=t12", null)).toBe("/tasks?view=calendar");
    expect(taskHref("https://op.app/tasks?task=t3", "t4")).toBe("/tasks?task=t4");
  });
  it("turns an old #task- link into ?task=", () => {
    expect(taskHref("https://op.app/tasks#task-12", "t12")).toBe("/tasks?task=t12");
    expect(taskFromUrl("", "#task-12")).toBe("t12");
    expect(taskFromUrl("?task=i50", "")).toBe("i50");
    expect(taskFromUrl("?view=board", "#a-3")).toBeNull();
  });
});

describe("type labels", () => {
  it("calls a plain task a task, not admin", () => {
    expect(KIND.admin).toBe("Task");
  });
});
