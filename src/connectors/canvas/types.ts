export interface CanvasCourse { id: number; name: string; course_code: string; syllabus_body?: string | null; term?: { name: string } | null; }
export interface CanvasSubmission { workflow_state: string; score: number | null; }
export interface CanvasAssignment { id: number; name: string; due_at: string | null; html_url: string; points_possible: number | null; submission?: CanvasSubmission; }
export interface CanvasAssignmentGroup { id: number; name: string; group_weight: number | null; assignments?: CanvasAssignment[]; }
export interface CanvasAnnouncement { id: number; title: string; message: string; html_url: string; posted_at: string | null; }
export interface CanvasCalendarEvent { id: number; title: string; start_at: string | null; html_url: string; description: string | null; }
export interface CanvasPage { url: string; title: string; }
// NB: the Canvas files API returns the MIME type under the HYPHENATED key
// "content-type", not snake_case like every other field.
export interface CanvasFile { id: number; display_name: string; url: string; "content-type"?: string; }

// GET /api/v1/users/self — the signed-in Canvas account behind a token.
export interface CanvasSelf { id: number; name: string; short_name?: string; primary_email?: string | null; }
