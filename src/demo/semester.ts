import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { components, courseHistory, files, guideQuizzes, items, moduleProfiles, modules, studyGuides, syncRuns, taskChanges, taskPlans, tasks, users, weeklyPlans } from "../db/schema";
import { weekStartSgt } from "../db/profiles-repo";
import { dailyCap } from "../enrich/tasks";
import { semesterView } from "../lib/acad-week";
import { citedPagesByDeck } from "../lib/slide-citation";
import { splitGuideIntoChapters } from "../lib/study-chapters";
import { chapterHash } from "../server/guide-quiz";
import { DEMO_DECK_SOURCES, deckPages } from "./decks";
import { DEMO_GUIDES } from "./guides";
import { DEMO_HISTORY, DEMO_MODULE_PROFILES, DEMO_USER_PROFILE } from "./profiles";

// A fictional semester: four modules, tasks broken into steps, a weekly plan,
// announcements, a lecturer's forum reply, a study guide with practice
// questions for every module, module profiles, eight slide decks (shipped in
// ./decks) and two changes waiting in the bell. Used by the public demo
// account, which is re-seeded every night, and by scripts/seed-showcase.ts.
//
// Every date is relative to `now`, so the semester always looks current, and
// every word that names a date is worked out from that date: a "Week 7 quiz"
// is due in Week 7, a midterm "on Friday 30 Oct" is on a Friday. Nothing open
// falls due before the next midnight, when the demo is reset again. Nothing
// links to Canvas: the courses are made up.
//
// `courseBase` keeps the made-up Canvas course ids clear of real ones, since
// cached decks are filed by course id.
export { DEMO_DECKS } from "./decks";

const H = 3_600_000;
const D = 24 * H;
const SGT = 8 * H;
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const sgt = (t: number) => new Date(t + SGT);
// "Friday 30 Oct" and "Fri 30 Oct", in Singapore time.
export const longDate = (t: number) => `${DAY_NAMES[sgt(t).getUTCDay()]} ${sgt(t).getUTCDate()} ${MONTHS[sgt(t).getUTCMonth()]}`;
export const shortDay = (t: number) => `${DAY_NAMES[sgt(t).getUTCDay()]!.slice(0, 3)} ${sgt(t).getUTCDate()} ${MONTHS[sgt(t).getUTCMonth()]}`;
// What the academic calendar calls the week a moment falls in: "Week 11",
// "recess week", "exam week 1"; null between semesters.
export function weekName(t: number): string | null {
  const v = semesterView(t);
  if (v.phase === "vacation") return null;
  return v.phase === "teaching" ? v.title : v.title.toLowerCase();
}
const teachingWeek = (t: number) => { const v = semesterView(t); return v.phase === "teaching" ? v.week : null; };
// " (Week 11)" after a date, or nothing between semesters.
const inWeek = (t: number) => { const w = weekName(t); return w ? ` (${w})` : ""; };

