import { integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  // Canvas is the identity provider: a person proves who they are by pasting a
  // token, and this is the Canvas account it belongs to. Nullable only so the
  // pre-multi-user row can be adopted on its owner's first sign-in.
  canvasUserId: integer("canvas_user_id"),
  // Sign-in identity. Set once, after which the stored Canvas token is used
  // and never has to be pasted again. Nullable: accounts created before this
  // existed, and anyone who has only ever signed in with a token, have none.
  username: text("username"),
  passwordHash: text("password_hash"),
  canvasTokenEnc: text("canvas_token_enc"),
  msRefreshTokenEnc: text("ms_refresh_token_enc"),
  msDeltaLink: text("ms_delta_link"),
  lastSeenAt: integer("last_seen_at").notNull().default(0),
  createdAt: integer("created_at").notNull().default(0),
  // When this user's sync last began. The worker polls whoever is due rather
  // than everyone at once, which spreads Canvas load across the interval.
  lastSyncStartedAt: integer("last_sync_started_at").notNull().default(0),
  // Set by "Sync now"; the worker clears it as it picks the request up. A flag
  // in the database rather than a call into the worker, because the web server
  // and the worker are separate processes with no channel between them.
  syncRequestedAt: integer("sync_requested_at"),
}, (t) => [uniqueIndex("users_canvas_user").on(t.canvasUserId), uniqueIndex("users_username").on(t.username)]);

export const modules = sqliteTable("modules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id),
  canvasCourseId: integer("canvas_course_id").notNull(),
  code: text("code").notNull(),           // e.g. CS2103T
  name: text("name").notNull(),
  term: text("term"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  syllabusBody: text("syllabus_body"),    // raw HTML from Canvas, weightage-extraction input
  weightageCheckedAt: integer("weightage_checked_at"),  // last extraction attempt; null = never tried
  position: integer("position"),          // home-grid order; null = unplaced (sorts after placed, by id)
  hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),  // hidden from the home grid (user preference)
}, (t) => [uniqueIndex("modules_user_course").on(t.userId, t.canvasCourseId)]);

// Every Canvas file we know about for a module, from the Files listing AND
// from links harvested out of announcement/page HTML. Download urls are signed
// and expire, so only the id is stored — the url is re-fetched at read time.
export const FILE_CATEGORIES = ["slides", "tutorial", "assignment", "reading", "practice", "admin", "image", "other"] as const;
export type FileCategory = (typeof FILE_CATEGORIES)[number];
export type FileCategorySource = "rule" | "llm" | "manual";

export const files = sqliteTable("files", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  moduleId: integer("module_id").notNull().references(() => modules.id),
  canvasFileId: integer("canvas_file_id").notNull(),
  displayName: text("display_name").notNull(),
  contentType: text("content_type"),
  sizeBytes: integer("size_bytes"),
  // True for files reachable only by direct id — pasted into content rather
  // than uploaded to the Files tab.
  hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
  discoveredAt: integer("discovered_at").notNull(),
  // What kind of material this is. null = not yet categorised. A manual
  // category is the user's word and is never overwritten by a rule or model.
  category: text("category", { enum: FILE_CATEGORIES }),
  categorySource: text("category_source", { enum: ["rule", "llm", "manual"] }),
  // For harvested files: the title of the announcement/page (or "Syllabus")
  // that linked it, and the sentence around the link. The strongest clue to a
  // file's category when its name says nothing ("intro.pdf", "image002.jpg").
  linkedFrom: text("linked_from"),
  linkContext: text("link_context"),
}, (t) => [uniqueIndex("files_module_canvas_file").on(t.moduleId, t.canvasFileId)]);

export const components = sqliteTable("components", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  moduleId: integer("module_id").notNull().references(() => modules.id),
  name: text("name").notNull(),
  weightPct: real("weight_pct"),
  scorePct: real("score_pct"),
  source: text("source", { enum: ["canvas_api", "llm_syllabus", "manual"] }).notNull(),
  evidence: text("evidence"),             // quoted syllabus text for llm_syllabus rows
}, (t) => [uniqueIndex("components_module_name_source").on(t.moduleId, t.name, t.source)]);

