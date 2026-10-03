// The NUS academic calendar, worked out from the date alone.
//
// NUS lays every year out the same way, which is how NUSMods' own helper
// (nusmoderator, MIT) does it and what this follows: the year starts on the
// first Monday on or after 1 August with an orientation week; each semester
// is orientation, 6 teaching weeks, recess, 7 teaching weeks, reading week
// and two exam weeks; Semester 2's orientation is the year's 23rd week.
// Checked against the Registrar's AY2026/27 calendar: Week 1 Mon 10 Aug,
// exams from Sat 21 Nov, Semester 2 Week 1 Mon 11 Jan.
//
// The Registrar starts recess, reading and exam periods on the Saturday
// before their Monday, so those dates are given as that Saturday.

const H = 3_600_000;
const D = 24 * H;
const W = 7 * D;
const SGT = 8 * H;

export type AcadPhase = "orientation" | "teaching" | "recess" | "reading" | "exams" | "vacation";

export type SemesterView = {
  year: string;            // "26/27"
  sem: 1 | 2;
  phase: AcadPhase;
  week: number | null;     // teaching week 1–13, or exam week 1–2
  title: string;           // "Week 7", "Recess week", "Exam week 1", "Vacation"
  weekOf: number | null;   // 13 while teaching
  // Through the semester, Week 1 to the end of exams: 0..1, or null outside it.
  progress: number | null;
  // Where the breaks sit on that same 0..1 scale, for drawing the bar.
  marks: { recess: [number, number]; reading: [number, number]; exams: [number, number] };
  readingFrom: number;     // Saturday the reading week starts
  examsFrom: number;       // Saturday exams start
  nextSemStart: number | null; // Week 1 Monday of the next semester, in a vacation
};

// Midnight Singapore time on the first Monday on or after 1 August.
export function acadYearStart(startYear: number): number {
  const aug1 = Date.UTC(startYear, 7, 1);
  const dow = new Date(aug1).getUTCDay(); // 0 = Sunday
  return aug1 + ((8 - dow) % 7) * D - SGT;
}

// Monday of a semester's orientation week.
const semOrientation = (yearStart: number, sem: 1 | 2) => yearStart + (sem === 1 ? 0 : 22) * W;

export function semesterView(now: number): SemesterView {
  const y = new Date(now + SGT).getUTCFullYear();
  const startYear = now < acadYearStart(y) ? y - 1 : y;
  const ys = acadYearStart(startYear);
  const acadWeek = Math.floor((now - ys) / W) + 1; // 1-based
  const year = `${String(startYear % 100).padStart(2, "0")}/${String((startYear + 1) % 100).padStart(2, "0")}`;
  const sem: 1 | 2 = acadWeek <= 22 ? 1 : 2;
  const o = semOrientation(ys, sem);
  const wk1 = o + W;
  const span = 17 * W; // Week 1 to the end of exams
  const at = (t: number) => (t - wk1) / span;
  const marks = {
    recess: [at(o + 7 * W), at(o + 8 * W)] as [number, number],
    reading: [at(o + 15 * W), at(o + 16 * W)] as [number, number],
    exams: [at(o + 16 * W), 1] as [number, number],
  };
  const base = { year, sem, marks, readingFrom: o + 15 * W - 2 * D, examsFrom: o + 16 * W - 2 * D };
  const n = Math.floor((now - o) / W) + 1; // week of this semester, orientation = 1
  if (n <= 18 && n >= 1) {
    const progress = Math.min(1, Math.max(0, (now - wk1) / span));
    if (n === 1) return { ...base, phase: "orientation", week: null, title: "Orientation week", weekOf: null, progress: 0, nextSemStart: null };
    if (n === 8) return { ...base, phase: "recess", week: null, title: "Recess week", weekOf: null, progress, nextSemStart: null };
    if (n === 16) return { ...base, phase: "reading", week: null, title: "Reading week", weekOf: null, progress, nextSemStart: null };
    if (n >= 17) return { ...base, phase: "exams", week: n - 16, title: `Exam week ${n - 16}`, weekOf: null, progress, nextSemStart: null };
    const week = n <= 7 ? n - 1 : n - 2;
    return { ...base, phase: "teaching", week, title: `Week ${week}`, weekOf: 13, progress, nextSemStart: null };
  }
  // Between semesters (including the special terms).
  const next = sem === 1 ? semOrientation(ys, 2) + W : acadYearStart(startYear + 1) + W;
  return { ...base, phase: "vacation", week: null, title: "Vacation", weekOf: null, progress: null, nextSemStart: next };
}

// The semester around `now`, week by week, for prompts that turn "Week 8" or
// "in recess" into dates: Week 1 to Week 13, recess, reading week and the two
// exam weeks, each Monday to Sunday.
export type SemesterWeek = { label: string; teachingWeek: number | null; monday: number; sunday: number };

export function semesterWeeks(now: number): { sem: 1 | 2; year: string; weeks: SemesterWeek[] } {
  const v = semesterView(now);
  // Orientation Monday, from where the reading week sits (o + 15 weeks, minus
  // the Saturday shift).
  const o = v.readingFrom + 2 * D - 15 * W;
  const weeks: SemesterWeek[] = [];
  for (let n = 2; n <= 18; n++) {
    const monday = o + (n - 1) * W;
    const label = n === 8 ? "Recess week" : n === 16 ? "Reading week" : n >= 17 ? `Exam week ${n - 16}` : `Week ${n <= 7 ? n - 1 : n - 2}`;
    const teachingWeek = n === 8 || n >= 16 ? null : n <= 7 ? n - 1 : n - 2;
    weeks.push({ label, teachingWeek, monday, sunday: monday + 6 * D });
  }
  return { sem: v.sem, year: v.year, weeks };
}