export function seedSemester(db: Db, u: number, now: number, courseBase = 0): { moduleIds: number[] } {
  // Midnight (Singapore) starting the day `n` days from now, and that day.
  const dayStart = (n: number) => Math.floor((now + SGT) / D) * D - SGT + n * D;
  const day = (n: number) => sgt(dayStart(n)).toISOString().slice(0, 10);
  // "n days from now at hh:mm Singapore time"
  const at = (n: number, hh = 23, mm = 59) => dayStart(n) + hh * H + mm * 60_000;
  // The first day at least `from` days ahead that falls on one of `weekdays` (0 = Sunday).
  const nextOn = (from: number, weekdays: number[]) => { let n = from; while (!weekdays.includes(sgt(dayStart(n)).getUTCDay())) n++; return n; };
  const WEEKDAYS = [1, 2, 3, 4, 5];

  const mod = (canvasCourseId: number, code: string, name: string, position: number) =>
    db.insert(modules).values({ userId: u, canvasCourseId: courseBase + canvasCourseId, code, name, term: "AY26/27 Sem 1", position, seenAt: now - D }).returning().get();
  const se = mod(1, "CS2103T", "Software Engineering", 0);
  const algo = mod(2, "CS3230", "Design and Analysis of Algorithms", 1);
  const net = mod(3, "CS2105", "Introduction to Computer Networks", 2);
  const stats = mod(4, "ST2334", "Probability and Statistics", 3);
  const byCode = new Map([se, algo, net, stats].map((m) => [m.code, m]));

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

  // --- when things happen -----------------------------------------------------
  // Weekly quizzes fall on weekdays; the CS3230 midterm is a Friday 7 to 13
  // days out, and the CS2105 midterm a Wednesday evening, which an
  // announcement has just pushed back a week. Near the end of term they are
  // the finals instead.
  const ps3Due = at(2);
  const pa2Due = at(6);
  const quizDue = at(nextOn(1, WEEKDAYS), 12, 0);
  const tutDue = at(nextOn(2, WEEKDAYS), 9, 0);
  const v12Due = at(9);
  const midDay = nextOn(7, [5]);
  const midAt = at(midDay, 10, 0);
  const netMidDay = nextOn(5, [3]);
  const netMidSet = at(netMidDay, 18, 30);
  const netMidNew = at(netMidDay + 7, 18, 30);
  const reviewDay = nextOn(3, [0]);
  const reviewDue = at(reviewDay);

  // A weekly quiz is named for its week, and the week before's is done. Out
  // of term there is no week to name it by.
  const quizWeek = teachingWeek(quizDue);
  const quizTitle = quizWeek ? `Week ${quizWeek} quiz` : "Practice quiz";
  const lastQuizDue = quizDue - 7 * D;
  const lastQuizWeek = teachingWeek(lastQuizDue);
  // ST2334's tutorials start in Week 2, so Tutorial n is in Week n + 1.
  const tutNo = (t: number) => { const w = teachingWeek(t); return w && w >= 2 ? w - 1 : null; };
  const tutTitle = tutNo(tutDue) ? `Tutorial ${tutNo(tutDue)} quiz` : "Tutorial quiz";
  const lastTutDue = tutDue - 7 * D;
  const lastTutNo = tutNo(lastTutDue);
  // A test in reading or exam week is the final, not a midterm.
  const isFinal = (t: number) => ["reading", "exams"].includes(semesterView(t).phase);
  const algoExam = isFinal(midAt)
    ? { title: "Final exam", covers: "every lecture", weight: 50 }
    : { title: "Midterm", covers: "Lectures 1 to 6", weight: 20 };
  const netExam = isFinal(netMidSet) || isFinal(netMidNew)
    ? { title: "Final exam", covers: "every lecture", weight: 40 }
    : { title: "Midterm", covers: "Lectures 1 to 5", weight: 25 };

  // --- what the courses posted ------------------------------------------------
  const it = (v: Partial<typeof items.$inferInsert> & { moduleId: number | null; type: typeof items.$inferInsert.type; sourceId: string; title: string }) =>
    db.insert(items).values({ userId: u, source: "canvas", url: null, firstSeenAt: now - 4 * D, sourceCreatedAt: now - 4 * D, ...v }).returning().get();
  const quiz = JSON.stringify({ quiz: true });

  const ps3 = it({ moduleId: algo.id, type: "assignment", sourceId: "assignment:301", title: "Problem Set 3", dueAt: ps3Due });
  const pa2 = it({ moduleId: net.id, type: "assignment", sourceId: "assignment:401", title: "Programming Assignment 2: Reliable transfer", dueAt: pa2Due });
  const q = it({ moduleId: se.id, type: "assignment", sourceId: "assignment:205", title: quizTitle, dueAt: quizDue, metaJson: quiz });
  const lastQ = lastQuizWeek ? it({ moduleId: se.id, type: "assignment", sourceId: "assignment:204", title: `Week ${lastQuizWeek} quiz`, dueAt: lastQuizDue, metaJson: quiz, submitted: true, firstSeenAt: now - 11 * D, sourceCreatedAt: now - 11 * D }) : null;
  const tq = it({ moduleId: stats.id, type: "assignment", sourceId: "assignment:501", title: tutTitle, dueAt: tutDue, metaJson: quiz });
  const lastTq = lastTutNo ? it({ moduleId: stats.id, type: "assignment", sourceId: "assignment:500", title: `Tutorial ${lastTutNo} quiz`, dueAt: lastTutDue, metaJson: quiz, submitted: true, firstSeenAt: now - 11 * D, sourceCreatedAt: now - 11 * D }) : null;
  const v12 = it({ moduleId: se.id, type: "assignment", sourceId: "assignment:210", title: "Project milestone v1.2", dueAt: v12Due });
  const v11 = it({ moduleId: se.id, type: "assignment", sourceId: "assignment:209", title: "Project milestone v1.1", dueAt: at(-2), submitted: true, firstSeenAt: now - 16 * D, sourceCreatedAt: now - 16 * D });

  const midAnn = it({ moduleId: algo.id, type: "announcement", sourceId: "announcement:31", title: `${algoExam.title} covers ${algoExam.covers}`, sender: "Dr Lim", sourceCreatedAt: now - 2 * D, firstSeenAt: now - 2 * D,
    body: `<p>The ${algoExam.title.toLowerCase()} is on ${longDate(midAt)}${inWeek(midAt)} at 10am. It covers ${algoExam.covers}, including the master theorem and amortised analysis. One A4 cheat sheet allowed.</p>` });
  it({ moduleId: net.id, type: "announcement", sourceId: "announcement:41", title: "PA2 skeleton code updated", body: "<p>We fixed a bug in the checksum helper. Please pull the latest skeleton before you submit.</p>", sender: "Prof Wong", sourceCreatedAt: now - 6 * H, firstSeenAt: now - 6 * H });
  const venueAnn = it({ moduleId: net.id, type: "announcement", sourceId: "announcement:40", title: `${netExam.title} format`, sender: "Prof Wong", sourceCreatedAt: now - 20 * D, firstSeenAt: now - 20 * D,
    body: `<p>The ${netExam.title.toLowerCase()} is a one-hour written test in the evening, on ${netExam.covers}. We will confirm the date once the venue is booked.</p>` });
  const netMidQuote = `The ${netExam.title.toLowerCase()} will be on ${longDate(netMidNew)}${inWeek(netMidNew)}, 6.30pm to 7.30pm, in the MPSH.`;
  const netMidAnn = it({ moduleId: net.id, type: "announcement", sourceId: "announcement:42", title: `${netExam.title} date confirmed`, sender: "Prof Wong", sourceCreatedAt: now - 8 * H, firstSeenAt: now - 8 * H,
    body: `<p>${netMidQuote} Bring your student card. It covers ${netExam.covers}.</p>` });
  const reviewQuote = `Leave at least three comments by ${longDate(reviewDue)}${inWeek(reviewDue)}, 23:59.`;
  const reviewAnn = it({ moduleId: se.id, type: "announcement", sourceId: "announcement:21", title: "Peer review for v1.2", sender: "Dr Nair", sourceCreatedAt: now - 3 * H, firstSeenAt: now - 3 * H,
    body: `<p>Each team reviews another team's v1.2 pull requests on GitHub. ${reviewQuote} Your tutor will tell you which team you have.</p>` });
  it({ moduleId: se.id, type: "discussion", sourceId: "discussion:77", title: "Can we use Gradle 9?", sourceCreatedAt: now - 2 * D, firstSeenAt: now - 2 * D,
    body: "<p>Our team wants to upgrade the build. Is Gradle 9 allowed for the project?</p>",
    metaJson: JSON.stringify({ replies: 3, unread: 0, lastReplyAt: now - D, requireInitialPost: false, graded: false, assignmentId: null, posted: false, locked: false, staffReplies: 1, seenThread: true }) });
  it({ moduleId: se.id, type: "staff_reply", sourceId: "reply:77", title: "Re: Can we use Gradle 9?", body: "<p>Yes, Gradle 9 is fine. Keep the CI workflow passing on Java 17.</p>", sender: "Teaching team", sourceCreatedAt: now - D, firstSeenAt: now - D,
    metaJson: JSON.stringify({ topicSourceId: "discussion:77", topicTitle: "Can we use Gradle 9?" }) });

  // --- tasks --------------------------------------------------------------------
  // A step to do by day n, or the latest day before it with room: no day
  // goes over what the planner thinks doable, so it has nothing to move.
  const load = new Map<number, number>();
  const step = (id: string, text: string, minutes: number, n: number, done = false) => {
    if (!done) {
      let d = n;
      while (d > 0 && (load.get(d) ?? 0) + minutes > dailyCap(day(d))) d--;
      load.set(d, (load.get(d) ?? 0) + minutes);
      n = d;
    }
    return { id, text, minutes, doBy: day(n), done };
  };
  const task = (v: Partial<typeof tasks.$inferInsert> & { key: string; title: string; kind: typeof tasks.$inferInsert.kind; moduleId: number }, steps: ReturnType<typeof step>[], status: "open" | "done" = "open") =>
    db.insert(tasks).values({ userId: u, stepsJson: JSON.stringify(steps), status, createdAt: now - 3 * D, updatedAt: now - (status === "done" ? D : 0), ...v }).returning().get();
  const canvasSrc = (row: { id: number; title: string }) => ({ kind: "canvas", label: row.title, itemId: row.id });
  const keyOf = (code: string, title: string) => `${code.toLowerCase()}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-$/, "")}`;

  task({ moduleId: algo.id, key: "cs3230-ps3", title: "Problem Set 3", kind: "submission", dueAt: ps3Due, weightPct: 6, why: "Divide and conquer; 6% of the grade",
    sourcesJson: JSON.stringify([canvasSrc(ps3)]) },
    [step("a", "Read Lecture 4 on the master theorem", 40, -1, true), step("b", "Solve Q1–Q2 recurrences", 60, 0), step("c", "Write up Q3 proof of correctness", 50, 1), step("d", "Typeset and submit", 20, 2)]);
  task({ moduleId: se.id, key: keyOf("CS2103T", quizTitle), title: quizTitle, kind: "quiz", dueAt: quizDue, weightPct: 1.5, why: "Covers design principles: SOLID and coupling",
    sourcesJson: JSON.stringify([canvasSrc(q)]) },
    [step("a", "Skim the SOLID notes in the study guide", 25, 0)]);
  task({ moduleId: net.id, key: "cs2105-pa2", title: "Programming Assignment 2", kind: "submission", dueAt: pa2Due, weightPct: 15, why: "Go-Back-N over UDP; skeleton was updated",
    sourcesJson: JSON.stringify([canvasSrc(pa2), { kind: "announcement", label: "PA2 skeleton code updated" }]) },
    [step("a", "Pull the updated skeleton", 10, 0), step("b", "Implement the sender window", 90, 2), step("c", "Handle timeouts and retransmission", 90, 3), step("d", "Test against the lossy channel script", 60, 5)]);
  task({ moduleId: algo.id, key: keyOf("CS3230", algoExam.title), title: algoExam.title, kind: "exam", dueAt: midAt, weightPct: algoExam.weight, why: `Covers ${algoExam.covers}; one A4 cheat sheet`,
    sourcesJson: JSON.stringify([{ kind: "announcement", label: midAnn.title, itemId: midAnn.id }, { kind: "weightage", label: "Assessment weightage" }]) },
    [step("a", "Make the cheat sheet: recurrences and bounds", 60, midDay - 5), step("b", "Past paper, timed", 90, midDay - 3), step("c", "Review mistakes on amortised analysis", 45, midDay - 1)]);
  task({ moduleId: stats.id, key: keyOf("ST2334", tutTitle), title: tutTitle, kind: "quiz", dueAt: tutDue, why: "Conditional probability and Bayes' theorem",
    sourcesJson: JSON.stringify([canvasSrc(tq)]) },
    [step("a", "Do the tutorial questions on Bayes' theorem", 40, nextOn(2, WEEKDAYS) - 1)]);
  task({ moduleId: se.id, key: "cs2103t-v1-2", title: "Project milestone v1.2", kind: "project", dueAt: v12Due, weightPct: 5, why: "Your feature merged, with tests",
    sourcesJson: JSON.stringify([canvasSrc(v12)]) },
    [step("a", "Write tests for your feature", 60, 4), step("b", "Open the pull request", 30, 6), step("c", "Fix review comments and merge", 45, 8)]);
  // The student typed in this date themselves; the bell now asks about the
  // announced one (see below).
  const netMid = task({ moduleId: net.id, key: keyOf("CS2105", netExam.title), title: netExam.title, kind: "exam", dueAt: netMidSet, dueLocked: true, dueLockedAt: now - 6 * D, touchedAt: now - 6 * D, weightPct: netExam.weight, why: `Covers ${netExam.covers}; ${netExam.weight}% of the grade`,
    sourcesJson: JSON.stringify([{ kind: "announcement", label: venueAnn.title, itemId: venueAnn.id }, { kind: "weightage", label: "Assessment weightage" }]) },
    [step("a", "Trace Go-Back-N and Selective Repeat by hand", 45, netMidDay - 1)]);
  // Found in this afternoon's announcement: in the bell as new work.
  const review = task({ moduleId: se.id, key: "cs2103t-v1-2-peer-review", title: "Peer review of v1.2 pull requests", kind: "submission", dueAt: reviewDue, why: "At least three comments on another team's pull requests",
    createdAt: now - 3 * H, sourcesJson: JSON.stringify([{ kind: "announcement", label: reviewAnn.title, itemId: reviewAnn.id, quote: reviewQuote }]) },
    [step("a", "Review the other team's pull requests", 30, reviewDay - 1)]);

  // Done in the last few days.
  if (lastQ) task({ moduleId: se.id, key: keyOf("CS2103T", lastQ.title), title: lastQ.title, kind: "quiz", dueAt: lastQ.dueAt, sourcesJson: JSON.stringify([canvasSrc(lastQ)]) }, [step("a", "Review the lecture on testing", 20, -8, true)], "done");
  task({ moduleId: se.id, key: "cs2103t-v1-1", title: "Project milestone v1.1", kind: "project", dueAt: v11.dueAt, sourcesJson: JSON.stringify([canvasSrc(v11)]) }, [step("a", "Merge feature branches", 40, -3, true)], "done");
  if (lastTq) task({ moduleId: stats.id, key: keyOf("ST2334", lastTq.title), title: lastTq.title, kind: "quiz", dueAt: lastTq.dueAt, sourcesJson: JSON.stringify([canvasSrc(lastTq)]) }, [step("a", "Revise counting and probability rules", 30, -8, true)], "done");

  // --- the bell ---------------------------------------------------------------------
  db.insert(taskChanges).values([
    { userId: u, moduleId: net.id, taskId: netMid.id, kind: "date_proposed", title: netMid.title, oldDueAt: netMidSet, newDueAt: netMidNew, newConfidence: "exact",
      sourceItemId: netMidAnn.id, sourceLabel: netMidAnn.title, quote: netMidQuote, createdAt: now - 8 * H },
    { userId: u, moduleId: se.id, taskId: review.id, kind: "task_added", title: review.title, newDueAt: reviewDue, newConfidence: "exact",
      sourceItemId: reviewAnn.id, sourceLabel: reviewAnn.title, quote: reviewQuote, createdAt: now - 3 * H },
  ]).run();

  // --- the week's plan ------------------------------------------------------------
  db.insert(weeklyPlans).values({
    userId: u, weekStart: weekStartSgt(now), generatedAt: now - 20 * 60_000,
    planJson: JSON.stringify({
      overview: `Problem Set 3 is due ${shortDay(ps3Due)} and the CS3230 ${algoExam.title.toLowerCase()} is on ${shortDay(midAt)}, so start the cheat sheet early. Keep CS2105's assignment moving: it is due ${shortDay(pa2Due)}.`,
      priorities: [
        { module: "CS3230", focus: "Finish Problem Set 3", why: `Due ${shortDay(ps3Due)}, 6% of the grade` },
        { module: "CS2105", focus: "Start the PA2 sender window", why: `Due ${shortDay(pa2Due)}; the longest piece of work on your list` },
        { module: "CS2103T", focus: `${quizTitle} on SOLID`, why: `Quick win, due ${shortDay(quizDue)} at noon` },
        { module: "ST2334", focus: "Conditional probability drills", why: `${tutTitle} on ${shortDay(tutDue)}` },
      ],
      days: [],
    }),
  }).run();

  // --- material: decks, guides, practice questions, profiles ----------------------
  // When each deck went up, in days before today.
  const postedAgo: Record<string, number> = {
    "L1-asymptotics": 40, "L3-divide-conquer": 26, "Tutorial 3": 20, "L4-master": 19, "L6-amortised": 5,
    "L6-design-principles": 6, "L4-reliable-transfer": 9, "L3-conditional-probability": 12,
  };
  db.insert(files).values(DEMO_DECK_SOURCES.map((d, i) => ({
    moduleId: byCode.get(d.module)!.id, canvasFileId: 901 + i, displayName: `${d.stem}.pdf`, category: d.category, categorySource: "rule" as const,
    discoveredAt: now - (postedAgo[d.stem] ?? 7) * D,
  }))).run();

  for (const g of DEMO_GUIDES) {
    const m = byCode.get(g.module)!;
    // "4 decks, 49 slides": the decks this guide cites, counted from the decks themselves.
    const stems = Object.keys(citedPagesByDeck(g.markdown));
    const cited = DEMO_DECK_SOURCES.filter((d) => stems.includes(d.stem));
    const slides = cited.reduce((n, d) => n + deckPages(d), 0);
    db.insert(studyGuides).values({ moduleId: m.id, generatedAt: now - 5 * H, markdown: g.markdown, sourceNote: `${cited.length} deck${cited.length === 1 ? "" : "s"}, ${slides} slides` }).run();
    // Practice questions, keyed the way the quiz route looks them up, so
    // "Quiz me" answers from here instead of asking a model.
    const chapters = splitGuideIntoChapters(g.markdown).chapters;
    db.insert(guideQuizzes).values(chapters.map((c, i) => ({ moduleId: m.id, chapterHash: chapterHash(c.markdown), questionsJson: JSON.stringify(g.quizzes[i] ?? []), createdAt: now - 5 * H }))).run();
  }

  for (const m of [se, algo, net, stats]) {
    const p = DEMO_MODULE_PROFILES[m.code]!;
    db.insert(moduleProfiles).values({
      moduleId: m.id, generatedAt: now - D, lecturersAt: now - D,
      lecturersJson: JSON.stringify(p.lecturers.map((name) => ({ name }))), profileJson: JSON.stringify(p.profile),
    }).run();
    db.insert(taskPlans).values({ moduleId: m.id, inputsHash: "demo", generatedAt: now - 20 * 60_000 }).run();
  }

  db.insert(courseHistory).values([
    ...DEMO_HISTORY.map((c, i) => ({ userId: u, canvasCourseId: courseBase + 101 + i, code: c.code, name: c.name, term: i < 3 ? "AY25/26 Sem 1" : "AY25/26 Sem 2", state: "completed" as const })),
    ...[se, algo, net, stats].map((m) => ({ userId: u, canvasCourseId: m.canvasCourseId, code: m.code, name: m.name, term: m.term, state: "active" as const })),
  ]).run();

  // The last sync: Canvas a minute ago, and the account says the same.
  const syncStart = now - 60_000;
  const syncEnd = now - 5_000;
  db.insert(syncRuns).values([
    { userId: u, source: "canvas", startedAt: syncStart, finishedAt: syncEnd, ok: true },
    { userId: u, source: "enrich", startedAt: now - 10 * 60_000, finishedAt: now - 9 * 60_000, ok: true },
  ]).run();
  db.update(users).set({
    lastSyncStartedAt: syncStart, canvasVerifiedAt: syncEnd, canvasTokenFailedAt: null, syncRequestedAt: null,
    profileJson: JSON.stringify(DEMO_USER_PROFILE), profileAt: now - D, profileError: null, profileRequestedAt: null, courseHistoryAt: now - D,
  }).where(eq(users.id, u)).run();

  return { moduleIds: [se.id, algo.id, net.id, stats.id] };
}
