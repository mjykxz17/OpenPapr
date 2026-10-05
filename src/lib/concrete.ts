// Only concrete work is shown: something the course actually posted (a
// Canvas assignment or quiz, an announcement, a staff reply, the exam date
// on NUSMods), a note in the student's own Canvas planner, or a task they
// added themselves. What the app only expects — a quiz the week-1 schedule
// predicts, "the next quiz in the pattern", prep for those — stays out of
// sight until the course confirms it. Schedules change; the latest posted
// information is what the student follows.

export type SourceLike = { kind: string; itemId?: number | null; label?: string };

export function isConcrete(key: string, sources: SourceLike[], itemType: (id: number) => string | undefined): boolean {
  if (key.startsWith("manual-")) return true;
  // A welcome announcement that lists the whole semester is the schedule
  // again, not news: sources read from the course schedule don't count.
  return sources.filter((s) => !/\(course schedule\)\s*$/.test(s.label ?? "")).some((s) => s.kind === "announcement" || s.kind === "discussion" || s.kind === "nusmods"
    // A Canvas class event is when something happens, not something posted to do.
    || ((s.kind === "canvas" || s.kind === "planner") && s.itemId != null && itemType(s.itemId) !== undefined && itemType(s.itemId) !== "event"));
}
