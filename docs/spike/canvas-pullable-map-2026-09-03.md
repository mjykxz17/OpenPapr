# What a student token can pull from NUS Canvas

Live probe of `https://canvas.nus.edu.sg/api/v1` on 2026-09-03 with the author's
personal access token (student role). About 700 read-only GET requests plus two
read-only GraphQL queries; the rate-limit bucket never dropped below its
700 ceiling. Probe scripts and raw results were kept outside the repo (session
scratchpad, `canvas_probe.py` / `canvas_probe.json` / `canvas_probe2.json`).

Courses in scope:

| Set | Courses | Notes |
| --- | --- | --- |
| Current term (2610 = 2026/27 S1) | CS4238, CS4239/CS5439, GEC1044, IFS4103 | full endpoint sweep (about 90 endpoints each) |
| Still "active" but past term | CS2103/T (2025/26 S1), GES1035 (2024/25 S2), RC1010A, THE1001, THE1002 (Non-Academic) | light sweep |
| Completed | 30 courses | 26 return 403 everywhere (access restricted by date); CS1010, CS1231S and two others are fully readable |

The "OpenPapr" column states what `src/connectors/canvas/client.ts` fetches
today. Everything else in the table is reachable but unused.

## 1. User-level endpoints (no course id needed)

| Endpoint | Status | What comes back | OpenPapr |
| --- | --- | --- | --- |
| `/users/self` | 200 | id, name, email | yes (sign-in check) |
| `/users/self/profile` | 200 | login id, LTI user id, time zone, **calendar `.ics` feed URL** (capability token, no bearer needed) | no |
| `/users/self/settings` | 200 | UI prefs only | no |
| `/users/self/communication_channels` | 200 | 2 channels: email, push | no |
| `/users/self/enrollments` (all states) | 200 | 71 enrolment rows; grades object carries `current_score` on only 2 rows (one 2023/24 course that does not hide final grades) | no |
| `/courses?enrollment_state=active` | 200 | 9 courses incl. 3 Non-Academic shells and 2 past-term courses | yes |
| `/courses?enrollment_state=completed` | 200 | 30 courses; 26 carry only `id` + `access_restricted_by_date: true` | no |
| `/courses?state[]=...` | 200 | 47 rows (active + completed union) | no |
| `/dashboard/dashboard_cards` | 200 | exactly the 4 current-term courses, with colour, position, term, `defaultView` | no |
| `/users/self/favorites/courses` | 200 | same 4 | no |
| `/users/self/activity_stream` | 200 | 62 items: 51 Announcement, 8 Message, 3 DiscussionTopic; each has `read_state` | no |
| `/users/self/activity_stream/summary` | 200 | counts per type incl. unread | no |
| `/users/self/todo` | 200 | 0 today | no |
| `/users/self/todo_item_count` | 200 | `assignments_needing_submitting`, `needs_grading_count` | no |
| `/users/self/upcoming_events` | 200 | 3 (two CS4239 quizzes due 6 Sep, one CS4238 class 8 Sep) | no |
| `/users/self/missing_submissions` | 200 | 1 (a GES1035 item from May 2025) | no |
| `/planner/items?start_date&end_date` | 200 | 79 items Jul–Dec 2026: 55 announcement, 12 calendar_event, 8 assignment, 3 discussion_topic, 1 quiz; each with `planner_override` and `new_activity` | no |
| `/planner/overrides` | 200 | 100+ rows: the user's own marked-complete / dismissed flags per item | no |
| `/planner/notes` | 404 | feature off | - |
| `/users/self/graded_submissions?include[]=assignment` | 200 | **384 graded submissions across 31 courses, 321 with a numeric score**, including courses whose course endpoints return 403. Current-term rows (CS4239, 7) have `score: null`. | no |
| `/users/self/files`, `/users/self/folders` | 200 | 100+ files in `my files/Submissions/<course>` for 21 courses: the student's own uploaded work | no |
| `/users/self/groups` | 200 | 11 group memberships across courses (tutorial groups etc.) | no |
| `/users/self/course_nicknames` | 200 | 5 | no |
| `/users/self/features`, `/features/enabled` | 200 | account feature flags | no |
| `/conversations` | 200 | 84 inbox threads, all from 2023–2025 courses | no |
| `/conversations/unread_count` | 200 | | no |
| `/search/recipients?search=` | 200 | any user or course context by name (messaging directory) | no |
| `/search/all_courses?search=` | 200 | public course index | no |
| `/calendar_events?context_codes[]=user_<id>` | 200 | 0 personal events | no |
| `/appointment_groups` | 200 | 0 | no |
| `/services/kaltura` | 200 | media service config | no |
| `/brand_variables` | 200 | theme | no |
| `/api/graphql` (POST) | 200 | works with the same token; `allCourses` returns 39 | no |
| `/users/self/page_views` | 403 | | - |
| `/users/self/history` | 200 | 0 rows | - |
| `/accounts`, `/accounts/self`, `/accounts/self/account_notifications` | 200 empty / 403 / 200 empty | no account-level access | - |
| `/release_notes` | 403 | | - |
| `/epub_exports` | 500 | | - |
| `/smart_search` | 404 | not enabled | - |
| `/users/self/custom_data` | 400 | needs a namespace; writable scratch store per user | - |

