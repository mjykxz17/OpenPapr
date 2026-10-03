import { describe, expect, it } from "vitest";
import { createDb } from "../db/client";
import { files, items, moduleRoadmaps, modules, tasks, users } from "../db/schema";
import { cleanRoadmap, schedulePages } from "../enrich/roadmap";
import { classSlots, refreshRoadmaps, roadmapFiles, roadmapSignals } from "./roadmap";
import { refreshTasks } from "./tasks";

const H = 3_600_000;
const D = 24 * H;
const NOW = Date.parse("2026-10-03T12:00:00+08:00"); // Sat of Week 7
const cfg = { baseUrl: "https://llm.test/v1", apiKey: "k", model: "m" };
const sgt = (iso: string) => Date.parse(`${iso}+08:00`);

function setup() {
  const db = createDb(":memory:");
  db.insert(users).values({ name: "Aiden" }).run();
  const mod = db.insert(modules).values({ userId: 1, canvasCourseId: 1, code: "CS4238", name: "CS4238 Computer Security Practice [2610]", active: true }).returning().get();
  // The weekly class, on the Canvas calendar under the course's name.
  for (const d of ["2026-09-15", "2026-09-29", "2026-10-06", "2026-10-13"]) {
    db.insert(items).values({ userId: 1, moduleId: mod.id, type: "event", source: "canvas", sourceId: `event:${d}`, title: "CS4238 Computer Security Practice [2610]", dueAt: sgt(`${d}T18:30:00`), firstSeenAt: NOW - 30 * D }).run();
  }
  db.insert(files).values([
    { moduleId: mod.id, canvasFileId: 1, displayName: "L5 Web security.pdf", category: "slides", discoveredAt: NOW - 5 * D },
    { moduleId: mod.id, canvasFileId: 2, displayName: "L1 Introduction.pdf", category: "slides", discoveredAt: NOW - 50 * D },
    { moduleId: mod.id, canvasFileId: 3, displayName: "Course admin.pdf", category: "admin", discoveredAt: NOW - 49 * D },
  ]).run();
  return { db, mod };
}

describe("roadmap sources", () => {
  it("reads the admin deck and the first lecture before newer slides", () => {
    const { db, mod } = setup();
    const picked = roadmapFiles(db.select().from(files).all().filter((f) => f.moduleId === mod.id)).map((f) => f.displayName);
    expect(picked.slice(0, 2)).toEqual(["Course admin.pdf", "L1 Introduction.pdf"]);
  });

  it("sends the first pages and the schedule-looking ones, with page markers", () => {
    const deck = ["Welcome", "About me", "Grading", "Office hours", "Buffer overflow basics", "Week 8: Quiz 2 in lecture", "Stack canaries"]
      .map((t, i) => `${t}\n-- ${i + 1} of 7 --`).join("\n");
    const out = schedulePages(deck);
    expect(out).toContain("Week 8: Quiz 2 in lecture\n-- 6 of 7 --");
    expect(out).toContain("Welcome");
    expect(out).not.toContain("Stack canaries");
  });

  it("keeps only entries that cite a source and normalises weeks and times", () => {
    const items = cleanRoadmap({ items: [
      { title: "Quiz 2", kind: "quiz", week: "8", slot: "Lecture", time: "18:30", ref: "F3", page: 6, quote: "Quiz 2 (Week 8, in lecture)" },
      { title: "Midterm", kind: "midterm", week: "recess", ref: "S" },
      { title: "Made up", kind: "quiz", week: 9, ref: "Z9" },
    ] }, new Set(["F3", "S"]))!;
    expect(items.map((i) => [i.title, i.week, i.slot, i.time])).toEqual([["Quiz 2", 8, "lecture", "18:30"], ["Midterm", "recess", null, null]]);
  });
});

