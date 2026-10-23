import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb } from "../db/client";
import { items, modules, taskChanges, tasks, users } from "../db/schema";
import type { TaskStep } from "../enrich/tasks";
import { classesOn, tasksView, updateTask } from "./tasks";
import { resolveChange } from "./changes";

const now = Date.parse("2026-10-01T10:00:00+08:00"); // Thu 1 Oct 2026
const D = 86_400_000;
const sgt = (s: string) => Date.parse(`${s}+08:00`);
const st = (text: string, doBy: string, done = false, minutes = 30): TaskStep => ({ id: text, text, minutes, doBy, done });

function setup(steps: TaskStep[], dueAt = sgt("2026-10-12T23:59:00")) {
  const db = createDb(":memory:");
  db.insert(users).values({ name: "a" }).run();
  db.insert(modules).values({ userId: 1, canvasCourseId: 7, code: "CS4238", name: "Computer Security Practice", active: true }).run();
  const ann = db.insert(items).values({ userId: 1, moduleId: 1, type: "announcement", source: "canvas", sourceId: "n1", title: "Quiz 3 moved", firstSeenAt: now, sourceCreatedAt: now }).returning().get();
  const t = db.insert(tasks).values({ userId: 1, moduleId: 1, key: "cs4238-quiz-3", title: "Quiz 3", kind: "quiz", dueAt, dueConfidence: "exact",
    sourcesJson: JSON.stringify([{ kind: "announcement", label: "Quiz 3 moved", itemId: ann.id }]), stepsJson: JSON.stringify(steps), createdAt: now, updatedAt: now }).returning().get();
  return { db, t, ann };
}
const steps = (db: ReturnType<typeof createDb>, id: number) => (JSON.parse(db.select().from(tasks).where(eq(tasks.id, id)).get()!.stepsJson) as TaskStep[]).map((s) => [s.text, s.doBy, s.done]);
const plan = [st("Read L5", "2026-10-02", true), st("Redo tutorial 4", "2026-10-06"), st("Past paper", "2026-10-10")];

describe("steps follow a date the student sets", () => {
  it("spreads the steps planned after it up to the new day, keeping done ones", () => {
    const { db, t } = setup(plan);
    expect(updateTask(db, 1, t.id, { dueDate: "2026-10-05" }, now)).toBe(true);
    expect(steps(db, t.id)).toEqual([["Read L5", "2026-10-02", true], ["Redo tutorial 4", "2026-10-03", false], ["Past paper", "2026-10-05", false]]);
  });
});

describe("steps follow a date from the bell", () => {
  it("when the student accepts the course's new date", () => {
    const { db, t, ann } = setup(plan);
    const c = db.insert(taskChanges).values({ userId: 1, moduleId: 1, taskId: t.id, kind: "date_proposed", title: "Quiz 3", oldDueAt: t.dueAt, newDueAt: sgt("2026-10-05T10:00:00"),
      newConfidence: "exact", sourceItemId: ann.id, createdAt: now }).returning().get();
    expect(resolveChange(db, 1, c.id, "accept", now)).toBe(true);
    expect(steps(db, t.id).map((s) => s[1])).toEqual(["2026-10-02", "2026-10-03", "2026-10-05"]);
  });
  it("when the student undoes a move", () => {
    const { db, t, ann } = setup(plan, sgt("2026-10-12T23:59:00"));
    const c = db.insert(taskChanges).values({ userId: 1, moduleId: 1, taskId: t.id, kind: "date_moved", title: "Quiz 3", oldDueAt: sgt("2026-10-04T23:59:00"), newDueAt: t.dueAt,
      newConfidence: "exact", sourceItemId: ann.id, createdAt: now }).returning().get();
    expect(resolveChange(db, 1, c.id, "undo", now)).toBe(true);
    expect(steps(db, t.id).map((s) => s[1]).every((d) => d <= "2026-10-04")).toBe(true);
  });
});

describe("tasksView days", () => {
  it("says how full each day is, with less room on days with classes", () => {
    const { db } = setup([st("Big revision", "2026-10-01", false, 150), st("Late one", "2026-09-29", false, 20)], sgt("2026-10-01T23:59:00"));
    db.insert(items).values({ userId: 1, moduleId: 1, type: "event", source: "canvas", sourceId: "e1", title: "Lecture", dueAt: sgt("2026-10-01T14:00:00"), firstSeenAt: now }).run();
    expect(classesOn(db, 1, "2026-10-01")).toEqual(new Map([["2026-10-01", 1]]));
    const { days } = tasksView(db, 1, now);
    expect(days).toHaveLength(14);
    expect(days[0]).toEqual({ date: "2026-10-01", minutes: 170, cap: 120, overloaded: true });
    expect(days[1]).toMatchObject({ date: "2026-10-02", minutes: 0, overloaded: false });
  });
});
