export interface CanvasCourse { id: number; name: string; course_code: string; syllabus_body?: string | null; term?: { name: string } | null; }
export interface CanvasSubmission { workflow_state: string; score: number | null; }
export interface CanvasAssignment { id: number; name: string; due_at: string | null; html_url: string; points_possible: number | null; submission?: CanvasSubmission; }
export interface CanvasAssignmentGroup { id: number; name: string; group_weight: number | null; assignments?: CanvasAssignment[]; }
export interface CanvasAnnouncement { id: number; title: string; message: string; html_url: string; posted_at: string | null; }
export interface CanvasCalendarEvent { id: number; title: string; start_at: string | null; html_url: string; description: string | null; }
export interface CanvasPage { url: string; title: string; }
// NB: the Canvas files API returns the MIME type under the HYPHENATED key
// "content-type", not snake_case like every other field.
export interface CanvasFile { id: number; display_name: string; url: string; "content-type"?: string; size?: number; hidden?: boolean; }

// GET /api/v1/users/self — the signed-in Canvas account behind a token.
export interface CanvasSelf { id: number; name: string; short_name?: string; primary_email?: string | null; }

// GET /courses/:id/discussion_topics — without only_announcements this lists
// the course's discussions and leaves announcements out.
export interface CanvasDiscussion {
  id: number; title: string; message: string | null; html_url: string;
  posted_at: string | null; last_reply_at: string | null; lock_at?: string | null; todo_date?: string | null;
  discussion_subentry_count?: number; unread_count?: number; read_state?: string;
  require_initial_post?: boolean | null; assignment_id?: number | null; locked_for_user?: boolean;
  user_name?: string | null; author?: { id?: number; display_name?: string } | null;
}
// GET /courses/:id/discussion_topics/:id/view — the whole thread at once.
export interface CanvasDiscussionEntry {
  id: number; user_id?: number; parent_id?: number | null; created_at: string; updated_at?: string;
  message?: string | null; deleted?: boolean; replies?: CanvasDiscussionEntry[];
}
export interface CanvasDiscussionView {
  participants: { id: number; display_name: string }[];
  view: CanvasDiscussionEntry[];
  unread_entries?: number[];
}
// GET /planner/items — Canvas's own to-do feed across courses.
export interface CanvasPlannerItem {
  plannable_type: string; plannable_id: number; course_id?: number | null; html_url?: string | null;
  plannable_date?: string | null;
  plannable: { id: number; title: string; due_at?: string | null; todo_date?: string | null; assignment_id?: number | null; details?: string | null; course_id?: number | null };
  planner_override?: { marked_complete?: boolean; dismissed?: boolean } | null;
  submissions?: false | { submitted?: boolean; excused?: boolean; graded?: boolean; missing?: boolean; late?: boolean };
}
// GET /users/self/missing_submissions — assignments Canvas flags as missing.
export interface CanvasMissing { id: number; course_id: number; name: string; due_at: string | null; html_url: string }