describe("roadmap → planner", () => {
  it("finds the weekly class slot on the Canvas calendar", () => {
    const { db } = setup();
    expect(classSlots(db.select().from(items).all())).toEqual([{ weekday: 2, time: "18:30", title: "CS4238 Computer Security Practice [2610]", count: 4 }]);
  });

  it("turns 'Quiz 2, Week 8, in lecture' into Tuesday 18:30 that week", () => {
    const { db, mod } = setup();
    db.insert(moduleRoadmaps).values({
      moduleId: mod.id, generatedAt: NOW,
      itemsJson: JSON.stringify([{ title: "Quiz 2", kind: "quiz", week: 8, date: null, time: null, slot: "lecture", weightPct: 10, covers: "L1-L6", ref: "F3", page: 6, quote: "Quiz 2 in Week 8 lecture" }]),
      sourcesJson: JSON.stringify([{ ref: "F3", label: "Course admin", fileId: 3 }]),
    }).run();
    const { lines, refs } = roadmapSignals(db, mod, NOW);
    expect(lines[0]!.line).toBe("Quiz 2 (quiz) — Week 8, Mon 5 Oct – Sun 11 Oct → in the lecture slot: Tue 6 Oct 18:30 (weekly Canvas event \"CS4238 Computer Security Practice [2610]\") — 10%, covers L1-L6");
    expect(refs.get("M1")).toMatchObject({ kind: "file", fileId: 3, page: 6 });
  });

  it("reads the roadmap once, then the planner sees it and the class slots", async () => {
    const { db } = setup();
    const roadLog: string[] = [], planLog: string[] = [];
    const roadmap = { items: [{ title: "Quiz 2", kind: "quiz", week: 8, slot: "lecture", ref: "F3", page: 6, quote: "Quiz 2 in Week 8 lecture" }] };
    const plan = { tasks: [{ key: "cs4238-quiz-2", title: "Quiz 2", kind: "quiz", due: "2026-10-06T18:30:00+08:00", dueConfidence: "exact",
      sources: [{ ref: "M1", quote: "Quiz 2 in Week 8 lecture" }], steps: [{ text: "Revise L1-L6", minutes: 45, doBy: "2026-10-05" }] }] };
    const fetchFn = (async (_u: string, init?: RequestInit) => {
      const msgs = JSON.parse(String(init?.body)).messages;
      const isRoad = String(msgs[0].content).startsWith("You read a university course");
      (isRoad ? roadLog : planLog).push(String(msgs[1].content));
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(isRoad ? roadmap : plan) } }] }));
    }) as unknown as typeof fetch;
    const deps = { db, now: () => NOW, cfgFor: () => cfg, fileText: async () => "Schedule\nWeek 8: Quiz 2 in lecture\n-- 1 of 1 --", fetchFn };
    await refreshTasks(deps, 1);
    expect(roadLog).toHaveLength(1);
    expect(roadLog[0]).toContain("=== [F3] Course admin.pdf ===");
    expect(planLog[0]).toContain("Week 8: Mon 5 Oct – Sun 11 Oct");
    expect(planLog[0]).toContain('Tue 18:30 — "CS4238 Computer Security Practice [2610]"');
    expect(planLog[0]).toContain("[M1] Quiz 2 (quiz) — Week 8");
    expect(db.select().from(tasks).all().map((t) => [t.title, t.dueAt])).toEqual([["Quiz 2", sgt("2026-10-06T18:30:00")]]);
    // Unchanged sources: no second read.
    await refreshRoadmaps(deps, 1, db.select().from(modules).all());
    expect(roadLog).toHaveLength(1);
  });
});

describe("schedules pasted as pictures", () => {
  it("spots a slide that is only a title over a picture", async () => {
    const { picturePages } = await import("../enrich/roadmap");
    const deck = ["Welcome to CS4238", "Teaching Mode & Grading • 13 Lectures • Quizzes (approx. 4): 40% • Incident reports: 40% • CTF: 20%", "Tentave Schedule", "Tentave Schedule 7", "Our lab environment and many more words about virtual machines"]
      .map((t, i) => `${t}\n-- ${i + 1} of 5 --`).join("\n");
    expect(picturePages(deck)).toEqual([3, 4]);
  });

  it("sends those pages as images, and falls back to text when the model can't take images", async () => {
    const { extractRoadmap } = await import("../enrich/roadmap");
    const bodies: unknown[] = [];
    let calls = 0;
    const fetchFn = (async (_u: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body.messages[1].content);
      calls++;
      if (calls === 1) return new Response("image input is not supported for this model", { status: 400 });
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"items":[]}' } }] }));
    }) as unknown as typeof fetch;
    const r = await extractRoadmap(cfg, { code: "CS4238", name: "x" }, [{ ref: "F1", label: "L1.pdf", text: "Tentative Schedule\n-- 6 of 7 --" }], fetchFn,
      [{ ref: "F1", label: "L1.pdf", page: 6, png: new Uint8Array([1, 2, 3]) }]);
    expect(Array.isArray(bodies[0])).toBe(true);
    expect(JSON.stringify(bodies[0])).toContain("data:image/png;base64,AQID");
    expect(typeof bodies[1]).toBe("string");
    expect(r).toEqual({ items: [], imagesRead: 0, imagesRefused: true });
  });
});

describe("citations by name", () => {
  it("maps a source cited by its file name back to its ref", async () => {
    const { cleanRoadmap, refResolver } = await import("../enrich/roadmap");
    const refs = new Set(["F36", "A9"]);
    const resolve = refResolver(refs, [{ ref: "F36", label: "CS4238-Lec01A.pdf" }, { ref: "A9", label: "Announcement: Week 2: Updates" }]);
    const items = cleanRoadmap({ items: [
      { title: "Quiz 1", kind: "quiz", week: "4", ref: "CS4238-Lec01A.pdf", page: 6 },
      { title: "Quiz 2", kind: "quiz", week: 6, ref: "[F36]", page: 6 },
      { title: "Quiz 3", kind: "quiz", week: 8, ref: "Week 2: Updates" },
      { title: "Nope", kind: "quiz", week: 9, ref: "Lecture 99.pdf" },
    ] }, refs, resolve)!;
    expect(items.map((i) => [i.title, i.ref, i.week])).toEqual([["Quiz 1", "F36", 4], ["Quiz 2", "F36", 6], ["Quiz 3", "A9", 8]]);
  });
});