## 2. Per-course content (current-term courses)

Status / count per course. `dis` = Canvas returns "That page has been disabled
for this course" (404).

| Endpoint | CS4238 | CS4239 | GEC1044 | IFS4103 | OpenPapr |
| --- | --- | --- | --- | --- | --- |
| `/courses/:id` with includes | 200 | 200 | 200 | 200 | partial (term, syllabus_body) |
| `/courses/:id/tabs?include[]=external` | 19 | 19 | 19 | 20 | no |
| `/courses/:id/external_tools?include_parents=true` | 21 | 21 | 21 | 21 | no |
| `/courses/:id/lti_apps/launch_definitions` | 12 | 12 | 12 | 12 | no |
| `/courses/:id/modules?include[]=items,content_details` | 5 / 19 items | 0 | 1 / 4 | 4 / 4 | no |
| `/courses/:id/pages?include[]=body` | 9 | dis | 4 | 4 | list + body (harvest only) |
| `/courses/:id/front_page` | 404 none set | 404 | 404 | 404 | no |
| `/courses/:id/files` | 7 (5 pptx, 2 docx) | 14 (10 pdf) | 19 (10 pdf, 8 jpg) | 2 (posters) | yes |
| `/courses/:id/folders` | 4 | 5 | 12 | 2 | no |
| `/files/:id` for ids linked in HTML but absent from listing | 6 (inline png) | 0 | 0 | **13 (12 pdf, 75 MB, all `hidden: true`)** | yes |
| `/files/:id/public_url` | 200 | - | - | 200 | no |
| `/courses/:id/files/quota` | 403 | 403 | 403 | 403 | - |
| `/courses/:id/assignments` | 0 | 8 | 0 | 0 | via assignment_groups |
| `/courses/:id/assignment_groups` | 1 (w 0) | 1 (w 0) | 3 (w 0) | 5 (weights 20/20/50/10) | yes |
| `/courses/:id/students/submissions?student_ids[]=self` | 0 | 8 | 0 | 0 | via include[]=submission |
| `/courses/:id/quizzes` (classic) | dis | 0 | 1 survey | dis | no |
| `/api/quiz/v1/courses/:id/quizzes` (New Quizzes) | 403 | 403 | 403 | 403 | - |
| `/courses/:id/discussion_topics` (non-announcement) | 1 | 2 (5 replies) | 0 | 1 | no |
| `/courses/:id/discussion_topics?only_announcements=true` | 4 | 27 | 13 | 11 | yes |
| `/courses/:id/discussion_topics/:id/view` | 200 | 200 | 200 | 200 | no |
| `/announcements?context_codes[]=course_X` | 4 | 27 | 13 | 11 | no (same data) |
| `/calendar_events?type=event` | 6 | 0 | 0 | 0 | yes |
| `/calendar_events?type=assignment` | 0 | 8 | 0 | 0 | no |
| `/courses/:id/media_objects` | 0 | 0 | 10 video "Media Comment" with `media_sources` | 0 | no |
| `/courses/:id/groups` | 0 | 0 | 5 tutorial groups | 0 | no |
| `/courses/:id/settings` | 200 | 200 | 200 | 200 | no |
| `/courses/:id/grading_standards` | 1 | 1 | 5 | 5 | no |
| `/courses/:id/grading_periods` | 200 empty | | | | no |
| `/courses/:id/features/enabled` | 14 flags | | | | no |
| `/courses/:id/activity_stream` | 5 | 35 | 12 | 10 | no |
| `/courses/:id/analytics/users/:self/activity` | 200 | 200 | 200 | 200 | no |
| `/courses/:id/analytics/users/:self/assignments` | 0 | 8 | 0 | 0 | no |
| `/courses/:id/outcome_results`, `/outcome_rollups` | 200 empty | | | | no |
| `/courses/:id/content_exports` | 200 empty | | | | no |
| `/courses/:id/collaborations` | 200 empty | | | | no |
| `/courses/:id/conferences` | returns HTML, not JSON | | | | - |
| `/courses/:id/rubrics` | 403 | 403 | 403 | 403 | - |
| `/courses/:id/group_categories` | 403 | | | | - |
| `/courses/:id/analytics/activity` (course-wide) | 403 | | | | - |
| `/courses/:id/gradebook_history/days` | 403 | | | | - |
| `/courses/:id/late_policy` | 403 | | | | - |
| `/courses/:id/content_migrations`, `/external_feeds`, `/link_validation`, `/blueprint_subscriptions`, `/bulk_user_progress` | 403 | | | | - |
| `/courses/:id/users/:self/progress` | 400 (no module requirements set) | | | | - |
| `/courses/:id/smart_search`, `/reports` | 404 | | | | - |

