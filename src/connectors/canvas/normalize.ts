import type { CanvasAnnouncement, CanvasAssignmentGroup, CanvasCalendarEvent, CanvasCourse } from "./types";

export interface NormalizedItem {
  type: "announcement" | "assignment" | "event";
  sourceId: string;
  title: string; body: string | null; url: string | null;
  dueAt: number | null; sourceCreatedAt: number | null; submitted: boolean;
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
  announcements: CanvasAnnouncement[], events: CanvasCalendarEvent[],
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
    items.push({
      type: "assignment", sourceId: `assignment:${a.id}`, title: a.name, body: null, url: a.html_url,
      dueAt: ts(a.due_at), sourceCreatedAt: null,
      submitted: ["submitted", "graded", "pending_review"].includes(a.submission?.workflow_state ?? ""),
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