export const items = sqliteTable("items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id),
  moduleId: integer("module_id").references(() => modules.id),
  type: text("type", { enum: ["announcement", "assignment", "email", "event", "deadline_change", "deadline"] }).notNull(),
  source: text("source", { enum: ["canvas", "graph"] }).notNull(),
  sourceId: text("source_id").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  url: text("url"),
  sender: text("sender"),
  dueAt: integer("due_at"),
  sourceCreatedAt: integer("source_created_at"),
  firstSeenAt: integer("first_seen_at").notNull(),
  submitted: integer("submitted", { mode: "boolean" }).notNull().default(false),
  dismissed: integer("dismissed", { mode: "boolean" }).notNull().default(false),
  triage: text("triage", { enum: ["important", "garbage", "ambiguous", "unscored"] }),
  importance: real("importance"),
  importanceReason: text("importance_reason"),
  actionsExtractedAt: integer("actions_extracted_at"),   // deadline-extraction marker: null = not yet processed
  actionsAttempts: integer("actions_attempts").notNull().default(0),  // failed extraction tries; bounds the retry loop
  category: text("category", { enum: ["deliverable", "routine"] }),  // deadline tier; null = unclassified, treated as deliverable
}, (t) => [uniqueIndex("items_user_source").on(t.userId, t.source, t.sourceId)]);

export const studyGuides = sqliteTable("study_guides", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  moduleId: integer("module_id").notNull().references(() => modules.id),
  markdown: text("markdown").notNull(),
  sourceNote: text("source_note"),        // provenance line, e.g. "8 decks, 351 slides"
  generatedAt: integer("generated_at").notNull(),
}, (t) => [uniqueIndex("study_guides_module").on(t.moduleId)]);

// What the model is told about a module before it writes anything for it.
// Generation is stateless otherwise: each guide run starts from the deck
// text alone, with no idea which module it is, how the lecturer teaches or
// what the exam looks like. Two documents, kept apart so one never
// overwrites the other: `notes` is the student's own markdown (exam format,
// what the lecturer stresses in class, conventions to keep); `profile` is
// written by the model from samples of the decks at the start of each guide
// run and describes the module and the lecturer's style as it observed them.
// Both are folded into every prompt, together with the facts the database
// already holds (code, name, assessment, deck list) — see
// src/lib/module-context.ts.
export const moduleContext = sqliteTable("module_context", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  moduleId: integer("module_id").notNull().references(() => modules.id),
  notes: text("notes"),
  notesUpdatedAt: integer("notes_updated_at"),
  profile: text("profile"),
  profiledAt: integer("profiled_at"),
  profileSource: text("profile_source"),   // provenance, e.g. "6 decks, model-x"
}, (t) => [uniqueIndex("module_context_module").on(t.moduleId)]);

// One study-guide generation, from the moment it is asked for. Doubles as the
// request queue: a row with startedAt null is work the worker has not picked
// up yet. Generation takes minutes rather than seconds — a single spinner over
// that is indistinguishable from a hang — so the counters exist to say "4 of 7
// sections" rather than merely "working".
export const guideRuns = sqliteTable("guide_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id),
  moduleId: integer("module_id").notNull().references(() => modules.id),
  requestedAt: integer("requested_at").notNull(),
  startedAt: integer("started_at"),
  finishedAt: integer("finished_at"),
  ok: integer("ok", { mode: "boolean" }),
  error: text("error"),
  stage: text("stage"),                    // human-readable: "Writing section 4 of 7"
  decksTotal: integer("decks_total").notNull().default(0),
  decksDone: integer("decks_done").notNull().default(0),
  sectionsTotal: integer("sections_total").notNull().default(0),
  sectionsDone: integer("sections_done").notNull().default(0),
});

export const syncRuns = sqliteTable("sync_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  source: text("source", { enum: ["canvas", "graph", "enrich"] }).notNull(),
  startedAt: integer("started_at").notNull(),
  finishedAt: integer("finished_at"),
  ok: integer("ok", { mode: "boolean" }),
  error: text("error"),
});
