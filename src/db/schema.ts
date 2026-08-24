import { integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  canvasTokenEnc: text("canvas_token_enc"),
  msRefreshTokenEnc: text("ms_refresh_token_enc"),
  msDeltaLink: text("ms_delta_link"),
  lastSeenAt: integer("last_seen_at").notNull().default(0),
});

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
}, (t) => [uniqueIndex("modules_user_course").on(t.userId, t.canvasCourseId)]);

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
  category: text("category", { enum: ["deliverable", "routine"] }),  // deadline tier; null = unclassified, treated as deliverable
}, (t) => [uniqueIndex("items_user_source").on(t.userId, t.source, t.sourceId)]);

export const studyGuides = sqliteTable("study_guides", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  moduleId: integer("module_id").notNull().references(() => modules.id),
  markdown: text("markdown").notNull(),
  sourceNote: text("source_note"),        // provenance line, e.g. "8 decks, 351 slides"
  generatedAt: integer("generated_at").notNull(),
}, (t) => [uniqueIndex("study_guides_module").on(t.moduleId)]);

export const syncRuns = sqliteTable("sync_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  source: text("source", { enum: ["canvas", "graph", "enrich"] }).notNull(),
  startedAt: integer("started_at").notNull(),
  finishedAt: integer("finished_at"),
  ok: integer("ok", { mode: "boolean" }),
  error: text("error"),
});
