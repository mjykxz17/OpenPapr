import { quizNumber } from "../enrich/tasks";

const D = 86_400_000;

// "Incident 2", "Assignment-1", "Lab 3": the number an assessment carries.
export const assessmentNumber = (t: string): number | null => {
  const q = quizNumber(t);
  if (q !== null) return q;
  const m = /\b(?:assignment|incident|lab|tutorial|problem set|ps|homework|hw|milestone|report|midterm|test)\s*[-#]?\s*(\d{1,2})\b/i.exec(t);
  return m ? Number(m[1]) : null;
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

// "Quiz 3" and "Submit Quiz-3": the same kind of assessment with the same number.
export const KIND_WORD = /\b(quiz|test|midterm|exam|assignment|incident|lab|tutorial|project|presentation|milestone|report)\b/i;
export function sameAssessment(a: string, b: string): boolean {
  const ka = KIND_WORD.exec(a)?.[1]?.toLowerCase(), kb = KIND_WORD.exec(b)?.[1]?.toLowerCase();
  return Boolean(ka) && ka === kb && assessmentNumber(a) === assessmentNumber(b);
}

