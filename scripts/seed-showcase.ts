// run: npx tsx scripts/seed-showcase.ts
//
// A fuller, entirely fictional semester for screenshots and for trying the
// app without a Canvas account: four modules, tasks broken into steps, a
// weekly plan, announcements, a lecturer's forum reply and a study guide.
//   DATABASE_PATH=data/showcase.db SECRET_KEY=$(openssl rand -hex 32) APP_PASSWORD=showcase1 npm run dev
// then sign in as  demo / openpapr-demo.  Re-running starts from scratch.
import { existsSync, rmSync } from "node:fs";
import { createDb } from "../src/db/client";
import { components, files, items, moduleProfiles, modules, studyGuides, syncRuns, taskPlans, tasks, users, weeklyPlans } from "../src/db/schema";
import { weekStartSgt } from "../src/db/profiles-repo";
import { hashPassword } from "../src/server/password";

const DB_PATH = process.env.SHOWCASE_DB ?? "data/showcase.db";
for (const s of ["", "-wal", "-shm"]) if (existsSync(DB_PATH + s)) rmSync(DB_PATH + s);
const db = createDb(DB_PATH);

const now = Date.now();
const H = 3_600_000;
const D = 24 * H;
const day = (n: number) => new Date(now + 8 * H + n * D).toISOString().slice(0, 10);
// "n days from now at hh:mm Singapore time"
const at = (n: number, hh = 23, mm = 59) => Date.parse(`${day(n)}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+08:00`);

const user = db.insert(users).values({ name: "Alex Tan", lastSeenAt: now - D, major: "Computer Science", studyYear: 2, username: "demo", passwordHash: hashPassword("openpapr-demo") }).returning().get();
const u = user.id;

const mod = (canvasCourseId: number, code: string, name: string, position: number) =>
  db.insert(modules).values({ userId: u, canvasCourseId, code, name, term: "AY26/27 Sem 1", position }).returning().get();
const se = mod(1, "CS2103T", "Software Engineering", 0);
const algo = mod(2, "CS3230", "Design and Analysis of Algorithms", 1);
const net = mod(3, "CS2105", "Introduction to Computer Networks", 2);
const stats = mod(4, "ST2334", "Probability and Statistics", 3);

db.insert(components).values([
  { moduleId: se.id, name: "Team project", weightPct: 45, source: "canvas_api" },
  { moduleId: se.id, name: "Final exam", weightPct: 30, source: "canvas_api" },
  { moduleId: se.id, name: "Quizzes", weightPct: 15, source: "canvas_api" },
  { moduleId: se.id, name: "Participation", weightPct: 10, source: "canvas_api" },
  { moduleId: algo.id, name: "Final exam", weightPct: 50, source: "llm_syllabus", evidence: "Final examination 50%" },
  { moduleId: algo.id, name: "Midterm", weightPct: 20, source: "llm_syllabus", evidence: "Midterm test 20%" },
  { moduleId: algo.id, name: "Problem sets", weightPct: 30, source: "llm_syllabus", evidence: "Five problem sets, 6% each" },
  { moduleId: net.id, name: "Final exam", weightPct: 40, source: "canvas_api" },
  { moduleId: net.id, name: "Programming assignments", weightPct: 35, source: "canvas_api" },
  { moduleId: net.id, name: "Midterm", weightPct: 25, source: "canvas_api" },
  { moduleId: stats.id, name: "Final exam", weightPct: 50, source: "canvas_api" },
  { moduleId: stats.id, name: "Midterm", weightPct: 30, source: "canvas_api" },
  { moduleId: stats.id, name: "Tutorial quizzes", weightPct: 20, source: "canvas_api" },
]).run();

const canvas = (path: string) => `https://canvas.example.edu/courses/${path}`;
const it = (v: Partial<typeof items.$inferInsert> & { moduleId: number | null; type: typeof items.$inferInsert.type; sourceId: string; title: string }) =>
  db.insert(items).values({ userId: u, source: "canvas", firstSeenAt: now - 4 * D, sourceCreatedAt: now - 4 * D, ...v }).returning().get();

