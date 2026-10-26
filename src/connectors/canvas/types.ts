export interface CanvasCourse { id: number; name: string; course_code: string; syllabus_body?: string | null; term?: { name: string } | null; }
export interface CanvasSubmission { workflow_state: string; score: number | null; grade?: string | null; graded_at?: string | null; }
// One criterion of an assignment's rubric, with the marks each level earns.
export interface CanvasRubricCriterion { description?: string | null; long_description?: string | null; points?: number | null; ratings?: { description?: string | null; points?: number | null }[] }
export interface CanvasAssignment {
  id: number; name: string; due_at: string | null; html_url: string; points_possible: number | null; submission?: CanvasSubmission;
  // When it opens and closes. A quiz often has only these, no due date.
  unlock_at?: string | null; lock_at?: string | null;
  submission_types?: string[]; is_quiz_assignment?: boolean; is_quiz_lti_assignment?: boolean; quiz_id?: number | null;
  // The problem statement as HTML, often the only copy of it: some courses
  // never upload it as a file. Absent while the assignment is locked.
  description?: string | null;
  rubric?: CanvasRubricCriterion[] | null;
}
export interface CanvasAssignmentGroup { id: number; name: string; group_weight: number | null; assignments?: CanvasAssignment[]; }
export interface CanvasAnnouncement { id: number; title: string; message: string; html_url: string; posted_at: string | null; }
export interface CanvasCalendarEvent { id: number; title: string; start_at: string | null; html_url: string; description: string | null; }
// updated_at moves whenever the page is edited, which is what lets a page's
// body be kept between syncs instead of fetched again (see page-cache).
// locked_for_user is this student's view: a page behind a module's unlock
// date or prerequisites comes back with no body until it opens for them.
export interface CanvasPage { url: string; title: string; updated_at?: string | null; locked_for_user?: boolean; }
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

// GET /courses/:id/modules?include[]=items&include[]=content_details — the
// Modules tab. items is left out when a module is too long to inline; then
// items_url lists them.
export interface CanvasModuleItem {
  id: number; title: string; type: string; indent?: number; position?: number;
  html_url?: string; page_url?: string; content_id?: number; external_url?: string; url?: string;
  content_details?: { locked_for_user?: boolean; due_at?: string | null };
}
export interface CanvasModule { id: number; name: string; position?: number; unlock_at?: string | null; items?: CanvasModuleItem[]; items_url?: string }

// GET /courses/:id/students/submissions?student_ids[]=self&include[]=submission_comments
export interface CanvasSubmissionComment { author_id: number; author_name?: string; comment: string; created_at: string }
export interface CanvasStudentSubmission {
  assignment_id: number; score: number | null; grade: string | null; graded_at: string | null;
  workflow_state?: string; submission_comments?: CanvasSubmissionComment[];
}

// The Canvas Inbox. common_courses says, per course id, what role each
// participant has in a course the student shares with them — how a
// lecturer's message is told from a classmate's.
export interface CanvasConversation { id: number; subject: string | null; last_message_at: string | null; context_code?: string | null; context_name?: string | null }
export interface CanvasConversationDetail extends CanvasConversation {
  participants?: { id: number; name: string; common_courses?: Record<string, string[]> }[];
  messages?: { id: number; author_id: number; body: string; created_at: string; generated?: boolean }[];
}
