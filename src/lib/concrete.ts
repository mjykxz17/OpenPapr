import { assessmentNumber, assessmentNumbers } from "./own-work";

// Only concrete work is shown: something the course actually posted (a
// Canvas assignment or quiz, an announcement, a staff reply, the exam date
// on NUSMods), a note in the student's own Canvas planner, or a task they
// added themselves. What the app only expects — a quiz the week-1 schedule
// predicts, "the next quiz in the pattern", prep for those — stays out of
// sight until the course confirms it. Schedules change; the latest posted
// information is what the student follows.
//
// A source only confirms the task it is about: "Quiz 3 (expected)" citing
// Quiz 2 on Canvas as its pattern is still only expected.

export type SourceLike = { kind: string; itemId?: number | null; label?: string; quote?: string };

export function isConcrete(key: string, sources: SourceLike[], itemType: (id: number) => string | undefined, title?: string): boolean {
  if (key.startsWith("manual-")) return true;
  // The next quiz of a series is a guess by definition.
  if (key.includes("-series-quiz-")) return false;
  const n = title === undefined ? null : assessmentNumber(title);
  // A source naming other numbered work only ("Quiz 2", for a Quiz 3 task).
  const aboutOther = (s: SourceLike) => {
    if (n === null) return false;
    const named = assessmentNumbers(`${s.label ?? ""} ${s.quote ?? ""}`);
    return named.length > 0 && !named.includes(n);
  };
  // A welcome announcement that lists the whole semester is the schedule
  // again, not news: sources read from the course schedule don't count.
  return sources.filter((s) => !/\(course schedule\)\s*$/.test(s.label ?? "") && !aboutOther(s)).some((s) => s.kind === "announcement" || s.kind === "discussion" || s.kind === "nusmods"
    // A Canvas class event is when something happens, not something posted to do.
    || ((s.kind === "canvas" || s.kind === "planner") && s.itemId != null && itemType(s.itemId) !== undefined && itemType(s.itemId) !== "event"));
}

// The tasks the Tasks page shows: what balancing the days, Papi and the
// calendar feed must count too, so nothing hidden takes up a student's time.
export function concreteTasks<T extends { key: string; title: string; sourcesJson: string }>(rows: T[], itemType: (id: number) => string | undefined): T[] {
  return rows.filter((t) => {
    let sources: SourceLike[] = [];
    try { const v = JSON.parse(t.sourcesJson); if (Array.isArray(v)) sources = v; } catch { /* none */ }
    return isConcrete(t.key, sources, itemType, t.title);
  });
}

// Every item id the tasks cite, to look their types up once.
export function citedItemIds(rows: { sourcesJson: string }[]): number[] {
  return [...new Set(rows.flatMap((t) => {
    try { const v = JSON.parse(t.sourcesJson); return Array.isArray(v) ? (v as SourceLike[]).map((s) => s.itemId).filter((x): x is number => x != null) : []; } catch { return []; }
  }))];
}