const ps3 = it({ moduleId: algo.id, type: "assignment", sourceId: "assignment:301", title: "Problem Set 3", dueAt: at(2, 23, 59), url: canvas("2/assignments/301") });
const pa2 = it({ moduleId: net.id, type: "assignment", sourceId: "assignment:401", title: "Programming Assignment 2: Reliable transfer", dueAt: at(6, 23, 59), url: canvas("3/assignments/401") });
const q5 = it({ moduleId: se.id, type: "assignment", sourceId: "assignment:205", title: "Week 7 quiz", dueAt: at(1, 12, 0), url: canvas("1/quizzes/205"), metaJson: JSON.stringify({ quiz: true }) });
it({ moduleId: stats.id, type: "assignment", sourceId: "assignment:501", title: "Tutorial 6 quiz", dueAt: at(4, 9, 0), url: canvas("4/quizzes/501"), metaJson: JSON.stringify({ quiz: true }) });
it({ moduleId: se.id, type: "assignment", sourceId: "assignment:210", title: "Project milestone v1.2", dueAt: at(9, 23, 59), url: canvas("1/assignments/210") });
it({ moduleId: algo.id, type: "announcement", sourceId: "announcement:31", title: "Midterm covers Lectures 1–6", body: "<p>The midterm on Friday of Week 8 covers Lectures 1 to 6, including the master theorem and amortised analysis. One A4 cheat sheet allowed.</p>", sender: "Dr Lim", sourceCreatedAt: now - 2 * D, firstSeenAt: now - 2 * D });
it({ moduleId: net.id, type: "announcement", sourceId: "announcement:41", title: "PA2 skeleton code updated", body: "<p>We fixed a bug in the checksum helper. Please pull the latest skeleton before you submit.</p>", sender: "Prof Wong", sourceCreatedAt: now - 6 * H, firstSeenAt: now - 6 * H });
it({ moduleId: se.id, type: "staff_reply", sourceId: "reply:77", title: "Re: Can we use Gradle 9?", body: "<p>Yes, Gradle 9 is fine. Keep the CI workflow passing on Java 17.</p>", sender: "Teaching team", sourceCreatedAt: now - D, firstSeenAt: now - D });

const step = (id: string, text: string, minutes: number, n: number, done = false) => ({ id, text, minutes, doBy: day(n), done });
const task = (v: Partial<typeof tasks.$inferInsert> & { key: string; title: string; kind: typeof tasks.$inferInsert.kind; moduleId: number }, steps: ReturnType<typeof step>[], status: "open" | "done" = "open") =>
  db.insert(tasks).values({ userId: u, stepsJson: JSON.stringify(steps), status, createdAt: now - 3 * D, updatedAt: now - (status === "done" ? D : 0), ...v }).run();

task({ moduleId: algo.id, key: "cs3230-ps3", title: "Problem Set 3", kind: "submission", dueAt: ps3.dueAt, weightPct: 6, why: "Divide and conquer; 6% of the grade",
  sourcesJson: JSON.stringify([{ kind: "canvas", label: "Problem Set 3", itemId: ps3.id }]) },
  [step("a", "Read Lecture 4 on the master theorem", 40, -1, true), step("b", "Solve Q1–Q2 recurrences", 60, 0), step("c", "Write up Q3 proof of correctness", 50, 1), step("d", "Typeset and submit", 20, 1)]);
task({ moduleId: se.id, key: "cs2103t-week-7-quiz", title: "Week 7 quiz", kind: "quiz", dueAt: q5.dueAt, weightPct: 1.5, why: "Covers design principles: SOLID and coupling",
  sourcesJson: JSON.stringify([{ kind: "canvas", label: "Week 7 quiz", itemId: q5.id }]) },
  [step("a", "Skim the SOLID notes in the study guide", 25, 0)]);
