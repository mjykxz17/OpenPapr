import type { CanvasAnnouncement, CanvasAssignment, CanvasAssignmentGroup, CanvasCalendarEvent, CanvasCourse, CanvasRubricCriterion, CanvasStudentSubmission } from "./types";

export interface NormalizedItem {
  type: "announcement" | "assignment" | "event";
  sourceId: string;
  title: string; body: string | null; url: string | null;
  dueAt: number | null; sourceCreatedAt: number | null; submitted: boolean;
  metaJson?: string | null;
  gradeJson?: string | null;
}
// What an assignment row knows beyond its due date: whether it is a quiz, and
// its window. closesOnly: Canvas gave no due date, so dueAt is when it closes.
export type AssignmentMeta = { quiz: boolean; practice?: boolean; opensAt: number | null; closesAt: number | null; closesOnly: boolean };

const QUIZ_NAME_RE = /\b(quiz(zes)?|mcqs?|mid-?terms?)\b/i;
export function isQuizAssignment(a: CanvasAssignment): boolean {
  return Boolean(a.is_quiz_assignment || a.is_quiz_lti_assignment || a.quiz_id
    || (a.submission_types ?? []).includes("online_quiz") || QUIZ_NAME_RE.test(a.name));
}
// An assignment's mark, and what lecturers (and the student) wrote on the
// submission. A classmate's comment (a peer review) is never kept.
export type Grade = { score: number | null; outOf: number | null; grade: string | null; gradedAt: number | null; comments: { author: string; at: number; text: string }[] };

export function gradesFrom(
  groups: CanvasAssignmentGroup[], submissions: CanvasStudentSubmission[], staff: Set<number>, selfId: number | null,
): Map<number, Grade> {
  const outOf = new Map(groups.flatMap((g) => g.assignments ?? []).map((a) => [a.id, a.points_possible ?? null]));
  const out = new Map<number, Grade>();
  for (const s of submissions) {
    const comments = (s.submission_comments ?? [])
      .filter((c) => c.comment?.trim() && (c.author_id === selfId || staff.has(c.author_id)))
      .map((c) => ({ author: c.author_id === selfId ? "You" : (c.author_name ?? "Staff"), at: Date.parse(c.created_at), text: c.comment.trim() }));
    if (s.score == null && !s.grade && !comments.length) continue;
    out.set(s.assignment_id, { score: s.score, outOf: outOf.get(s.assignment_id) ?? null, grade: s.grade, gradedAt: ts(s.graded_at), comments });
  }
  return out;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// The rubric, as HTML after the description: what each criterion is worth
// and what each level of it looks like.
function rubricHtml(rubric: CanvasRubricCriterion[] | null | undefined): string {
  if (!rubric?.length) return "";
  const rows = rubric.map((c) => {
    const levels = (c.ratings ?? []).map((r) => `${esc(r.description ?? "")}${r.points != null ? ` (${r.points})` : ""}`).filter(Boolean).join("; ");
    return `<li><b>${esc(c.description ?? "Criterion")}</b>${c.points != null ? ` — ${c.points} pts` : ""}${c.long_description ? `: ${esc(c.long_description)}` : ""}${levels ? `<br>Levels: ${levels}` : ""}</li>`;
  });
  return `<h3>Rubric</h3><ul>${rows.join("")}</ul>`;
}

export interface NormalizedDiscussionItem {
  type: "discussion" | "staff_reply";
  sourceId: string;
  title: string; body: string | null; url: string | null; sender: string | null;
  dueAt: number | null; sourceCreatedAt: number | null; submitted: boolean;
  metaJson: string;
}
export interface NormalizedCanvasSync {
  module: { canvasCourseId: number; code: string; name: string; term: string | null; syllabusBody: string | null };
  components: { name: string; weightPct: number; scorePct: number | null; source: "canvas_api" }[];
  items: NormalizedItem[];
}

export function moduleCodeFromCourse(courseCode: string): string {
  return courseCode.trim().split(/[\s/]+/)[0];
}

const ts = (iso: string | null | undefined) => (iso ? Date.parse(iso) : null);

export function normalizeCanvasCourse(
  course: CanvasCourse, groups: CanvasAssignmentGroup[],
  announcements: CanvasAnnouncement[], events: CanvasCalendarEvent[], grades?: Map<number, Grade>,
): NormalizedCanvasSync {
  const weighted = groups.some((g) => (g.group_weight ?? 0) > 0);
  const components = weighted
    ? groups.filter((g) => (g.group_weight ?? 0) > 0).map((g) => {
        const graded = (g.assignments ?? []).filter((a) => a.submission?.workflow_state === "graded" && a.submission.score != null && a.points_possible);
        const scorePct = graded.length
          ? (100 * graded.reduce((s, a) => s + (a.submission!.score ?? 0), 0)) / graded.reduce((s, a) => s + (a.points_possible ?? 0), 0)
          : null;
        return { name: g.name, weightPct: g.group_weight!, scorePct, source: "canvas_api" as const };
      })
    : [];
  const items: NormalizedItem[] = [];
  for (const g of groups) for (const a of g.assignments ?? []) {
    // A quiz set with only an availability window ("open 9am Mon to 11:59pm
    // Fri") has no due_at; the close is the deadline, or it never shows up.
    const quiz = isQuizAssignment(a);
    const dueAt = ts(a.due_at), opensAt = ts(a.unlock_at), closesAt = ts(a.lock_at);
    const meta: AssignmentMeta | null = quiz || opensAt !== null || (dueAt === null && closesAt !== null)
      ? { quiz, opensAt, closesAt, closesOnly: dueAt === null && closesAt !== null } : null;
    items.push({
      type: "assignment", sourceId: `assignment:${a.id}`, title: a.name, body: `${a.description ?? ""}${rubricHtml(a.rubric)}` || null, url: a.html_url,
      dueAt: dueAt ?? closesAt, sourceCreatedAt: null,
      submitted: ["submitted", "graded", "pending_review"].includes(a.submission?.workflow_state ?? ""),
      metaJson: meta ? JSON.stringify(meta) : null,
      // Without the submissions call this sync knows nothing new; the stored grade stays.
      ...(grades ? { gradeJson: grades.has(a.id) ? JSON.stringify(grades.get(a.id)) : null } : {}),
    });
  }
  for (const an of announcements) items.push({
    type: "announcement", sourceId: `announcement:${an.id}`, title: an.title, body: an.message,
    url: an.html_url, dueAt: null, sourceCreatedAt: ts(an.posted_at), submitted: false,
  });
  for (const ev of events) items.push({
    type: "event", sourceId: `event:${ev.id}`, title: ev.title, body: ev.description,
    url: ev.html_url, dueAt: ts(ev.start_at), sourceCreatedAt: null, submitted: false,
  });
  return {
    module: {
      canvasCourseId: course.id, code: moduleCodeFromCourse(course.course_code),
      name: course.name, term: course.term?.name ?? null, syllabusBody: course.syllabus_body ?? null,
    },
    components, items,
  };
}