Field-level detail worth knowing:

- **Course object includes.** `hide_final_grades: true` on all 4; `total_students`
  71 / 60 / 617 / 40; `teachers` array populated; `sections` 2 each;
  `default_view: modules`; `grading_standard_id` set; `image_download_url` on 2
  courses; `course_progress` present but `requirement_count` 0; `syllabus_body`
  about 4 KB HTML on each.
- **Modules.** CS4238 is the only current course that uses Modules as its
  content spine: 5 modules (About the Course, Week 1–4) holding 9 Pages,
  7 Files (the pptx decks, the sample quiz and its answer key) and
  3 ExternalUrl links. IFS4103's 4 modules are one Page each and the module
  names carry the lecture date and time. GEC1044 has one "About" module.
  CS4239 has none. No item is locked.
- **Pages.** CS4238: Grading, Overview, Plagiarism and AI use, Prerequisite,
  Syllabus, Practice VM Installation (x2), TC Commands, NFT commands.
  GEC1044: Assessment, Description, Syllabus, Teaching Modes. IFS4103: the four
  weekly lecture pages, which are where its hidden PDFs are linked.
  `include[]=body` returns bodies in the listing, so the per-page fetch the
  harvester does is avoidable.
- **Files.** CS4238's decks are `.pptx` (5) plus two `.docx`. CS4239 and
  GEC1044 are PDF-heavy. IFS4103's listing holds two recruitment images; its
  12 lecture/assignment PDFs are reachable only by id and are `hidden: true`.
  Download URLs are signed and short-lived; `/files/:id` re-signs on demand.
  `include[]=user` gives the uploader on some files.
- **Assignments and submissions.** Only CS4239 has assignments: 7 New Quizzes
  (`submission_types: external_tool`, `is_quiz_lti_assignment`, launch host
  `nus.quiz-lti-sin-prod.instructure.com`) and 1 `online_upload` lab (100 pts,
  due 16 Sep). The 7 quiz submissions are `workflow_state: graded` with
  `graded_at` set but `score`, `grade` and `posted_at` all null, so the grade
  exists and is withheld from the student. `submission_comments` empty,
  `score_statistics` absent, `rubric` absent, `peer_reviews` empty.
- **Announcements.** Fields include `author`, `posted_at`, `delayed_post_at`
  (GEC1044 schedules 12 of 13), `discussion_subentry_count` (CS4239 has 2
  replies), `attachments` (0 everywhere), `read_state`. The `/view` endpoint
  returns the full thread with participants.
- **Calendar.** CS4238 has 6 weekly class events (Tue 10:30–13:30 SGT,
  location "Zoom Online Meeting", join link and meeting number in the
  description). The other three courses have no events; their schedule lives
  only in module names or announcements.
- **Grades.** `/enrollments?user_id=self` returns a grades object with only
  `html_url` on all 4 courses. `/students/submissions` returns no scores for
  the current term. The letter-grade scheme is readable via
  `/grading_standards`.
- **People.** Roster is readable: `/enrollments` returns 100 / 83 / 100 / 84
  rows per page with student names and types (Student, Teacher, TA,
  Observer); `/users` returns names but `email` is null for everyone;
  `/users?enrollment_type[]=teacher,ta` returns 5 / 2 / 9 / 3 staff;
  `/sections?include[]=students` lists members per section;
  `/search_users` works. GraphQL `usersConnection` returns the same.