task({ moduleId: net.id, key: "cs2105-pa2", title: "Programming Assignment 2", kind: "submission", dueAt: pa2.dueAt, weightPct: 15, why: "Go-Back-N over UDP; skeleton was updated",
  sourcesJson: JSON.stringify([{ kind: "canvas", label: pa2.title, itemId: pa2.id }, { kind: "announcement", label: "PA2 skeleton code updated" }]) },
  [step("a", "Pull the updated skeleton", 10, 0), step("b", "Implement the sender window", 90, 2), step("c", "Handle timeouts and retransmission", 90, 3), step("d", "Test against the lossy channel script", 60, 5)]);
task({ moduleId: algo.id, key: "cs3230-midterm", title: "Midterm", kind: "exam", dueAt: at(9, 10, 0), weightPct: 20, why: "Lectures 1–6, one A4 cheat sheet",
  sourcesJson: JSON.stringify([{ kind: "announcement", label: "Midterm covers Lectures 1–6" }, { kind: "weightage", label: "Assessment weightage" }]) },
  [step("a", "Make the cheat sheet: recurrences and bounds", 60, 4), step("b", "Past paper 2024, timed", 90, 6), step("c", "Review mistakes on amortised analysis", 45, 7)]);
task({ moduleId: stats.id, key: "st2334-series-quiz-7", title: "Tutorial 7 quiz (expected)", kind: "quiz", dueAt: at(11, 9, 0), dueConfidence: "estimated", anticipated: true, why: "6 quizzes so far, one a week",
  sourcesJson: JSON.stringify([{ kind: "canvas", label: "Tutorial 6 quiz — the last one" }]) }, []);
task({ moduleId: se.id, key: "cs2103t-v1-1", title: "Project milestone v1.1", kind: "project", dueAt: now - 2 * D, sourcesJson: "[]" }, [step("a", "Merge feature branches", 40, -3, true)], "done");
task({ moduleId: stats.id, key: "st2334-t5", title: "Tutorial 5 quiz", kind: "quiz", dueAt: now - 3 * D, sourcesJson: "[]" }, [step("a", "Revise conditional probability", 30, -4, true)], "done");

db.insert(weeklyPlans).values({
  userId: u, weekStart: weekStartSgt(now), generatedAt: now - 20 * 60_000,
  planJson: JSON.stringify({
    overview: "A heavy week for CS3230: Problem Set 3 is due in two days and the midterm follows a week later, so start the cheat sheet early. CS2105's assignment needs steady progress from Saturday.",
    priorities: [
      { module: "CS3230", focus: "Finish Problem Set 3", why: "Due in two days, 6% of the grade" },
      { module: "CS2105", focus: "Start the PA2 sender window", why: "The longest piece of work this week" },
      { module: "CS2103T", focus: "Week 7 quiz on SOLID", why: "Quick win, due tomorrow noon" },
      { module: "ST2334", focus: "Conditional probability drills", why: "Weekly quiz on Monday" },
    ],
    days: [],
  }),
}).run();

db.insert(studyGuides).values({
  moduleId: algo.id, generatedAt: now - 5 * H, sourceNote: "6 decks, 214 slides",
  markdown: `# CS3230 — Study guide

How to analyse an algorithm's running time, and three ways to design one that is fast.

## 1. Asymptotic analysis

Big-O, Ω and Θ describe how running time grows, ignoring constant factors. [L1 p12](slide:L1-asymptotics#12)

### The three bounds

| Notation | Means | Example |
| --- | --- | --- |
| O(g) | grows no faster than g | 3n² + n is O(n²) |
| Ω(g) | grows at least as fast as g | n log n is Ω(n) |
| Θ(g) | both at once | 5n + 2 is Θ(n) |

> **Exam tip.** Θ is a claim about *both* bounds. Proving only the upper bound gives you O, not Θ.

### Comparing growth rates

Take the limit of f(n)/g(n). If it is 0, f is o(g); a positive constant means Θ; infinity means ω. [L1 p20](slide:L1-asymptotics#20)

## 2. Divide and conquer

Split the problem, solve the parts recursively, combine the answers. [L3 p4](slide:L3-divide-conquer#4)

### Merge sort as a recurrence

\`\`\`mermaid
flowchart TD
  A["sort(A[1..n])"] --> B["sort left half"]
  A --> C["sort right half"]
  B --> D["merge: Θ(n)"]
  C --> D
\`\`\`

The running time satisfies T(n) = 2T(n/2) + Θ(n), which solves to Θ(n log n). [L3 p11](slide:L3-divide-conquer#11)

### The master theorem

For T(n) = aT(n/b) + f(n), compare f(n) with n^(log_b a):

- **Case 1:** f is polynomially smaller, so T(n) = Θ(n^(log_b a)).
- **Case 2:** they match, so T(n) = Θ(n^(log_b a) · log n).
- **Case 3:** f is polynomially larger (and regular), so T(n) = Θ(f(n)). [L4 p7](slide:L4-master#7)

## 3. Amortised analysis

The average cost per operation over a worst-case sequence, even when single operations are expensive. [L6 p3](slide:L6-amortised#3)

### The accounting method

Charge each cheap operation a little extra and store it as credit; expensive operations spend the credit. A dynamic array that doubles costs O(1) amortised per append. [L6 p15](slide:L6-amortised#15)
`,
}).run();

