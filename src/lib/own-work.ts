const D = 86_400_000;

// "Quiz 4", "Quiz-4", "Quiz10": the number of a quiz in a series.
const QUIZ_NUM_RE = /\bquiz\s*[-#]?\s*(\d{1,2})\b/i;
export function quizNumber(title: string): number | null {
  const m = QUIZ_NUM_RE.exec(title);
  return m ? Number(m[1]) : null;
}

// One spelling for the words courses write several ways: "Mid-term" and
// "Midterm", "Final Examination" and "Final exam", "Quizzes" and "Quiz".
export const assessmentText = (t: string) => t.toLowerCase()
  .replace(/\bmid[\s-]?terms?\b/g, "midterm")
  .replace(/\bexam(ination)?s?\b/g, "exam")
  .replace(/\bfinals\b/g, "final exam")
  .replace(/\bquizz?es\b/g, "quiz");

const NUMBERED = /\b(?:assignment|incident|lab|tutorial|problem set|ps|homework|hw|milestone|report|midterm|test)\s*[-#]?\s*(\d{1,2})\b/gi;

// "Incident 2", "Assignment-1", "Lab 3": the number an assessment carries.
export const assessmentNumber = (t: string): number | null => {
  const q = quizNumber(t);
  if (q !== null) return q;
  const m = new RegExp(NUMBERED.source, "i").exec(assessmentText(t));
  return m ? Number(m[1]) : null;
};

// Every assessment number a text names: "Quiz 2 results, and Quiz 3 is next week".
export const assessmentNumbers = (t: string): number[] => {
  const s = assessmentText(t);
  const quiz = [...s.matchAll(/\bquiz\s*[-#]?\s*(\d{1,2})\b/g)].map((m) => Number(m[1]));
  return [...new Set([...quiz, ...[...s.matchAll(NUMBERED)].map((m) => Number(m[1]))])];
};

// A cited Canvas item is the task's own work, not just the pattern it follows:
// "Quiz 3" citing "Quiz-2" (the last one) is not finished when Quiz 2 is.
export function ownWork(taskTitle: string, itemTitle: string, taskDue: number | null, itemDue: number | null): boolean {
  const a = assessmentNumber(taskTitle), b = assessmentNumber(itemTitle);
  if (a !== null && b !== null && a !== b) return false;
  // Due days before the task: an earlier instance, cited as the pattern.
  if (taskDue !== null && itemDue !== null && itemDue < taskDue - 2 * D) return false;
  return true;
}

// The title without what is done to it or around it: "Submit the project
// proposal" and "Project proposal" are one thing.
const coreTitle = (t: string) => assessmentText(t).replace(/\([^)]*\)/g, " ")
  .replace(/^\s*(submit|complete|prepare( for)?|prep( for)?|revise for|study for|do|finish|attempt|hand in|sit)\s+/, "")
  .replace(/\b(the|your|a|an)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();

// "Quiz 3" and "Submit Quiz-3": the same kind of assessment with the same number.
// Without a number, a module has one midterm and one final, so "Mid-term" is
// "Midterm" and "Final Examination" is "Final exam"; anything else unnumbered
// ("Lab report", "Lab safety quiz") must have the same name.
export const KIND_WORD = /\b(quiz|test|midterm|exam|assignment|incident|lab|tutorial|project|presentation|milestone|report)\b/i;
export function sameAssessment(a: string, b: string): boolean {
  const ka = KIND_WORD.exec(assessmentText(a))?.[1], kb = KIND_WORD.exec(assessmentText(b))?.[1];
  if (!ka || ka !== kb) return false;
  const na = assessmentNumber(a), nb = assessmentNumber(b);
  if (na !== null || nb !== null) return na === nb;
  if (ka === "midterm") return true;
  if (ka === "exam") return /\bfinal\b/.test(assessmentText(a)) === /\bfinal\b/.test(assessmentText(b));
  return coreTitle(a) === coreTitle(b);
}

// The same piece of work by any name the planner, Canvas or the student gave
// it: the same assessment, or the same title once the wording is set aside.
export function sameTask(a: string, b: string): boolean {
  return sameAssessment(a, b) || (coreTitle(a).length >= 3 && coreTitle(a) === coreTitle(b));
}
