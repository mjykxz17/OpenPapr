import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb } from "../db/client";
import { components, items, moduleProfiles, modules, slideNotes, users, weeklyPlans } from "../db/schema";
import { clearProfileRequests, effectiveComponents, refreshProfiles, usersWithProfileRequests, type ProfileDeps } from "./profiles";
import { getModuleProfileRow, listCourseHistory, weekStartSgt } from "../db/profiles-repo";
import { readerBrief, ModuleProfile, UserProfile } from "../enrich/profiles";
import type { CanvasClient } from "../connectors/canvas/client";

const NOW = Date.UTC(2026, 8, 23, 2, 0); // Wed 23 Sep 2026, 10:00 SGT
const cfg = { baseUrl: "https://llm.test/v1", apiKey: "k", model: "m" };

const moduleJson = { oneLine: "Hands-on security practice.", covers: ["web", "binary"], assessment: "Labs 40%, final 60%",
  lecturers: [{ name: "Dr A", background: "systems security", emphasis: ["writing exploits"] }],
  studentsSay: { workload: "heavy", difficulty: "hard", tips: ["start labs early"], pitfalls: ["underestimating lab 3"] },
  fit: { buildsOn: ["CS2105 networking"], gaps: ["x86 assembly"], relevance: "core for infosec" }, howToStudy: ["redo labs"] };
const userJson = { headline: "Year 3 InfoSec student", background: ["networking"], strengths: ["security"], watchOuts: ["heavy labs"],
  thisSemester: "security-heavy", guideVoice: "assume CS2105; use networking analogies" };
const styleJson = { languages: "English with some Mandarin", tone: "terse", length: "short", format: "arrows and bullets", summary: "Terse bullets with arrows." };
const planJson = { overview: "Lab week.", priorities: [{ module: "CS4238", focus: "lab 3", why: "due Friday" }],
  days: [{ day: "Mon", items: [{ module: "CS4238", task: "old", minutes: 60 }] }, { day: "Wed", items: [{ module: "CS4238", task: "lab 3 part 1", minutes: 90 }] }] };

function fakeFetch(log: string[]) {
  return (async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith("https://api.nusmods.com/")) {
      log.push("nusmods");
      return new Response(JSON.stringify({ moduleCode: "CS4238", title: "Computer Security Practice", description: "Practice.", workload: [2, 1, 0, 3, 4] }));
    }
    if (u.startsWith("https://disqus.com/")) {
      log.push("disqus");
      return new Response(JSON.stringify({ code: 0, response: [{ raw_message: "Labs are heavy, start early and read the hints.", createdAt: "2026-01-01", likes: 4 }], cursor: { hasNext: false } }));
    }
    if (u.startsWith("https://llm.test/")) {
      const body = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
      const sys = body.messages[0]!.content;
      const kind = sys.includes("study profile of one university module") ? "module"
        : sys.includes("describe how a student writes") ? "style"
        : sys.includes("working profile of an NUS student") ? "user" : "plan";
      log.push(`llm:${kind}`);
      const content = JSON.stringify({ module: moduleJson, style: styleJson, user: userJson, plan: planJson }[kind]);
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }));
    }
    throw new Error(`unexpected fetch ${u}`);
  }) as unknown as typeof fetch;
}

const canvas = {
  listCourseHistory: async () => [
    { id: 11, name: "Computer Security Practice", course_code: "CS4238", term: { name: "AY26/27 S1" }, historyState: "active" as const },
    { id: 5, name: "Computer Networks", course_code: "CS2105", term: { name: "AY24/25 S2" }, historyState: "completed" as const },
  ],
  listCourseTeachers: async () => [{ id: 1, name: "Dr A" }],
} as unknown as CanvasClient;

function setup(opts: { cfg?: boolean; notes?: number } = {}) {
  const db = createDb(":memory:");
  db.insert(users).values({ name: "Aiden", major: "Information Security", studyYear: 3 }).run();
  db.insert(modules).values({ userId: 1, canvasCourseId: 11, code: "CS4238", name: "Computer Security Practice", active: true }).run();
  db.insert(components).values([
    { moduleId: 1, name: "Labs", weightPct: 40, source: "llm_syllabus" },
    { moduleId: 1, name: "Final", weightPct: 60, source: "llm_syllabus" },
  ]).run();
  db.insert(items).values({ userId: 1, moduleId: 1, type: "assignment", source: "canvas", sourceId: "a1", title: "Lab 3", dueAt: NOW + 2 * 86_400_000, firstSeenAt: NOW }).run();
  if (opts.notes) db.insert(slideNotes).values({ userId: 1, moduleId: 1, deck: "L1", page: 1, markdown: "ROP → chain gadgets; 栈 overflow ".repeat(opts.notes), updatedAt: NOW }).run();
  const log: string[] = [];
  let now = NOW;
  const deps: ProfileDeps = {
    db, now: () => now, disqusKey: "dq", fetchFn: fakeFetch(log),
    cfgFor: () => (opts.cfg === false ? null : cfg), canvasFor: () => canvas,
  };
  return { db, deps, log, advance: (ms: number) => { now += ms; } };
}