for (const m of [se, algo, net, stats]) db.insert(taskPlans).values({ moduleId: m.id, inputsHash: "showcase", generatedAt: now - 20 * 60_000 }).run();

// A module profile and a shelf of files for CS3230, so its page is full.
db.insert(moduleProfiles).values({
  moduleId: algo.id, generatedAt: now - D,
  lecturersJson: JSON.stringify([{ name: "Dr Lim Wei" }, { name: "Prof Sarah Ong" }]),
  profileJson: JSON.stringify({
    oneLine: "How to prove an algorithm correct and fast: asymptotics, divide and conquer, dynamic programming, greedy methods and amortised analysis.",
    covers: ["Asymptotic analysis", "Divide and conquer", "Dynamic programming", "Greedy algorithms", "Amortised analysis", "NP-completeness"],
    assessment: "Problem sets 30%, midterm 20%, final 50%",
    lecturers: [{ name: "Dr Lim Wei", background: "Works on approximation algorithms.", emphasis: ["rigorous proofs", "recurrences"] }, { name: "Prof Sarah Ong", background: null, emphasis: ["dynamic programming"] }],
    studentsSay: { workload: "Heavy in problem-set weeks", difficulty: "Hard but fair", tips: ["Start problem sets the day they are released", "Practise writing proofs, not just answers"], pitfalls: ["Leaving the master theorem to the week before the midterm"] },
    fit: { buildsOn: ["CS2040S data structures", "MA1100 proofs"], gaps: ["Induction proofs", "Summations"], relevance: "Core for the algorithms focus area and most technical interviews." },
    howToStudy: ["Redo tutorial questions without notes", "Keep a one-page sheet of recurrences and their solutions", "Explain each proof out loud before writing it"],
  }),
}).run();
const f = (canvasFileId: number, displayName: string, category: typeof files.$inferInsert.category, ago: number) =>
  ({ moduleId: algo.id, canvasFileId, displayName, category, categorySource: "rule" as const, discoveredAt: now - ago * D });
db.insert(files).values([
  f(901, "L1-asymptotics.pdf", "slides", 40), f(902, "L2-recurrences.pdf", "slides", 33), f(903, "L3-divide-conquer.pdf", "slides", 26),
  f(904, "L4-master.pdf", "slides", 19), f(905, "L5-dynamic-programming.pdf", "slides", 12), f(906, "L6-amortised.pdf", "slides", 5),
  f(911, "Tutorial 3.pdf", "tutorial", 20), f(912, "Tutorial 4.pdf", "tutorial", 13), f(921, "Problem Set 3.pdf", "assignment", 6),
  f(931, "CLRS chapter 4.pdf", "reading", 28), f(941, "Course admin.pdf", "admin", 45),
]).run();

db.insert(syncRuns).values([
  { userId: u, source: "canvas", startedAt: now - 60_000, finishedAt: now - 5_000, ok: true },
  { userId: u, source: "enrich", startedAt: now - 10 * 60_000, finishedAt: now - 9 * 60_000, ok: true },
]).run();

console.log(`seeded ${DB_PATH} — sign in as demo / openpapr-demo`);
