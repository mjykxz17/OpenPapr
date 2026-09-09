// run: npx tsx scripts/seed-demo.ts
//
// Seeds data/demo.db with a single-user demo fixture used by the Playwright
// smoke test (e2e/smoke.spec.ts) and for manual `npm run dev` exploration.
// Idempotent: deletes any existing data/demo.db (and its WAL/SHM sidecars)
// before writing, so re-running always produces the same fixture.
import { existsSync, rmSync } from "node:fs";
import { createDb } from "../src/db/client";
import { components, items, modules, syncRuns, users } from "../src/db/schema";
import { setModuleNotes, setModuleProfile } from "../src/db/repo";

const DB_PATH = "data/demo.db";
for (const suffix of ["", "-wal", "-shm"]) {
  const p = `${DB_PATH}${suffix}`;
  if (existsSync(p)) rmSync(p);
}

const db = createDb(DB_PATH);

const now = Date.now();
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// Everything stamped `seenFirstSeenAt` predates lastSeenAt, i.e. "already seen" on
// a prior visit. The deadline_change item below is stamped *after* lastSeenAt so
// "What's new" has something to show.
const lastSeenAt = now - 3 * DAY;
const seenFirstSeenAt = now - 5 * DAY;

const user = db.insert(users).values({ name: "Demo Student", lastSeenAt }).returning().get();

const cs2103t = db
  .insert(modules)
  .values({
    userId: user.id,
    canvasCourseId: 51001,
    code: "CS2103T",
    name: "Software Engineering",
    term: "AY26/27 Sem 1",
    syllabusBody: "<p>Grading: Midterm 15%, Finals 35%, Team Project (tP) 40%, Participation 10%.</p>",
  })
  .returning()
  .get();

const st2334 = db
  .insert(modules)
  .values({
    userId: user.id,
    canvasCourseId: 51002,
    code: "ST2334",
    name: "Probability and Statistics",
    term: "AY26/27 Sem 1",
    syllabusBody: null,
  })
  .returning()
  .get();

db.insert(components)
  .values([
    // CS2103T — mixed sources; dedup sums to 100 (Midterm 15 + Finals 35 + tP 40 + Participation[manual] 10).
    { moduleId: cs2103t.id, name: "Midterm", weightPct: 15, source: "canvas_api" },
    { moduleId: cs2103t.id, name: "Finals", weightPct: 35, source: "canvas_api" },
    {
      moduleId: cs2103t.id,
      name: "tP",
      weightPct: 40,
      source: "llm_syllabus",
      evidence: "Team Project (tP) 40%, assessed across milestones v1-v4.",
    },
    // Canvas under-reports Participation; the manual row (same name, higher precedence) corrects it.
    { moduleId: cs2103t.id, name: "Participation", weightPct: 5, source: "canvas_api" },
    { moduleId: cs2103t.id, name: "Participation", weightPct: 10, source: "manual" },

    // ST2334 — sums to 75, exercising the "Unaccounted" honesty row.
    { moduleId: st2334.id, name: "Midterm", weightPct: 25, source: "canvas_api" },
    { moduleId: st2334.id, name: "Finals", weightPct: 50, source: "canvas_api" },
  ])
  .run();

// Announcements — old, already-seen.
db.insert(items)
  .values([
    {
      userId: user.id,
      moduleId: cs2103t.id,
      type: "announcement",
      source: "canvas",
      sourceId: "announcement:9001",
      title: "tP Milestone v3 marking criteria posted",
      body: "See Files > tP > v3-rubric.pdf for the updated marking criteria.",
      url: "https://canvas.nus.edu.sg/courses/51001/announcements/9001",
      sender: "Prof Damith Rajapakse",
      dueAt: null,
      sourceCreatedAt: seenFirstSeenAt,
      firstSeenAt: seenFirstSeenAt,
    },
    {
      userId: user.id,
      moduleId: st2334.id,
      type: "announcement",
      source: "canvas",
      sourceId: "announcement:9101",
      title: "Tutorial 7 solutions uploaded",
      body: null,
      url: "https://canvas.nus.edu.sg/courses/51002/announcements/9101",
      sender: "Dr Ye Zhisheng",
      dueAt: null,
      sourceCreatedAt: seenFirstSeenAt,
      firstSeenAt: seenFirstSeenAt,
    },
  ])
  .run();

// Todos — 4 total: one overdue, one already submitted (excluded from the list by
// getOverview), two upcoming (one assignment, one event) across both modules.
db.insert(items)
  .values([
    {
      userId: user.id,
      moduleId: cs2103t.id,
      type: "assignment",
      source: "canvas",
      sourceId: "assignment:11",
      title: "tP Milestone v3",
      body: null,
      url: "https://canvas.nus.edu.sg/courses/51001/assignments/11",
      sender: null,
      dueAt: now - 1 * DAY,
      sourceCreatedAt: seenFirstSeenAt,
      firstSeenAt: seenFirstSeenAt,
      submitted: false,
    },
    {
      userId: user.id,
      moduleId: cs2103t.id,
      type: "assignment",
      source: "canvas",
      sourceId: "assignment:10",
      title: "tP Milestone v2",
      body: null,
      url: "https://canvas.nus.edu.sg/courses/51001/assignments/10",
      sender: null,
      dueAt: now - 10 * DAY,
      sourceCreatedAt: seenFirstSeenAt,
      firstSeenAt: seenFirstSeenAt,
      submitted: true,
    },
    {
      userId: user.id,
      moduleId: st2334.id,
      type: "assignment",
      source: "canvas",
      sourceId: "assignment:21",
      title: "Problem Set 5",
      body: null,
      url: "https://canvas.nus.edu.sg/courses/51002/assignments/21",
      sender: null,
      dueAt: now + 3 * DAY,
      sourceCreatedAt: seenFirstSeenAt,
      firstSeenAt: seenFirstSeenAt,
      submitted: false,
    },
    {
      userId: user.id,
      moduleId: st2334.id,
      type: "event",
      source: "canvas",
      sourceId: "event:31",
      title: "ST2334 Midterm Test",
      body: null,
      url: null,
      sender: null,
      dueAt: now + 10 * DAY,
      sourceCreatedAt: seenFirstSeenAt,
      firstSeenAt: seenFirstSeenAt,
      submitted: false,
    },
  ])
  .run();