describe("refreshProfiles", () => {
  it("builds history, the module profile, the student profile and the week", async () => {
    const { db, deps, log } = setup({ notes: 20 });
    const r = await refreshProfiles(deps, 1);
    expect(r.errors).toEqual([]);
    expect(r).toMatchObject({ history: true, modules: 1, style: true, user: true, plan: true });
    expect(listCourseHistory(db, 1).map((h) => h.code).sort()).toEqual(["CS2105", "CS4238"]);
    const mp = getModuleProfileRow(db, 1)!;
    expect(JSON.parse(mp.profileJson!).fit.gaps).toEqual(["x86 assembly"]);
    expect(JSON.parse(mp.lecturersJson!)).toEqual([{ name: "Dr A" }]);
    const plan = db.select().from(weeklyPlans).get()!;
    expect(plan.weekStart).toBe(weekStartSgt(NOW));
    // Monday has passed: the plan keeps only the days left.
    expect(JSON.parse(plan.planJson!).days.map((d: { day: string }) => d.day)).toEqual(["Wed"]);
    expect(log.filter((l) => l.startsWith("llm")).sort()).toEqual(["llm:module", "llm:plan", "llm:style", "llm:user"]);
  });

  it("does not call the model again when nothing changed", async () => {
    const { deps, log, advance } = setup();
    await refreshProfiles(deps, 1);
    const before = log.filter((l) => l.startsWith("llm")).length;
    advance(60_000);
    const r = await refreshProfiles(deps, 1);
    expect(r).toMatchObject({ modules: 0, user: false, plan: false });
    expect(log.filter((l) => l.startsWith("llm")).length).toBe(before);
    expect(log.filter((l) => l === "nusmods")).toHaveLength(1); // cached for a week
  });

  it("rebuilds a module profile the student asked for", async () => {
    const { db, deps, log, advance } = setup();
    await refreshProfiles(deps, 1);
    advance(60_000);
    db.update(moduleProfiles).set({ requestedAt: NOW }).where(eq(moduleProfiles.moduleId, 1)).run();
    expect(usersWithProfileRequests(db)).toEqual([1]);
    const r = await refreshProfiles(deps, 1);
    expect(r.modules).toBe(1);
    expect(getModuleProfileRow(db, 1)!.requestedAt).toBeNull();
    expect(log.filter((l) => l === "llm:module")).toHaveLength(2);
  });

  it("leaves writing style alone when the student switched it off", async () => {
    const { db, deps } = setup({ notes: 20 });
    db.update(users).set({ styleLearning: false }).run();
    const r = await refreshProfiles(deps, 1);
    expect(r.style).toBe(false);
    expect(db.select().from(users).get()!.writingStyleJson).toBeNull();
  });

  it("needs enough notes before describing a style", async () => {
    const { deps } = setup({ notes: 2 });
    expect((await refreshProfiles(deps, 1)).style).toBe(false);
  });

  it("without a model it still gathers data and clears requests", async () => {
    const { db, deps, log } = setup({ cfg: false });
    db.update(users).set({ profileRequestedAt: NOW }).run();
    const r = await refreshProfiles(deps, 1);
    expect(r.history).toBe(true);
    expect(log).toContain("nusmods");
    expect(log.some((l) => l.startsWith("llm"))).toBe(false);
    const u = db.select().from(users).get()!;
    expect(u.profileRequestedAt).toBeNull();
    expect(u.profileError).toMatch(/no AI provider/);
    expect(usersWithProfileRequests(db)).toEqual([]);
  });

  it("records a model failure without throwing", async () => {
    const { db, deps } = setup();
    deps.fetchFn = (async (url: string) => String(url).startsWith("https://llm.test/")
      ? new Response("overloaded", { status: 529 }) : fakeFetch([])(url)) as unknown as typeof fetch;
    const r = await refreshProfiles(deps, 1);
    expect(r.errors.join(" ")).toMatch(/llm 529/);
    expect(getModuleProfileRow(db, 1)!.error).toMatch(/llm 529/);
  });
});

describe("clearProfileRequests", () => {
  it("clears every pending flag for the user", () => {
    const { db } = setup();
    db.insert(moduleProfiles).values({ moduleId: 1, requestedAt: 1 }).run();
    db.insert(weeklyPlans).values({ userId: 1, weekStart: 0, requestedAt: 1 }).run();
    db.update(users).set({ profileRequestedAt: 1 }).run();
    clearProfileRequests(db, 1, null);
    expect(usersWithProfileRequests(db)).toEqual([]);
  });
});

describe("effectiveComponents", () => {
  it("prefers manual over Canvas over the syllabus model", () => {
    expect(effectiveComponents([
      { name: "A", weightPct: 50, source: "llm_syllabus" },
      { name: "B", weightPct: 100, source: "canvas_api" },
    ])).toEqual([{ name: "B", weightPct: 100 }]);
  });
});

describe("readerBrief", () => {
  it("tells the guide writer who it is writing for", () => {
    const brief = readerBrief(UserProfile.parse(userJson), null, ModuleProfile.parse(moduleJson))!;
    expect(brief).toContain("assume CS2105");
    expect(brief).toContain("x86 assembly");
    expect(brief).toContain("writing exploits");
    expect(readerBrief(null, null, null)).toBeNull();
  });
});

describe("weekStartSgt", () => {
  it("is Monday midnight in Singapore", () => {
    expect(new Date(weekStartSgt(NOW)).toISOString()).toBe("2026-09-20T16:00:00.000Z");
  });
});

describe("groundModuleProfile", () => {
  it("drops review verdicts without reviews, backgrounds without a page, and unknown lecturers", async () => {
    const { groundModuleProfile } = await import("../enrich/profiles");
    const p = ModuleProfile.parse({ ...moduleJson, lecturers: [...moduleJson.lecturers, { name: "Prof Invented", background: "made up", emphasis: [] }] });
    const g = groundModuleProfile(p, {
      module: { code: "CS4238", name: "x", term: null }, nusmods: null, reviews: [], reviewTotal: 0,
      lecturers: [{ name: "Dr A", pageText: null }], components: [], announcements: [], fileNames: [],
      student: { major: null, year: null, history: [] },
    });
    expect(g.studentsSay).toBeNull();
    expect(g.lecturers).toEqual([{ name: "Dr A", background: null, emphasis: ["writing exploits"] }]);
  });
});