- **Media.** GEC1044 has 10 video "Media Comment" objects with
  `media_sources` (direct media URLs). Zoom and Panopto content is not in
  this endpoint.
- **Own analytics.** `/analytics/users/:self/activity` returns the student's
  own page views by hour and participations per course.

## 3. The LTI boundary

All four courses expose the same 21 installed external tools (account-level,
visible with `include_parents=true`). The REST API stops at a launch URL:
`/courses/:id/external_tools/sessionless_launch?id=` returns 200 with a
one-time URL for Zoom, Course Readings, Attendance, Quizzes 2, Chat, OneDrive
and Studio; the Panopto launch returns an `errors` body. Following the launch
needs a browser session, and the content behind it is not addressable by the
Canvas token.

| Tool | Domain | LTI | Nav tab | Content behind it |
| --- | --- | --- | --- | --- |
| Zoom | applications.zoom.us | 1.3 | yes | meetings, **cloud recordings** (CS4238 recordings are here per the 26 Aug announcement) |
| Videos/Panopto | mediaweb.ap.panopto.com | 1.1 | yes | lecture video library |
| Quizzes 2 (New Quizzes) | nus.quiz-lti-sin-prod.instructure.com | 1.1 | yes | quiz questions, attempts, results (CS4239's quizzes) |
| Course Readings | coursereadings.nus.edu.sg | 1.3 | yes | reading lists |
| Student Feedback / Reports | blue.nus.edu.sg | 1.3 / 1.1 | yes | course surveys |
| Chat LTI (SG) | chat-sin.instructure.com | 1.1 | yes | course chat |
| Attendance (Roll Call) | rollcall-sin.instructure.com | 1.1 | admins only | attendance records |
| Microsoft Education, OneDrive | m365lti.edu.cloud.microsoft, onedrivelti.microsoft.com | 1.3 | yes / no | Teams, OneDrive files |
| Turnitin | turnitin.com | 1.1 | no | similarity reports |
| Admin and Course Analytics | canvas-analytics-iad-prod.inscloudgate.net | 1.3 | yes | analytics (course-wide REST analytics is 403) |
| CDMS, NUS Tools | inetapps.nus.edu.sg | 1.3 | admins only | NUS internal |
| Studio, Canvas Commons, SCORM, Vimeo, YouTube, Sistemic Grade Passback, LTI Usage | various | mixed | mostly no | |

Tabs also list "IgniteAI Search" and "Notebook", which are Canvas-native UI
features with no REST surface found in this probe.

## 4. Past courses

| Course | Enrolment | Files | Modules / items | Pages | Announcements | Assignments (scored) | Quizzes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| CS2103/T 2025/26 S1 | active | 20 (11 pdf, 132 MB) | 1 / 1 | 1 | 48 | 14 (4) | 23 |
| GES1035 2024/25 S2 | active | 25 (19 pdf) | 0 | dis | 13 | 7 (0) | dis |
| RC1010A, THE1001, THE1002 | active, Non-Academic | 403 | 5/16, 12/32, 3/4 | dis | 0 | 1–2 (all scored) | dis |
| CS1010 2023/24 S1 | completed | 41 (41 pdf) | 15 / 244 | dis | 18 | 29 (29) | 38 |
| CS1231S 2023/24 S2 | completed | 63 (33 pdf, 73 MB) | 19 / 62 | 9 | 32 | 21 (20) | 11 |
| one 2023/24 S2 course (no code exposed) | completed | 54 (53 pdf) | 15 / 274 | 5 | 403 | 28 (28) | 31 |
| one 2023/24 S2 course (no code exposed) | completed | 403 | 0 | 1 | 403 | 10 (10) | 5 |
| 26 other completed courses | completed | 403 | 403 | 403 | 403 | 403 | 403 |

The 26 restricted courses are still visible through two user-level routes:
`/users/self/graded_submissions` (their per-assignment scores) and
`/users/self/files` (the student's own submissions to them).

## 5. Feeds and alternate protocols

- **iCal:** `/feeds/calendars/user_<capability>.ics` from the profile. Covers
  events and assignment due dates across all enrolled courses. Needs no bearer
  token, so the URL itself is a credential.
- **GraphQL:** `POST /api/graphql` with the same bearer token. Same
  permission model as REST; useful for nested reads (course → modules →
  items → content type in one request, submissions with assignment in one
  request).
- **Atom/RSS course feeds:** not probed; Canvas exposes them only for public
  courses.