// Deadline change — firstSeenAt is after lastSeenAt so it surfaces in "What's new".
db.insert(items)
  .values({
    userId: user.id,
    moduleId: cs2103t.id,
    type: "deadline_change",
    source: "canvas",
    sourceId: `assignment:11:due:${now - 1 * DAY}`,
    title: "tP Milestone v3 — due date moved earlier",
    body: null,
    url: "https://canvas.nus.edu.sg/courses/51001/assignments/11",
    sender: null,
    dueAt: now - 1 * DAY,
    sourceCreatedAt: now - 2 * HOUR,
    firstSeenAt: now - 1 * HOUR,
  })
  .run();

// Emails — one of each triage, each with an importanceReason.
db.insert(items)
  .values([
    {
      userId: user.id,
      moduleId: cs2103t.id,
      type: "email",
      source: "graph",
      sourceId: "email:1001",
      title: "tP Milestone v3 grading criteria released",
      body: "Hi all, the rubric for v3 is now on Canvas under Files > tP.",
      url: null,
      sender: "Prof Damith Rajapakse <damith@comp.nus.edu.sg>",
      dueAt: null,
      sourceCreatedAt: seenFirstSeenAt,
      firstSeenAt: seenFirstSeenAt,
      triage: "important",
      importance: 0.92,
      importanceReason: "From the module coordinator; concerns a graded deliverable due this week.",
    },
    {
      userId: user.id,
      moduleId: cs2103t.id,
      type: "email",
      source: "graph",
      sourceId: "email:1002",
      title: "Change to CS2103T tutorial venue",
      body: "Tutorials for week 9 move to LT19.",
      url: null,
      sender: "CS2103T Class List <cs2103t-list@nus.edu.sg>",
      dueAt: null,
      sourceCreatedAt: seenFirstSeenAt,
      firstSeenAt: seenFirstSeenAt,
      triage: "ambiguous",
      importance: 0.5,
      importanceReason: "Mentions the module and a schedule change, but comes from a broadcast list — could be routine.",
    },
    {
      userId: user.id,
      moduleId: st2334.id,
      type: "email",
      source: "graph",
      sourceId: "email:1003",
      title: "Guest lecture opportunity for stats students",
      body: "An external partner is offering a talk on applied statistics.",
      url: null,
      sender: "outreach@statssociety.org",
      dueAt: null,
      sourceCreatedAt: seenFirstSeenAt,
      firstSeenAt: seenFirstSeenAt,
      triage: "unscored",
      importance: null,
      importanceReason: "Sender domain has not been scored yet — flagged for manual review.",
    },
    {
      userId: user.id,
      moduleId: null,
      type: "email",
      source: "graph",
      sourceId: "email:1004",
      title: "50% off your next order!",
      body: "Limited time offer, shop now.",
      url: null,
      sender: "promotions@shopmart.com",
      dueAt: null,
      sourceCreatedAt: seenFirstSeenAt,
      firstSeenAt: seenFirstSeenAt,
      triage: "garbage",
      importance: 0.02,
      importanceReason: "Commercial promotional email unrelated to any module; matches spam heuristics.",
    },
  ])
  .run();

// Sync runs — canvas fresh, graph stale (last ok run 2 days ago), enrich fresh.
db.insert(syncRuns)
  .values([
    { userId: user.id, source: "canvas", startedAt: now - 2 * MIN, finishedAt: now - 1 * MIN, ok: true },
    { userId: user.id, source: "graph", startedAt: now - 2 * DAY, finishedAt: now - 2 * DAY + MIN, ok: true },
    { userId: user.id, source: "enrich", startedAt: now - 5 * MIN, finishedAt: now - 4 * MIN, ok: true },
  ])
  .run();

// Module context for CS2103T: the profile the model would have written from
// the decks, and a note the student added. Synthetic, like everything here.
setModuleProfile(db, cs2103t.id, [
  "### What the module is about",
  "Building and maintaining a small software product in a team: requirements, design, testing and code quality, with a running project as the spine.",
  "### How the lecturer teaches",
  "Each lecture opens with a scenario from the team project, states the concept, then walks a code example. Definitions come after examples, not before.",
  "### Terminology and notation to keep",
  "UML class and sequence diagrams as drawn in the slides; 'tP' for the team project, 'iP' for the individual one.",
  "### Threads that run across decks",
  "Abstraction and coupling recur from week 2 onwards; every design topic is judged by how it changes testability.",
  "### What is signalled as important or examinable",
  "Slides marked 'exam tip' on sequence diagrams and on the difference between coupling and cohesion.",
].join("\n"), "6 decks, demo-model", now - 6 * DAY);
setModuleNotes(db, user.id, cs2103t.id, "## Assessment and exam format\nClosed book, MCQ plus two short design questions. Past papers lean on UML.\n", now - 4 * DAY);

console.log("seeded data/demo.db");
