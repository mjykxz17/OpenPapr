# OpenPapr Phase 0–1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the OpenPapr core dashboard: pollers pulling Canvas + NUS Outlook (Graph) into a normalized SQLite store, LLM enrichment (email triage + syllabus weightage), and the quiet-ink web UI — per the approved spec at `docs/superpowers/specs/2026-08-12-canvas-outlook-dashboard-design.md`.

**Architecture:** One Next.js (App Router) TypeScript app, two processes in one container: `web` (UI + API routes, reads DB + writes user-state only) and `worker` (pollers + enricher, sole writer of source data). SQLite via Drizzle. Connectors and enrichers are pure modules with injected `fetch`/SDK clients so everything is testable with fixtures and fakes.

**Tech Stack:** Node 22, Next.js 15 (App Router), TypeScript strict, Tailwind CSS 4, Drizzle ORM + better-sqlite3, Zod, @anthropic-ai/sdk (model `claude-haiku-4-5` — Haiku-class per the approved spec), Vitest, Playwright, Fly.io.

## Global Constraints

- Repo root: `/Users/aiden/Desktop/one-ring` (repo already exists with `docs/` committed; the app lives at the root, not a subdirectory).
- Model for all LLM calls: `claude-haiku-4-5`, overridable via env `ANTHROPIC_MODEL`. No `thinking` parameter (Haiku 4.5 doesn't take adaptive thinking config in our usage); use `client.messages.parse()` with `output_config.format` (Zod) for all structured output. Never parse free-text JSON.
- The web process never calls Canvas/Graph/Anthropic. The worker is the only writer of source data. Web writes only: dismissed flags, manual components, `last_seen_at`.
- Canvas base URL: `https://canvas.nus.edu.sg` (env `CANVAS_BASE_URL`). Graph device-code flow uses tenant `organizations`, scopes `offline_access Mail.Read`.
- All timestamps stored as ms-epoch integers. All secrets (Canvas token, MS refresh token) stored AES-256-GCM-encrypted with env `SECRET_KEY` (64 hex chars).
- Email triage is fail-open: mail is hidden only on a confident `garbage` verdict; LLM failure ⇒ `unscored`, shown in feed.
- Weightage rows with `source: "manual"` are never overwritten by worker upserts.
- Every commit message ends with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Test runner: `npx vitest run <file>` (add `"test": "vitest run"` script). Unit tests colocated as `src/**/*.test.ts`; fixtures in `tests/fixtures/`.

## File Structure

```
one-ring/
├─ docs/spike/RESULTS.md              # Phase-0 findings (Task 1–2)
├─ scripts/
│  ├─ spike-canvas.mjs                # Task 1 probe (kept for reference)
│  ├─ spike-graph.mjs                 # Task 2 probe
│  ├─ connect-microsoft.ts            # Task 8: device-code login → encrypted refresh token in DB
│  └─ seed-demo.ts                    # Task 16: seeded DB for Playwright/dev
├─ drizzle/                           # generated SQL migrations (checked in)
├─ drizzle.config.ts
├─ src/
│  ├─ lib/env.ts                      # Task 3: zod-validated env
│  ├─ lib/crypto.ts                   # Task 5: AES-256-GCM encrypt/decrypt
│  ├─ db/schema.ts                    # Task 4: users/modules/components/items/sync_runs
│  ├─ db/client.ts                    # Task 4: createDb(path) + migrations
│  ├─ db/repo.ts                      # Task 7: applyCanvasSync, upsertMailItems, queries
│  ├─ connectors/canvas/client.ts     # Task 6: paginated Canvas REST client
│  ├─ connectors/canvas/types.ts      # Task 6: raw Canvas payload types
│  ├─ connectors/canvas/normalize.ts  # Task 7: raw → NormalizedCanvasSync
│  ├─ connectors/graph/auth.ts        # Task 8: device-code + refresh grant
│  ├─ connectors/graph/client.ts      # Task 8: inbox delta query
│  ├─ connectors/graph/normalize.ts   # Task 9: GraphMessage → NormalizedItem
│  ├─ enrich/rules.ts                 # Task 10: module-code regex + rule triage
│  ├─ enrich/llm.ts                   # Task 11: scoreEmail (Anthropic, fail-open)
│  ├─ enrich/weightage.ts             # Task 12: extractWeightage (text + PDF sources)
│  ├─ worker/sync.ts                  # Task 13: runUserSync orchestration
│  ├─ worker/index.ts                 # Task 13: loop entrypoint (tsx src/worker/index.ts)
│  ├─ server/auth.ts                  # Task 14: password session sign/verify
│  └─ app/                            # Next.js App Router
│     ├─ layout.tsx, globals.css      # Task 15: rail + quiet-ink tokens
│     ├─ page.tsx                     # Task 15: home (what's-new, todos, mail, modules)
│     ├─ login/page.tsx               # Task 15
│     ├─ mail/page.tsx                # Task 15: full feed + show-filtered
│     ├─ modules/[id]/page.tsx        # Task 15: components + evidence + announcements
│     └─ api/
│        ├─ login/route.ts            # Task 14
│        ├─ overview/route.ts         # Task 14: single read endpoint feeding home
│        ├─ items/[id]/dismiss/route.ts   # Task 14
│        ├─ components/manual/route.ts    # Task 14
│        └─ seen/route.ts             # Task 14: advance last_seen_at
├─ tests/fixtures/{canvas,graph}/*.json
├─ e2e/smoke.spec.ts                  # Task 16
├─ playwright.config.ts               # Task 16
├─ Dockerfile, start.sh, fly.toml     # Task 17
└─ README.md                          # Task 17
```

---

### Task 1: Phase-0 spike — Canvas API probe

Spikes are experiments, not TDD. The deliverable is a recorded verdict.

**Files:**
- Create: `scripts/spike-canvas.mjs`
- Create: `docs/spike/RESULTS.md`

**Interfaces:**
- Consumes: nothing. Requires Aiden to generate a token at canvas.nus.edu.sg → Account → Settings → **New Access Token**, and export it as `CANVAS_TOKEN`.
- Produces: verdict in `docs/spike/RESULTS.md` (token works? weighted groups present? syllabus_body populated?) that Tasks 6–7 and 12 rely on.

- [ ] **Step 1: Write the probe script**

```js
// scripts/spike-canvas.mjs — run: CANVAS_TOKEN=... node scripts/spike-canvas.mjs
const BASE = process.env.CANVAS_BASE_URL ?? "https://canvas.nus.edu.sg";
const TOKEN = process.env.CANVAS_TOKEN;
if (!TOKEN) { console.error("Set CANVAS_TOKEN"); process.exit(1); }
const get = async (path) => {
  const res = await fetch(`${BASE}/api/v1${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) throw new Error(`${res.status} ${path}: ${await res.text()}`);
  return res.json();
};
const courses = await get("/courses?enrollment_state=active&per_page=100&include[]=term&include[]=syllabus_body");
console.log(`courses: ${courses.length}`);
for (const c of courses) {
  console.log(`- [${c.id}] ${c.course_code} | term=${c.term?.name} | syllabus=${c.syllabus_body ? c.syllabus_body.length + " chars" : "EMPTY"}`);
  const groups = await get(`/courses/${c.id}/assignment_groups?include[]=assignments&include[]=submission&per_page=100`);
  for (const g of groups) console.log(`    group "${g.name}" weight=${g.group_weight} assignments=${g.assignments?.length ?? 0}`);
  const ann = await get(`/courses/${c.id}/discussion_topics?only_announcements=true&per_page=5`);
  console.log(`    announcements: ${ann.length}`);
}
```

- [ ] **Step 2: Run it with Aiden's token and observe**

Run: `CANVAS_TOKEN=<token> node scripts/spike-canvas.mjs`
Expected: course list prints without 401/403. Note per-course whether `group_weight` is non-zero (weighted grading configured) and whether `syllabus_body` is populated.

- [ ] **Step 3: Save two raw responses as fixtures for later tasks**

Run (adjust one real course id, redact nothing — these are Aiden's own data, but strip any other students' names if present):
```bash
mkdir -p tests/fixtures/canvas
CANVAS_TOKEN=<token> node -e "fetch(process.env.CANVAS_BASE_URL+'/api/v1/courses?enrollment_state=active&per_page=100&include[]=term&include[]=syllabus_body',{headers:{Authorization:'Bearer '+process.env.CANVAS_TOKEN}}).then(r=>r.json()).then(j=>console.log(JSON.stringify(j,null,2)))" > tests/fixtures/canvas/courses.json
```
Same pattern for one course's `assignment_groups` → `tests/fixtures/canvas/assignment_groups.json` and `discussion_topics?only_announcements=true` → `tests/fixtures/canvas/announcements.json`. If real capture fails, hand-write the fixtures in Task 6 from the shapes documented there.

- [ ] **Step 4: Record the verdict**

Write `docs/spike/RESULTS.md`, sections: `## Canvas` — token generation possible (y/n), API reachable (y/n), per-module: weighted groups y/n, syllabus_body y/n. This decides how much Task 12 (LLM weightage) matters per module.

- [ ] **Step 5: Commit**

```bash
git add scripts/spike-canvas.mjs docs/spike/ tests/fixtures/
git commit -m "spike: Canvas API probe and recorded results"
```

---

### Task 2: Phase-0 spike — Entra app + Graph device-code probe

**Files:**
- Create: `scripts/spike-graph.mjs`
- Modify: `docs/spike/RESULTS.md`

**Interfaces:**
- Consumes: a free personal Entra tenant. Manual setup (document what was done in RESULTS.md): entra.microsoft.com → App registrations → New registration → name `one-ring`, supported account types **"Accounts in any organizational directory"** (multi-tenant), no redirect URI → after creation: Authentication → Advanced settings → **Allow public client flows: Yes**. Copy the Application (client) ID.
- Produces: verdict — can a NUS account consent to `Mail.Read`? — which decides whether Task 8 builds the Graph path (plan default) or the Gmail fallback (STOP and re-plan if blocked).

- [ ] **Step 1: Write the probe script**

```js
// scripts/spike-graph.mjs — run: MS_CLIENT_ID=... node scripts/spike-graph.mjs
const CLIENT_ID = process.env.MS_CLIENT_ID;
const TENANT = "organizations";
const SCOPE = "offline_access Mail.Read";
const form = (o) => new URLSearchParams(o);
let res = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/devicecode`, {
  method: "POST", body: form({ client_id: CLIENT_ID, scope: SCOPE }),
});
const dc = await res.json();
if (!dc.device_code) { console.error("devicecode failed:", dc); process.exit(1); }
console.log(`\n>>> Open ${dc.verification_uri} and enter code: ${dc.user_code}\n>>> Sign in with the NUS account.\n`);
let tok;
for (;;) {
  await new Promise((r) => setTimeout(r, (dc.interval ?? 5) * 1000));
  res = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, {
    method: "POST",
    body: form({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", client_id: CLIENT_ID, device_code: dc.device_code }),
  });
  tok = await res.json();
  if (tok.access_token) break;
  if (tok.error !== "authorization_pending") { console.error("FAILED:", tok.error, tok.error_description); process.exit(1); }
}
console.log("Got tokens. refresh_token present:", Boolean(tok.refresh_token));
res = await fetch("https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$top=3&$select=subject,from,receivedDateTime", {
  headers: { Authorization: `Bearer ${tok.access_token}` },
});
const mail = await res.json();
if (mail.value) mail.value.forEach((m) => console.log(`- ${m.receivedDateTime} | ${m.from?.emailAddress?.address} | ${m.subject}`));
else console.error("Mail read FAILED:", JSON.stringify(mail));
```

- [ ] **Step 2: Run it and attempt NUS sign-in**

Run: `MS_CLIENT_ID=<app id> node scripts/spike-graph.mjs`
Expected outcomes: (a) consent granted → 3 subject lines print → **Graph path confirmed**; (b) error `AADSTS65001`/"needs admin approval" screen → NUS blocks user consent → **STOP: report to Aiden, decide Gmail-forwarding fallback, revise Tasks 8–9 before proceeding**.

- [ ] **Step 3: Capture a delta-query fixture**

While the access token is valid, save `GET https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$select=subject,from,bodyPreview,receivedDateTime,webLink` response (first page) as `tests/fixtures/graph/delta-page1.json`, and note the `@odata.nextLink`/`@odata.deltaLink` fields' presence in RESULTS.md.

- [ ] **Step 4: Record verdict + commit**

Append `## Graph` section to `docs/spike/RESULTS.md`: consent outcome, refresh token received y/n, delta query works y/n, the client ID used.
```bash
git add scripts/spike-graph.mjs docs/spike/RESULTS.md tests/fixtures/graph/
git commit -m "spike: Graph device-code consent probe and verdict"
```

---

### Task 3: Scaffold the app + env module

**Files:**
- Create: Next.js scaffold at repo root (`package.json`, `tsconfig.json`, `next.config.ts`, `src/app/*`), `vitest.config.ts`, `src/lib/env.ts`, `src/lib/env.test.ts`, `.env.example`

**Interfaces:**
- Produces: `loadEnv(raw?: NodeJS.ProcessEnv): Env` from `src/lib/env.ts`, where `Env = { DATABASE_PATH: string; SECRET_KEY: string; APP_PASSWORD: string; CANVAS_BASE_URL: string; MS_CLIENT_ID?: string; ANTHROPIC_API_KEY?: string; ANTHROPIC_MODEL: string; POLL_INTERVAL_MS: number }`. Every later task reads config through this.

- [ ] **Step 1: Scaffold**

```bash
cd ~/Desktop/one-ring
npx create-next-app@latest . --ts --app --tailwind --src-dir --no-eslint --import-alias "@/*" --use-npm --yes
npm i drizzle-orm better-sqlite3 zod @anthropic-ai/sdk
npm i -D drizzle-kit vitest @types/better-sqlite3 tsx
```
If create-next-app refuses a non-empty dir, scaffold into `/tmp/scaffold` and `rsync -a --ignore-existing /tmp/scaffold/ .` (keep our `docs/`, `scripts/`, `.gitignore`, `tests/`).

- [ ] **Step 2: vitest config + test script**

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["src/**/*.test.ts"] } });
```
Add to package.json scripts: `"test": "vitest run", "worker": "tsx src/worker/index.ts"`.

- [ ] **Step 3: Write the failing env test**

```ts
// src/lib/env.test.ts
import { describe, expect, it } from "vitest";
import { loadEnv } from "./env";

const good = {
  SECRET_KEY: "a".repeat(64),
  APP_PASSWORD: "hunter2hunter2",
};

describe("loadEnv", () => {
  it("applies defaults", () => {
    const env = loadEnv(good as never);
    expect(env.CANVAS_BASE_URL).toBe("https://canvas.nus.edu.sg");
    expect(env.ANTHROPIC_MODEL).toBe("claude-haiku-4-5");
    expect(env.POLL_INTERVAL_MS).toBe(300000);
    expect(env.DATABASE_PATH).toBe("data/openpapr.db");
  });
  it("rejects a short SECRET_KEY", () => {
    expect(() => loadEnv({ ...good, SECRET_KEY: "abc" } as never)).toThrow();
  });
  it("coerces POLL_INTERVAL_MS from string", () => {
    expect(loadEnv({ ...good, POLL_INTERVAL_MS: "60000" } as never).POLL_INTERVAL_MS).toBe(60000);
  });
});
```

- [ ] **Step 4: Run to verify it fails** — `npx vitest run src/lib/env.test.ts` → FAIL (module not found).

- [ ] **Step 5: Implement**

```ts
// src/lib/env.ts
import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_PATH: z.string().default("data/openpapr.db"),
  SECRET_KEY: z.string().regex(/^[0-9a-f]{64}$/i, "SECRET_KEY must be 64 hex chars (openssl rand -hex 32)"),
  APP_PASSWORD: z.string().min(8),
  CANVAS_BASE_URL: z.string().url().default("https://canvas.nus.edu.sg"),
  MS_CLIENT_ID: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-haiku-4-5"),
  POLL_INTERVAL_MS: z.coerce.number().int().positive().default(300_000),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(raw: NodeJS.ProcessEnv = process.env): Env {
  return EnvSchema.parse(raw);
}
```

Write `.env.example` listing each var with a comment; `SECRET_KEY=` generated via `openssl rand -hex 32`.

- [ ] **Step 6: Run tests + build, commit**

Run: `npx vitest run src/lib/env.test.ts` → PASS. `npm run build` → succeeds.
```bash
git add -A && git commit -m "feat: scaffold Next.js app with vitest and env module"
```

---

### Task 4: Database schema + client

**Files:**
- Create: `src/db/schema.ts`, `src/db/client.ts`, `src/db/client.test.ts`, `drizzle.config.ts`, generated `drizzle/` migrations

**Interfaces:**
- Produces: all Drizzle table objects (`users`, `modules`, `components`, `items`, `syncRuns`) exported from `src/db/schema.ts` with the exact columns below; `createDb(path: string): Db` from `src/db/client.ts` (runs migrations; `":memory:"` supported), `type Db = ReturnType<typeof createDb>`.
- Item `type` enum: `"announcement" | "assignment" | "email" | "event" | "deadline_change"`. Component `source` enum: `"canvas_api" | "llm_syllabus" | "manual"`. Item `triage` enum: `"important" | "garbage" | "ambiguous" | "unscored"`. SyncRun `source` enum: `"canvas" | "graph" | "enrich"`.

- [ ] **Step 1: Write the failing round-trip test**

```ts
// src/db/client.test.ts
import { describe, expect, it } from "vitest";
import { createDb } from "./client";
import { users, items } from "./schema";
import { eq } from "drizzle-orm";

describe("createDb", () => {
  it("migrates an in-memory db and round-trips rows", () => {
    const db = createDb(":memory:");
    db.insert(users).values({ name: "aiden" }).run();
    const u = db.select().from(users).all();
    expect(u).toHaveLength(1);
    db.insert(items).values({
      userId: u[0].id, type: "email", source: "graph", sourceId: "mail:1",
      title: "hi", firstSeenAt: 123,
    }).run();
    expect(db.select().from(items).where(eq(items.sourceId, "mail:1")).all()[0].triage).toBeNull();
  });
  it("enforces the (userId, source, sourceId) unique index", () => {
    const db = createDb(":memory:");
    db.insert(users).values({ name: "a" }).run();
    const v = { userId: 1, type: "email" as const, source: "graph" as const, sourceId: "mail:1", title: "x", firstSeenAt: 1 };
    db.insert(items).values(v).run();
    expect(() => db.insert(items).values(v).run()).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/db/client.test.ts` → FAIL.

- [ ] **Step 3: Implement schema**

```ts
// src/db/schema.ts
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
  type: text("type", { enum: ["announcement", "assignment", "email", "event", "deadline_change"] }).notNull(),
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
}, (t) => [uniqueIndex("items_user_source").on(t.userId, t.source, t.sourceId)]);

export const syncRuns = sqliteTable("sync_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  source: text("source", { enum: ["canvas", "graph", "enrich"] }).notNull(),
  startedAt: integer("started_at").notNull(),
  finishedAt: integer("finished_at"),
  ok: integer("ok", { mode: "boolean" }),
  error: text("error"),
});
```

- [ ] **Step 4: Implement client + generate migrations**

```ts
// drizzle.config.ts
import { defineConfig } from "drizzle-kit";
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
```

```ts
// src/db/client.ts
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import * as schema from "./schema";

export function createDb(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: join(process.cwd(), "drizzle") });
  return db;
}
export type Db = ReturnType<typeof createDb>;
```

Run: `npx drizzle-kit generate` → creates `drizzle/0000_*.sql`. Check it in.

- [ ] **Step 5: Run tests, commit**

Run: `npx vitest run src/db/client.test.ts` → PASS.
```bash
git add -A && git commit -m "feat: drizzle schema, migrations, and db client"
```

---

### Task 5: Token crypto

**Files:**
- Create: `src/lib/crypto.ts`, `src/lib/crypto.test.ts`

**Interfaces:**
- Produces: `encrypt(plaintext: string, keyHex: string): string` and `decrypt(payload: string, keyHex: string): string`. Payload format: base64 of `iv(12) || authTag(16) || ciphertext`. Used by Task 8 (store refresh token), Task 13 (worker decrypts), and the setup path that stores the Canvas token.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/crypto.test.ts
import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "./crypto";

const key = "ab".repeat(32);

describe("crypto", () => {
  it("round-trips", () => {
    expect(decrypt(encrypt("secret token", key), key)).toBe("secret token");
  });
  it("produces different ciphertexts per call (random IV)", () => {
    expect(encrypt("x", key)).not.toBe(encrypt("x", key));
  });
  it("throws on tampered payload", () => {
    const p = Buffer.from(encrypt("x", key), "base64");
    p[p.length - 1] ^= 0xff;
    expect(() => decrypt(p.toString("base64"), key)).toThrow();
  });
  it("throws on wrong key", () => {
    expect(() => decrypt(encrypt("x", key), "cd".repeat(32))).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/lib/crypto.test.ts` → FAIL.

- [ ] **Step 3: Implement**

```ts
// src/lib/crypto.ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export function encrypt(plaintext: string, keyHex: string): string {
  const key = Buffer.from(keyHex, "hex");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function decrypt(payload: string, keyHex: string): string {
  const key = Buffer.from(keyHex, "hex");
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
```

- [ ] **Step 4: Run tests, commit**

Run: `npx vitest run src/lib/crypto.test.ts` → PASS.
```bash
git add src/lib/crypto.ts src/lib/crypto.test.ts && git commit -m "feat: aes-256-gcm token crypto"
```

---

### Task 6: Canvas client

**Files:**
- Create: `src/connectors/canvas/types.ts`, `src/connectors/canvas/client.ts`, `src/connectors/canvas/client.test.ts`
- Test fixtures: `tests/fixtures/canvas/courses.json`, `assignment_groups.json`, `announcements.json` (from Task 1; if not captured, hand-write matching the raw types below)

**Interfaces:**
- Consumes: `Env.CANVAS_BASE_URL`; a decrypted Canvas token.
- Produces from `client.ts`:
```ts
export function createCanvasClient(baseUrl: string, token: string, fetchFn: typeof fetch = fetch): CanvasClient;
export interface CanvasClient {
  listActiveCourses(): Promise<CanvasCourse[]>;
  listAssignmentGroups(courseId: number): Promise<CanvasAssignmentGroup[]>;
  listAnnouncements(courseId: number): Promise<CanvasAnnouncement[]>;
  listCalendarEvents(courseId: number): Promise<CanvasCalendarEvent[]>;
  listPages(courseId: number): Promise<CanvasPage[]>;
  getPageBody(courseId: number, slug: string): Promise<string>;
  listSyllabusFiles(courseId: number): Promise<CanvasFile[]>;   // search_term over syllabus/assessment/outline
  downloadFile(url: string): Promise<Uint8Array>;
}
```
- Produces from `types.ts` (raw Canvas shapes, only the fields we read):
```ts
export interface CanvasCourse { id: number; name: string; course_code: string; syllabus_body?: string | null; term?: { name: string } | null; }
export interface CanvasSubmission { workflow_state: string; score: number | null; }
export interface CanvasAssignment { id: number; name: string; due_at: string | null; html_url: string; points_possible: number | null; submission?: CanvasSubmission; }
export interface CanvasAssignmentGroup { id: number; name: string; group_weight: number | null; assignments?: CanvasAssignment[]; }
export interface CanvasAnnouncement { id: number; title: string; message: string; html_url: string; posted_at: string | null; }
export interface CanvasCalendarEvent { id: number; title: string; start_at: string | null; html_url: string; description: string | null; }
export interface CanvasPage { url: string; title: string; }
export interface CanvasFile { id: number; display_name: string; url: string; content_type: string; }
```

- [ ] **Step 1: Write the failing test (mock fetch, pagination via Link header)**

```ts
// src/connectors/canvas/client.test.ts
import { describe, expect, it, vi } from "vitest";
import { createCanvasClient } from "./client";

const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", ...headers } });

describe("createCanvasClient", () => {
  it("sends bearer auth and hits the courses endpoint", async () => {
    const fetchFn = vi.fn(async () => json([{ id: 1, name: "SE", course_code: "CS2103T" }]));
    const client = createCanvasClient("https://canvas.example", "tok", fetchFn as never);
    const courses = await client.listActiveCourses();
    expect(courses[0].course_code).toBe("CS2103T");
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/v1/courses?");
    expect(url).toContain("enrollment_state=active");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });
  it("follows Link rel=next pagination and concatenates pages", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(json([{ id: 1 }], { link: '<https://canvas.example/api/v1/courses?page=2>; rel="next", <x>; rel="last"' }))
      .mockResolvedValueOnce(json([{ id: 2 }]));
    const client = createCanvasClient("https://canvas.example", "tok", fetchFn as never);
    const courses = await client.listActiveCourses();
    expect(courses.map((c) => c.id)).toEqual([1, 2]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
  it("throws with status and body on non-2xx", async () => {
    const fetchFn = vi.fn(async () => new Response("nope", { status: 401 }));
    const client = createCanvasClient("https://canvas.example", "bad", fetchFn as never);
    await expect(client.listActiveCourses()).rejects.toThrow(/401/);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/connectors/canvas/client.test.ts` → FAIL.

- [ ] **Step 3: Implement**

```ts
// src/connectors/canvas/client.ts
import type {
  CanvasAnnouncement, CanvasAssignmentGroup, CanvasCalendarEvent,
  CanvasCourse, CanvasFile, CanvasPage,
} from "./types";

function nextLink(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const m = part.match(/<([^>]+)>;\s*rel="next"/);
    if (m) return m[1];
  }
  return null;
}

export function createCanvasClient(baseUrl: string, token: string, fetchFn: typeof fetch = fetch) {
  const headers = { Authorization: `Bearer ${token}` };

  async function getAllPages<T>(path: string): Promise<T[]> {
    let url: string | null = `${baseUrl}/api/v1${path}`;
    const out: T[] = [];
    while (url) {
      const res: Response = await fetchFn(url, { headers });
      if (!res.ok) throw new Error(`Canvas ${res.status} on ${url}: ${await res.text()}`);
      out.push(...((await res.json()) as T[]));
      url = nextLink(res.headers.get("link"));
    }
    return out;
  }

  async function getOne<T>(path: string): Promise<T> {
    const res = await fetchFn(`${baseUrl}/api/v1${path}`, { headers });
    if (!res.ok) throw new Error(`Canvas ${res.status} on ${path}: ${await res.text()}`);
    return (await res.json()) as T;
  }

  return {
    listActiveCourses: () =>
      getAllPages<CanvasCourse>("/courses?enrollment_state=active&per_page=100&include[]=term&include[]=syllabus_body"),
    listAssignmentGroups: (courseId: number) =>
      getAllPages<CanvasAssignmentGroup>(`/courses/${courseId}/assignment_groups?include[]=assignments&include[]=submission&per_page=100`),
    listAnnouncements: (courseId: number) =>
      getAllPages<CanvasAnnouncement>(`/courses/${courseId}/discussion_topics?only_announcements=true&per_page=50`),
    listCalendarEvents: (courseId: number) =>
      getAllPages<CanvasCalendarEvent>(`/calendar_events?type=event&context_codes[]=course_${courseId}&per_page=100`),
    listPages: (courseId: number) => getAllPages<CanvasPage>(`/courses/${courseId}/pages?per_page=100`),
    getPageBody: async (courseId: number, slug: string) =>
      (await getOne<{ body: string | null }>(`/courses/${courseId}/pages/${encodeURIComponent(slug)}`)).body ?? "",
    listSyllabusFiles: (courseId: number) =>
      getAllPages<CanvasFile>(`/courses/${courseId}/files?search_term=syllabus&per_page=50`),
    downloadFile: async (url: string) => {
      const res = await fetchFn(url, { headers });
      if (!res.ok) throw new Error(`Canvas file ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}
export type CanvasClient = ReturnType<typeof createCanvasClient>;
```
Also create `types.ts` exactly as in the Interfaces block.

- [ ] **Step 4: Run tests, commit**

Run: `npx vitest run src/connectors/canvas/client.test.ts` → PASS.
```bash
git add src/connectors/canvas/ && git commit -m "feat: canvas REST client with pagination"
```

---

### Task 7: Canvas normalizer + repo upserts

**Files:**
- Create: `src/connectors/canvas/normalize.ts`, `src/connectors/canvas/normalize.test.ts`, `src/db/repo.ts`, `src/db/repo.test.ts`

**Interfaces:**
- Consumes: raw types from Task 6, `Db` + tables from Task 4.
- Produces from `normalize.ts`:
```ts
export interface NormalizedItem {
  type: "announcement" | "assignment" | "event";
  sourceId: string;              // "assignment:123" | "announcement:9" | "event:4"
  title: string; body: string | null; url: string | null;
  dueAt: number | null; sourceCreatedAt: number | null; submitted: boolean;
}
export interface NormalizedCanvasSync {
  module: { canvasCourseId: number; code: string; name: string; term: string | null; syllabusBody: string | null };
  components: { name: string; weightPct: number; scorePct: number | null; source: "canvas_api" }[];
  items: NormalizedItem[];
}
export function moduleCodeFromCourse(courseCode: string): string;   // "CS2103T Software Engineering" → "CS2103T"
export function normalizeCanvasCourse(course: CanvasCourse, groups: CanvasAssignmentGroup[], announcements: CanvasAnnouncement[], events: CanvasCalendarEvent[]): NormalizedCanvasSync;
```
- Produces from `repo.ts`:
```ts
export function applyCanvasSync(db: Db, userId: number, sync: NormalizedCanvasSync, now: number): { moduleId: number };
// Upserts module by (userId, canvasCourseId). Upserts canvas_api components by (moduleId, name, source) — never touches manual/llm rows.
// Upserts items by (userId, "canvas", sourceId): insert new with firstSeenAt=now; update title/body/dueAt/submitted on existing.
// If an existing assignment's dueAt differs from the incoming one, ALSO inserts a deadline_change item
// (sourceId `${item.sourceId}:due:${newDueAt}`, title "Deadline moved: <name>", body "was <oldISO>, now <newISO>", firstSeenAt=now).
export function upsertMailItems(db: Db, userId: number, mails: MailItem[], now: number): void;   // MailItem defined in Task 9
```

- [ ] **Step 1: Write the failing normalizer test**

```ts
// src/connectors/canvas/normalize.test.ts
import { describe, expect, it } from "vitest";
import { moduleCodeFromCourse, normalizeCanvasCourse } from "./normalize";
import type { CanvasAnnouncement, CanvasAssignmentGroup, CanvasCourse } from "./types";

const course: CanvasCourse = { id: 7, name: "Software Engineering", course_code: "CS2103T Software Engineering", term: { name: "AY26/27 S1" }, syllabus_body: "<p>tP 45%</p>" };
const groups: CanvasAssignmentGroup[] = [
  { id: 1, name: "Finals", group_weight: 25, assignments: [] },
  { id: 2, name: "tP", group_weight: 45, assignments: [
    { id: 11, name: "tP v1.3", due_at: "2026-08-21T16:00:00Z", html_url: "u", points_possible: 100, submission: { workflow_state: "unsubmitted", score: null } },
  ]},
];
const ann: CanvasAnnouncement[] = [{ id: 9, title: "Venue change", message: "<p>MPSH2</p>", html_url: "a", posted_at: "2026-08-12T02:00:00Z" }];

describe("normalizeCanvasCourse", () => {
  it("extracts the module code", () => {
    expect(moduleCodeFromCourse("CS2103T Software Engineering")).toBe("CS2103T");
    expect(moduleCodeFromCourse("ST2334")).toBe("ST2334");
  });
  it("maps weighted groups to canvas_api components", () => {
    const n = normalizeCanvasCourse(course, groups, ann, []);
    expect(n.components).toEqual([
      { name: "Finals", weightPct: 25, scorePct: null, source: "canvas_api" },
      { name: "tP", weightPct: 45, scorePct: null, source: "canvas_api" },
    ]);
  });
  it("emits no components when no group has weight (prof didn't configure weights)", () => {
    const unweighted = groups.map((g) => ({ ...g, group_weight: 0 }));
    expect(normalizeCanvasCourse(course, unweighted, [], []).components).toEqual([]);
  });
  it("maps assignments and announcements to items with parsed timestamps", () => {
    const n = normalizeCanvasCourse(course, groups, ann, []);
    const a = n.items.find((i) => i.sourceId === "assignment:11")!;
    expect(a.type).toBe("assignment");
    expect(a.dueAt).toBe(Date.parse("2026-08-21T16:00:00Z"));
    expect(a.submitted).toBe(false);
    const an = n.items.find((i) => i.sourceId === "announcement:9")!;
    expect(an.type).toBe("announcement");
  });
  it("marks graded/submitted submissions", () => {
    const g = [{ ...groups[1], assignments: [{ ...groups[1].assignments![0], submission: { workflow_state: "submitted", score: null } }] }];
    expect(normalizeCanvasCourse(course, g, [], []).items[0].submitted).toBe(true);
  });
});
```

- [ ] **Step 2: Write the failing repo test**

```ts
// src/db/repo.test.ts
import { describe, expect, it } from "vitest";
import { createDb } from "./client";
import { items, components, users } from "./schema";
import { applyCanvasSync } from "./repo";
import { eq } from "drizzle-orm";
import type { NormalizedCanvasSync } from "../connectors/canvas/normalize";

const base: NormalizedCanvasSync = {
  module: { canvasCourseId: 7, code: "CS2103T", name: "SE", term: null, syllabusBody: null },
  components: [{ name: "tP", weightPct: 45, scorePct: null, source: "canvas_api" }],
  items: [{ type: "assignment", sourceId: "assignment:11", title: "tP v1.3", body: null, url: null, dueAt: 1000, sourceCreatedAt: null, submitted: false }],
};
const setup = () => {
  const db = createDb(":memory:");
  db.insert(users).values({ name: "a" }).run();
  return db;
};

describe("applyCanvasSync", () => {
  it("is idempotent — re-applying changes nothing", () => {
    const db = setup();
    applyCanvasSync(db, 1, base, 1);
    applyCanvasSync(db, 1, base, 2);
    expect(db.select().from(items).all()).toHaveLength(1);
    expect(db.select().from(components).all()).toHaveLength(1);
  });
  it("emits a deadline_change item when dueAt moves", () => {
    const db = setup();
    applyCanvasSync(db, 1, base, 1);
    const moved = { ...base, items: [{ ...base.items[0], dueAt: 2000 }] };
    applyCanvasSync(db, 1, moved, 5);
    const all = db.select().from(items).all();
    expect(all).toHaveLength(2);
    const change = all.find((i) => i.type === "deadline_change")!;
    expect(change.sourceId).toBe("assignment:11:due:2000");
    expect(all.find((i) => i.type === "assignment")!.dueAt).toBe(2000);
  });
  it("never overwrites manual components", () => {
    const db = setup();
    const { moduleId } = applyCanvasSync(db, 1, base, 1);
    db.insert(components).values({ moduleId, name: "tP", weightPct: 50, source: "manual" }).run();
    applyCanvasSync(db, 1, base, 2);
    const manual = db.select().from(components).where(eq(components.source, "manual")).all();
    expect(manual[0].weightPct).toBe(50);
  });
});
```

- [ ] **Step 3: Run both to verify they fail**, then implement `normalize.ts`:

```ts
// src/connectors/canvas/normalize.ts
import type { CanvasAnnouncement, CanvasAssignmentGroup, CanvasCalendarEvent, CanvasCourse } from "./types";

export interface NormalizedItem {
  type: "announcement" | "assignment" | "event";
  sourceId: string;
  title: string; body: string | null; url: string | null;
  dueAt: number | null; sourceCreatedAt: number | null; submitted: boolean;
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
```

- [ ] **Step 4: Implement `repo.ts`**

```ts
// src/db/repo.ts
import { and, eq } from "drizzle-orm";
import type { Db } from "./client";
import { components, items, modules } from "./schema";
import type { NormalizedCanvasSync } from "../connectors/canvas/normalize";
import type { MailItem } from "../connectors/graph/normalize";

export function applyCanvasSync(db: Db, userId: number, sync: NormalizedCanvasSync, now: number): { moduleId: number } {
  const mod = db.insert(modules).values({ userId, ...sync.module })
    .onConflictDoUpdate({
      target: [modules.userId, modules.canvasCourseId],
      set: { code: sync.module.code, name: sync.module.name, term: sync.module.term, syllabusBody: sync.module.syllabusBody, active: true },
    }).returning().get();

  for (const c of sync.components) {
    db.insert(components).values({ moduleId: mod.id, ...c })
      .onConflictDoUpdate({
        target: [components.moduleId, components.name, components.source],
        set: { weightPct: c.weightPct, scorePct: c.scorePct },
      }).run();
  }

  for (const it of sync.items) {
    const existing = db.select().from(items)
      .where(and(eq(items.userId, userId), eq(items.source, "canvas"), eq(items.sourceId, it.sourceId))).get();
    if (!existing) {
      db.insert(items).values({ userId, moduleId: mod.id, source: "canvas", firstSeenAt: now, ...it }).run();
      continue;
    }
    if (it.type === "assignment" && existing.dueAt !== null && it.dueAt !== null && existing.dueAt !== it.dueAt) {
      db.insert(items).values({
        userId, moduleId: mod.id, type: "deadline_change", source: "canvas",
        sourceId: `${it.sourceId}:due:${it.dueAt}`, title: `Deadline moved: ${it.title}`,
        body: `was ${new Date(existing.dueAt).toISOString()}, now ${new Date(it.dueAt).toISOString()}`,
        url: it.url, firstSeenAt: now,
      }).onConflictDoNothing().run();
    }
    db.update(items).set({ title: it.title, body: it.body, url: it.url, dueAt: it.dueAt, submitted: it.submitted })
      .where(eq(items.id, existing.id)).run();
  }
  return { moduleId: mod.id };
}

export function upsertMailItems(db: Db, userId: number, mails: MailItem[], now: number): void {
  for (const m of mails) {
    db.insert(items).values({ userId, source: "graph", type: "email", firstSeenAt: now, triage: "unscored", ...m })
      .onConflictDoNothing().run();
  }
}
```
Note: `MailItem` doesn't exist until Task 9 — create a placeholder `src/connectors/graph/normalize.ts` exporting only `export interface MailItem { sourceId: string; title: string; body: string | null; url: string | null; sender: string | null; sourceCreatedAt: number | null; moduleId?: number | null }` now; Task 9 fills in the function.

- [ ] **Step 5: Run all tests, commit**

Run: `npx vitest run` → all PASS.
```bash
git add -A && git commit -m "feat: canvas normalizer and idempotent repo upserts with deadline-change detection"
```

---

### Task 8: Graph auth + delta client + connect script

**Files:**
- Create: `src/connectors/graph/auth.ts`, `src/connectors/graph/client.ts`, `src/connectors/graph/client.test.ts`, `src/connectors/graph/auth.test.ts`, `scripts/connect-microsoft.ts`

**Interfaces:**
- Consumes: `MS_CLIENT_ID` from env; `encrypt` from Task 5; `users` table from Task 4. Device-code flow was proven in Task 2.
- Produces:
```ts
// auth.ts
export interface DeviceCodeInfo { verificationUri: string; userCode: string; }
export async function runDeviceCodeFlow(clientId: string, onCode: (info: DeviceCodeInfo) => void, fetchFn?: typeof fetch): Promise<{ accessToken: string; refreshToken: string }>;
export async function refreshAccessToken(clientId: string, refreshToken: string, fetchFn?: typeof fetch): Promise<{ accessToken: string; refreshToken: string }>; // Entra rotates refresh tokens — always persist the returned one
// client.ts
export interface GraphMessage { id: string; subject: string | null; bodyPreview: string | null; webLink: string | null; receivedDateTime: string | null; from?: { emailAddress?: { name?: string; address?: string } }; }
export async function fetchInboxDelta(accessToken: string, deltaLink: string | null, fetchFn?: typeof fetch): Promise<{ messages: GraphMessage[]; deltaLink: string }>;
```

- [ ] **Step 1: Write the failing tests**

```ts
// src/connectors/graph/auth.test.ts
import { describe, expect, it, vi } from "vitest";
import { refreshAccessToken } from "./auth";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

describe("refreshAccessToken", () => {
  it("posts the refresh grant and returns rotated tokens", async () => {
    const fetchFn = vi.fn(async () => json({ access_token: "at2", refresh_token: "rt2" }));
    const out = await refreshAccessToken("cid", "rt1", fetchFn as never);
    expect(out).toEqual({ accessToken: "at2", refreshToken: "rt2" });
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/organizations/oauth2/v2.0/token");
    const body = init.body as URLSearchParams;
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("rt1");
    expect(body.get("scope")).toBe("offline_access Mail.Read");
  });
  it("keeps the old refresh token if the response omits one", async () => {
    const fetchFn = vi.fn(async () => json({ access_token: "at2" }));
    expect((await refreshAccessToken("cid", "rt1", fetchFn as never)).refreshToken).toBe("rt1");
  });
  it("throws on error responses", async () => {
    const fetchFn = vi.fn(async () => json({ error: "invalid_grant", error_description: "expired" }, 400));
    await expect(refreshAccessToken("cid", "rt1", fetchFn as never)).rejects.toThrow(/invalid_grant/);
  });
});
```

```ts
// src/connectors/graph/client.test.ts
import { describe, expect, it, vi } from "vitest";
import { fetchInboxDelta } from "./client";

const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });

describe("fetchInboxDelta", () => {
  it("starts from the base delta URL when deltaLink is null and follows nextLink", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(json({ value: [{ id: "m1", subject: "a" }], "@odata.nextLink": "https://graph.microsoft.com/v1.0/next" }))
      .mockResolvedValueOnce(json({ value: [{ id: "m2", subject: "b" }], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/delta?token=T" }));
    const out = await fetchInboxDelta("tok", null, fetchFn as never);
    expect(out.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(out.deltaLink).toContain("token=T");
    expect((fetchFn.mock.calls[0][0] as string)).toContain("/me/mailFolders/inbox/messages/delta");
  });
  it("resumes from a stored deltaLink", async () => {
    const fetchFn = vi.fn(async () => json({ value: [], "@odata.deltaLink": "https://d2" }));
    await fetchInboxDelta("tok", "https://d1", fetchFn as never);
    expect(fetchFn.mock.calls[0][0]).toBe("https://d1");
  });
  it("throws on 401 so the worker can surface reconnect", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 401 }));
    await expect(fetchInboxDelta("tok", null, fetchFn as never)).rejects.toThrow(/401/);
  });
});
```

- [ ] **Step 2: Run to verify both fail**, then implement:

```ts
// src/connectors/graph/auth.ts
const TOKEN_URL = "https://login.microsoftonline.com/organizations/oauth2/v2.0/token";
const DEVICE_URL = "https://login.microsoftonline.com/organizations/oauth2/v2.0/devicecode";
const SCOPE = "offline_access Mail.Read";

export interface DeviceCodeInfo { verificationUri: string; userCode: string; }

export async function runDeviceCodeFlow(clientId: string, onCode: (info: DeviceCodeInfo) => void, fetchFn: typeof fetch = fetch) {
  let res = await fetchFn(DEVICE_URL, { method: "POST", body: new URLSearchParams({ client_id: clientId, scope: SCOPE }) });
  const dc = (await res.json()) as { device_code: string; user_code: string; verification_uri: string; interval?: number; error?: string };
  if (!dc.device_code) throw new Error(`devicecode failed: ${JSON.stringify(dc)}`);
  onCode({ verificationUri: dc.verification_uri, userCode: dc.user_code });
  for (;;) {
    await new Promise((r) => setTimeout(r, (dc.interval ?? 5) * 1000));
    res = await fetchFn(TOKEN_URL, {
      method: "POST",
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", client_id: clientId, device_code: dc.device_code }),
    });
    const tok = (await res.json()) as { access_token?: string; refresh_token?: string; error?: string; error_description?: string };
    if (tok.access_token) return { accessToken: tok.access_token, refreshToken: tok.refresh_token ?? "" };
    if (tok.error !== "authorization_pending") throw new Error(`${tok.error}: ${tok.error_description}`);
  }
}

export async function refreshAccessToken(clientId: string, refreshToken: string, fetchFn: typeof fetch = fetch) {
  const res = await fetchFn(TOKEN_URL, {
    method: "POST",
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: clientId, refresh_token: refreshToken, scope: SCOPE }),
  });
  const tok = (await res.json()) as { access_token?: string; refresh_token?: string; error?: string; error_description?: string };
  if (!tok.access_token) throw new Error(`${tok.error}: ${tok.error_description}`);
  return { accessToken: tok.access_token, refreshToken: tok.refresh_token ?? refreshToken };
}
```

```ts
// src/connectors/graph/client.ts
export interface GraphMessage {
  id: string; subject: string | null; bodyPreview: string | null; webLink: string | null;
  receivedDateTime: string | null;
  from?: { emailAddress?: { name?: string; address?: string } };
}
const BASE = "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$select=subject,from,bodyPreview,receivedDateTime,webLink";

export async function fetchInboxDelta(accessToken: string, deltaLink: string | null, fetchFn: typeof fetch = fetch) {
  let url = deltaLink ?? BASE;
  const messages: GraphMessage[] = [];
  for (;;) {
    const res = await fetchFn(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new Error(`Graph ${res.status}: ${await res.text()}`);
    const page = (await res.json()) as { value?: GraphMessage[]; "@odata.nextLink"?: string; "@odata.deltaLink"?: string };
    messages.push(...(page.value ?? []));
    if (page["@odata.nextLink"]) { url = page["@odata.nextLink"]; continue; }
    return { messages, deltaLink: page["@odata.deltaLink"] ?? url };
  }
}
```

- [ ] **Step 3: Write the connect script (manually verified, no unit test)**

```ts
// scripts/connect-microsoft.ts — run: npx tsx scripts/connect-microsoft.ts [--user 1]
import { createDb } from "../src/db/client";
import { users } from "../src/db/schema";
import { loadEnv } from "../src/lib/env";
import { encrypt } from "../src/lib/crypto";
import { runDeviceCodeFlow } from "../src/connectors/graph/auth";
import { eq } from "drizzle-orm";

const env = loadEnv();
if (!env.MS_CLIENT_ID) throw new Error("Set MS_CLIENT_ID");
const userId = Number(process.argv[process.argv.indexOf("--user") + 1] || 1);
const db = createDb(env.DATABASE_PATH);
const { refreshToken } = await runDeviceCodeFlow(env.MS_CLIENT_ID, (i) =>
  console.log(`\n>>> Open ${i.verificationUri} and enter code: ${i.userCode}\n`));
if (!refreshToken) throw new Error("No refresh token returned — check offline_access scope");
db.update(users).set({ msRefreshTokenEnc: encrypt(refreshToken, env.SECRET_KEY), msDeltaLink: null })
  .where(eq(users.id, userId)).run();
console.log(`Stored encrypted refresh token for user ${userId}.`);
```

- [ ] **Step 4: Run tests, verify script manually once, commit**

Run: `npx vitest run src/connectors/graph/` → PASS. Then create a user row (`npx tsx -e "..."` insert or via Task 16's seed later) and run the connect script end-to-end once against the real NUS account.
```bash
git add src/connectors/graph/ scripts/connect-microsoft.ts && git commit -m "feat: graph device-code auth, token refresh, and inbox delta client"
```

---

### Task 9: Mail normalizer + module-code linking

**Files:**
- Modify: `src/connectors/graph/normalize.ts` (replace Task 7's placeholder)
- Create: `src/connectors/graph/normalize.test.ts`

**Interfaces:**
- Consumes: `GraphMessage` from Task 8; `detectModuleCodes` from Task 10 — **implement Task 10's `src/enrich/rules.ts` `MODULE_CODE_RE`/`detectModuleCodes` first if executing out of order** (they have no dependencies).
- Produces:
```ts
export interface MailItem {
  sourceId: string;              // `mail:${graph id}`
  title: string; body: string | null; url: string | null;
  sender: string | null;         // email address
  sourceCreatedAt: number | null;
  moduleId?: number | null;
}
export function normalizeMail(msg: GraphMessage): MailItem;
export function linkMailToModule(mail: MailItem, modulesByCode: Map<string, number>): MailItem; // sets moduleId when a known code appears in title or body
```

- [ ] **Step 1: Write the failing test**

```ts
// src/connectors/graph/normalize.test.ts
import { describe, expect, it } from "vitest";
import { linkMailToModule, normalizeMail } from "./normalize";

const msg = {
  id: "AAMk1", subject: "CS2103T midterm venue", bodyPreview: "moved to MPSH2",
  webLink: "https://outlook.example/1", receivedDateTime: "2026-08-12T03:02:00Z",
  from: { emailAddress: { name: "Prof Tan", address: "tankl@nus.edu.sg" } },
};

describe("normalizeMail", () => {
  it("maps graph fields", () => {
    const m = normalizeMail(msg);
    expect(m).toEqual({
      sourceId: "mail:AAMk1", title: "CS2103T midterm venue", body: "moved to MPSH2",
      url: "https://outlook.example/1", sender: "tankl@nus.edu.sg",
      sourceCreatedAt: Date.parse("2026-08-12T03:02:00Z"), moduleId: null,
    });
  });
  it("tolerates null subject", () => {
    expect(normalizeMail({ ...msg, subject: null }).title).toBe("(no subject)");
  });
});

describe("linkMailToModule", () => {
  const byCode = new Map([["CS2103T", 42], ["ST2334", 43]]);
  it("links by code in the subject", () => {
    expect(linkMailToModule(normalizeMail(msg), byCode).moduleId).toBe(42);
  });
  it("leaves unknown codes unlinked", () => {
    const m = normalizeMail({ ...msg, subject: "EC1301 briefing", bodyPreview: "" });
    expect(linkMailToModule(m, byCode).moduleId).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**, then implement:

```ts
// src/connectors/graph/normalize.ts
import type { GraphMessage } from "./client";
import { detectModuleCodes } from "../../enrich/rules";

export interface MailItem {
  sourceId: string; title: string; body: string | null; url: string | null;
  sender: string | null; sourceCreatedAt: number | null; moduleId?: number | null;
}

export function normalizeMail(msg: GraphMessage): MailItem {
  return {
    sourceId: `mail:${msg.id}`,
    title: msg.subject ?? "(no subject)",
    body: msg.bodyPreview ?? null,
    url: msg.webLink ?? null,
    sender: msg.from?.emailAddress?.address ?? null,
    sourceCreatedAt: msg.receivedDateTime ? Date.parse(msg.receivedDateTime) : null,
    moduleId: null,
  };
}

export function linkMailToModule(mail: MailItem, modulesByCode: Map<string, number>): MailItem {
  for (const code of detectModuleCodes(`${mail.title} ${mail.body ?? ""}`)) {
    const id = modulesByCode.get(code);
    if (id !== undefined) return { ...mail, moduleId: id };
  }
  return mail;
}
```

- [ ] **Step 3: Run tests, commit**

Run: `npx vitest run src/connectors/graph/normalize.test.ts` → PASS.
```bash
git add src/connectors/graph/ && git commit -m "feat: mail normalizer with module-code linking"
```

---

### Task 10: Rule-based triage

**Files:**
- Create: `src/enrich/rules.ts`, `src/enrich/rules.test.ts`

**Interfaces:**
- Produces:
```ts
export const MODULE_CODE_RE: RegExp;                       // /\b[A-Z]{2,3}\d{4}[A-Z]{0,3}\b/g
export function detectModuleCodes(text: string): string[]; // unique, order of appearance
export interface TriageInput { sender: string | null; title: string; body: string | null; moduleId?: number | null; }
export interface TriageContext { activeCodes: string[]; }
export type RuleVerdict = { verdict: "important" | "garbage" | "ambiguous"; reason: string };
export function triageEmail(mail: TriageInput, ctx: TriageContext): RuleVerdict;
```
- Rule order (first match wins): (1) linked to a module or an active code in subject/body → important; (2) urgent keywords in subject (`deadline|exam|midterm|quiz|grade|s\/u|assessment|submission`) → important; (3) bulk markers (`unsubscribe`, `newsletter`, `view in browser`, sender local-part starts `noreply`/`no-reply`/`donotreply`) → garbage; (4) everything else → ambiguous. Important outranks garbage deliberately — a prof's mail with an unsubscribe footer must not be hidden (fail-open).

- [ ] **Step 1: Write the failing test**

```ts
// src/enrich/rules.test.ts
import { describe, expect, it } from "vitest";
import { detectModuleCodes, triageEmail } from "./rules";

const ctx = { activeCodes: ["CS2103T", "ST2334"] };
const mail = (over: Partial<Parameters<typeof triageEmail>[0]>) =>
  triageEmail({ sender: "x@nus.edu.sg", title: "hello", body: "", moduleId: null, ...over }, ctx);

describe("detectModuleCodes", () => {
  it("finds NUS-style codes, deduplicated", () => {
    expect(detectModuleCodes("CS2103T and ST2334 and CS2103T")).toEqual(["CS2103T", "ST2334"]);
  });
  it("ignores lowercase and random words", () => {
    expect(detectModuleCodes("cs2103t hello ABC12")).toEqual([]);
  });
});

describe("triageEmail", () => {
  it("marks module-linked mail important", () => {
    expect(mail({ title: "CS2103T tutorial swap" }).verdict).toBe("important");
  });
  it("marks urgent-keyword mail important", () => {
    expect(mail({ title: "Reminder: S/U deadline 20 Aug" }).verdict).toBe("important");
  });
  it("marks newsletters garbage", () => {
    expect(mail({ sender: "noreply@events.nus.edu.sg", body: "Click unsubscribe to stop" }).verdict).toBe("garbage");
  });
  it("important outranks bulk markers (fail-open)", () => {
    expect(mail({ title: "ST2334 quiz", body: "unsubscribe" }).verdict).toBe("important");
  });
  it("defaults to ambiguous", () => {
    expect(mail({ title: "Lunch?" }).verdict).toBe("ambiguous");
  });
  it("every verdict carries a reason", () => {
    expect(mail({ title: "Lunch?" }).reason.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**, then implement:

```ts
// src/enrich/rules.ts
export const MODULE_CODE_RE = /\b[A-Z]{2,3}\d{4}[A-Z]{0,3}\b/g;

export function detectModuleCodes(text: string): string[] {
  return [...new Set(text.match(MODULE_CODE_RE) ?? [])];
}

export interface TriageInput { sender: string | null; title: string; body: string | null; moduleId?: number | null; }
export interface TriageContext { activeCodes: string[]; }
export type RuleVerdict = { verdict: "important" | "garbage" | "ambiguous"; reason: string };

const URGENT_RE = /\b(deadline|exam|midterm|quiz|grade|s\/u|assessment|submission)\b/i;
const BULK_RE = /\b(unsubscribe|newsletter|view in browser)\b/i;
const NOREPLY_RE = /^(no-?reply|donotreply)/i;

export function triageEmail(mail: TriageInput, ctx: TriageContext): RuleVerdict {
  const text = `${mail.title} ${mail.body ?? ""}`;
  const codes = detectModuleCodes(text).filter((c) => ctx.activeCodes.includes(c));
  if (mail.moduleId != null || codes.length > 0)
    return { verdict: "important", reason: `mentions your module ${codes[0] ?? ""}`.trim() };
  if (URGENT_RE.test(mail.title))
    return { verdict: "important", reason: `subject mentions ${mail.title.match(URGENT_RE)![0].toLowerCase()}` };
  if (BULK_RE.test(text) || NOREPLY_RE.test(mail.sender?.split("@")[0] ?? ""))
    return { verdict: "garbage", reason: "bulk mail markers" };
  return { verdict: "ambiguous", reason: "no rule matched" };
}
```

- [ ] **Step 3: Run tests, commit**

Run: `npx vitest run src/enrich/rules.test.ts` → PASS.
```bash
git add src/enrich/ && git commit -m "feat: rule-based email triage with fail-open ordering"
```

---

### Task 11: LLM email scorer

**Files:**
- Create: `src/enrich/llm.ts`, `src/enrich/llm.test.ts`

**Interfaces:**
- Consumes: `@anthropic-ai/sdk` (`client.messages.parse` + `zodOutputFormat`), `ANTHROPIC_MODEL` from env.
- Produces:
```ts
export interface LlmScore { triage: "important" | "garbage" | "ambiguous" | "unscored"; importance: number | null; reason: string; }
export function createScorer(client: Anthropic, model: string): (mail: { sender: string | null; title: string; body: string | null }) => Promise<LlmScore>;
```
- Semantics: LLM returns `{ important: boolean, score: 0..1, reason }`. Mapping: `score >= 0.6` → important; `score <= 0.2` → garbage; else ambiguous (shown in feed). Any thrown error → `{ triage: "unscored", importance: null, reason: "llm unavailable" }` — **fail-open, never throws**.

- [ ] **Step 1: Write the failing test (mock the SDK client object)**

```ts
// src/enrich/llm.test.ts
import { describe, expect, it, vi } from "vitest";
import { createScorer } from "./llm";

const mkClient = (impl: () => Promise<unknown>) =>
  ({ messages: { parse: vi.fn(impl) } }) as never;
const mail = { sender: "reg@nus.edu.sg", title: "S/U closes", body: "20 Aug" };

describe("createScorer", () => {
  it("maps a high score to important", async () => {
    const client = mkClient(async () => ({ parsed_output: { important: true, score: 0.9, reason: "registrar deadline" } }));
    expect(await createScorer(client, "claude-haiku-4-5")(mail)).toEqual({ triage: "important", importance: 0.9, reason: "registrar deadline" });
  });
  it("maps a low score to garbage", async () => {
    const client = mkClient(async () => ({ parsed_output: { important: false, score: 0.05, reason: "promo blast" } }));
    expect((await createScorer(client, "m")(mail)).triage).toBe("garbage");
  });
  it("maps mid scores to ambiguous (shown)", async () => {
    const client = mkClient(async () => ({ parsed_output: { important: false, score: 0.4, reason: "unclear" } }));
    expect((await createScorer(client, "m")(mail)).triage).toBe("ambiguous");
  });
  it("fails open on SDK errors", async () => {
    const client = mkClient(async () => { throw new Error("529"); });
    expect(await createScorer(client, "m")(mail)).toEqual({ triage: "unscored", importance: null, reason: "llm unavailable" });
  });
  it("fails open on null parsed_output", async () => {
    const client = mkClient(async () => ({ parsed_output: null }));
    expect((await createScorer(client, "m")(mail)).triage).toBe("unscored");
  });
});
```

- [ ] **Step 2: Run to verify it fails**, then implement:

```ts
// src/enrich/llm.ts
import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

const EmailScore = z.object({
  important: z.boolean(),
  score: z.number(),          // 0..1, how likely this email matters to the student
  reason: z.string(),         // one short line, shown in the UI
});

export interface LlmScore { triage: "important" | "garbage" | "ambiguous" | "unscored"; importance: number | null; reason: string; }

const SYSTEM = `You triage university email for an NUS undergraduate. Important: anything from professors or the university that affects their modules, grades, deadlines, exams, or enrolment. Garbage: newsletters, event promotion, mass CC blasts, vendor marketing. Score 0..1 (1 = must see today). Give a one-line reason a student can read at a glance.`;

export function createScorer(client: Anthropic, model: string) {
  return async (mail: { sender: string | null; title: string; body: string | null }): Promise<LlmScore> => {
    try {
      const res = await client.messages.parse({
        model,
        max_tokens: 1024,
        system: SYSTEM,
        messages: [{ role: "user", content: `From: ${mail.sender ?? "unknown"}\nSubject: ${mail.title}\n\n${(mail.body ?? "").slice(0, 2000)}` }],
        output_config: { format: zodOutputFormat(EmailScore) },
      });
      const out = res.parsed_output;
      if (!out) return { triage: "unscored", importance: null, reason: "llm unavailable" };
      const triage = out.score >= 0.6 ? "important" : out.score <= 0.2 ? "garbage" : "ambiguous";
      return { triage, importance: out.score, reason: out.reason };
    } catch {
      return { triage: "unscored", importance: null, reason: "llm unavailable" };
    }
  };
}
```

- [ ] **Step 3: Run tests, commit**

Run: `npx vitest run src/enrich/llm.test.ts` → PASS.
```bash
git add src/enrich/llm.ts src/enrich/llm.test.ts && git commit -m "feat: fail-open LLM email scorer with structured output"
```

---

### Task 12: Weightage extractor

**Files:**
- Create: `src/enrich/weightage.ts`, `src/enrich/weightage.test.ts`

**Interfaces:**
- Consumes: Anthropic client (same pattern as Task 11); syllabus sources gathered by the worker (Task 13) from Task 6's `syllabus_body`, page bodies, and syllabus-named PDFs.
- Produces:
```ts
export interface WeightageSourceText { label: string; text: string; }        // e.g. { label: "Canvas syllabus page", text: "<p>tP 45%…" }
export interface WeightageSourcePdf { label: string; base64: string; }       // base64 of a syllabus PDF
export interface ExtractedComponent { name: string; weightPct: number; evidence: string; }
export function createWeightageExtractor(client: Anthropic, model: string):
  (texts: WeightageSourceText[], pdfs?: WeightageSourcePdf[]) => Promise<ExtractedComponent[] | null>;
```
- Semantics: returns `null` (module card shows "weightage unknown — add manually") when: no sources, LLM reports `found: false`, weights sum outside [90, 110], or any error. Never fabricates.

- [ ] **Step 1: Write the failing test**

```ts
// src/enrich/weightage.test.ts
import { describe, expect, it, vi } from "vitest";
import { createWeightageExtractor } from "./weightage";

const mkClient = (impl: (args: unknown) => Promise<unknown>) => ({ messages: { parse: vi.fn(impl) } }) as never;
const good = { found: true, components: [
  { name: "Final exam", weight_pct: 25, evidence: "Final exam: 25%" },
  { name: "tP", weight_pct: 45, evidence: "team project (45%)" },
  { name: "iP", weight_pct: 15, evidence: "iP 15%" },
  { name: "Participation", weight_pct: 15, evidence: "participation 15%" },
]};

describe("createWeightageExtractor", () => {
  it("returns camelCased components when weights sum to ~100", async () => {
    const ex = createWeightageExtractor(mkClient(async () => ({ parsed_output: good })), "m");
    const out = await ex([{ label: "syllabus", text: "..." }]);
    expect(out).toHaveLength(4);
    expect(out![0]).toEqual({ name: "Final exam", weightPct: 25, evidence: "Final exam: 25%" });
  });
  it("returns null when the sum is far from 100", async () => {
    const bad = { ...good, components: good.components.slice(0, 2) }; // sums to 70
    const ex = createWeightageExtractor(mkClient(async () => ({ parsed_output: bad })), "m");
    expect(await ex([{ label: "s", text: "x" }])).toBeNull();
  });
  it("returns null when found=false, with no fabrication", async () => {
    const ex = createWeightageExtractor(mkClient(async () => ({ parsed_output: { found: false, components: [] } })), "m");
    expect(await ex([{ label: "s", text: "no weightage here" }])).toBeNull();
  });
  it("returns null with no sources without calling the LLM", async () => {
    const parse = vi.fn();
    const ex = createWeightageExtractor({ messages: { parse } } as never, "m");
    expect(await ex([])).toBeNull();
    expect(parse).not.toHaveBeenCalled();
  });
  it("returns null on errors", async () => {
    const ex = createWeightageExtractor(mkClient(async () => { throw new Error("boom"); }), "m");
    expect(await ex([{ label: "s", text: "x" }])).toBeNull();
  });
  it("sends PDFs as document blocks", async () => {
    const parse = vi.fn(async () => ({ parsed_output: good }));
    const ex = createWeightageExtractor({ messages: { parse } } as never, "m");
    await ex([{ label: "s", text: "x" }], [{ label: "syllabus.pdf", base64: "QUJD" }]);
    const req = parse.mock.calls[0][0] as { messages: { content: { type: string }[] }[] };
    expect(req.messages[0].content.some((b) => b.type === "document")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**, then implement:

```ts
// src/enrich/weightage.ts
import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

const WeightageResult = z.object({
  found: z.boolean(),
  components: z.array(z.object({
    name: z.string(),
    weight_pct: z.number(),
    evidence: z.string(),      // verbatim quote from the source the number came from
  })),
});

export interface WeightageSourceText { label: string; text: string; }
export interface WeightageSourcePdf { label: string; base64: string; }
export interface ExtractedComponent { name: string; weightPct: number; evidence: string; }

const SYSTEM = `You extract assessment component weightage from university course materials. Report only weightings explicitly stated in the sources, quoting the exact sentence as evidence. If the sources do not state a complete weightage breakdown, set found=false and return no components — never guess or fill gaps.`;

export function createWeightageExtractor(client: Anthropic, model: string) {
  return async (texts: WeightageSourceText[], pdfs: WeightageSourcePdf[] = []): Promise<ExtractedComponent[] | null> => {
    if (texts.length === 0 && pdfs.length === 0) return null;
    try {
      const content: Anthropic.ContentBlockParam[] = [
        ...pdfs.map((p) => ({
          type: "document" as const,
          source: { type: "base64" as const, media_type: "application/pdf" as const, data: p.base64 },
          title: p.label,
        })),
        {
          type: "text" as const,
          text: texts.map((t) => `=== ${t.label} ===\n${t.text.slice(0, 20_000)}`).join("\n\n")
            + "\n\nExtract the assessment weightage breakdown for this module.",
        },
      ];
      const res = await client.messages.parse({
        model, max_tokens: 2048, system: SYSTEM,
        messages: [{ role: "user", content }],
        output_config: { format: zodOutputFormat(WeightageResult) },
      });
      const out = res.parsed_output;
      if (!out || !out.found || out.components.length === 0) return null;
      const sum = out.components.reduce((s, c) => s + c.weight_pct, 0);
      if (sum < 90 || sum > 110) return null;
      return out.components.map((c) => ({ name: c.name, weightPct: c.weight_pct, evidence: c.evidence }));
    } catch {
      return null;
    }
  };
}
```

- [ ] **Step 3: Run tests, commit**

Run: `npx vitest run src/enrich/weightage.test.ts` → PASS.
```bash
git add src/enrich/weightage.ts src/enrich/weightage.test.ts && git commit -m "feat: evidence-quoting weightage extractor with sum validation"
```

---

### Task 13: Worker loop

**Files:**
- Create: `src/worker/sync.ts`, `src/worker/sync.test.ts`, `src/worker/index.ts`

**Interfaces:**
- Consumes: everything from Tasks 4–12.
- Produces:
```ts
// sync.ts — pure orchestration, all effects injected
export interface SyncDeps {
  db: Db;
  now: () => number;
  canvasSync: (userId: number) => Promise<void>;   // fetch + normalize + applyCanvasSync + weightage refresh
  mailSync: (userId: number) => Promise<void>;     // delta fetch + normalize + upsertMailItems + persist deltaLink/refresh token
  enrich: (userId: number) => Promise<void>;       // rules pass + LLM pass over triage IS NULL / 'unscored' emails
}
export async function runUserSync(deps: SyncDeps, userId: number): Promise<void>;
// For each source in ["canvas","graph","enrich"]: insert syncRuns start row; run; update with ok/error.
// A throwing source records error and CONTINUES to the next source (isolation).
export function computeBackoffMs(consecutiveFailures: number, baseMs: number): number; // min(baseMs * 2^n, 3_600_000)
```
- `index.ts` wires the real deps (decrypt tokens, build clients, weightage refresh only for modules with no `llm_syllabus`/`canvas_api`/`manual` components yet or on `--refresh-weightage`) and loops: `runUserSync` per user, sleep `POLL_INTERVAL_MS` (per-source backoff applied via `computeBackoffMs` and the last failed `syncRuns` row).

- [ ] **Step 1: Write the failing test**

```ts
// src/worker/sync.test.ts
import { describe, expect, it, vi } from "vitest";
import { createDb } from "../db/client";
import { syncRuns, users } from "../db/schema";
import { computeBackoffMs, runUserSync } from "./sync";

const setup = () => {
  const db = createDb(":memory:");
  db.insert(users).values({ name: "a" }).run();
  return db;
};

describe("runUserSync", () => {
  it("records ok sync_runs for each source", async () => {
    const db = setup();
    await runUserSync({ db, now: () => 5, canvasSync: async () => {}, mailSync: async () => {}, enrich: async () => {} }, 1);
    const runs = db.select().from(syncRuns).all();
    expect(runs.map((r) => [r.source, r.ok])).toEqual([["canvas", true], ["graph", true], ["enrich", true]]);
    expect(runs.every((r) => r.finishedAt === 5)).toBe(true);
  });
  it("isolates failures: canvas throwing still runs graph and enrich", async () => {
    const db = setup();
    const mailSync = vi.fn(async () => {});
    await runUserSync({ db, now: () => 1, canvasSync: async () => { throw new Error("canvas down"); }, mailSync, enrich: async () => {} }, 1);
    expect(mailSync).toHaveBeenCalled();
    const canvasRun = db.select().from(syncRuns).all().find((r) => r.source === "canvas")!;
    expect(canvasRun.ok).toBe(false);
    expect(canvasRun.error).toContain("canvas down");
  });
});

describe("computeBackoffMs", () => {
  it("doubles per failure and caps at 1h", () => {
    expect(computeBackoffMs(0, 300_000)).toBe(300_000);
    expect(computeBackoffMs(2, 300_000)).toBe(1_200_000);
    expect(computeBackoffMs(10, 300_000)).toBe(3_600_000);
  });
});
```

- [ ] **Step 2: Run to verify it fails**, then implement:

```ts
// src/worker/sync.ts
import type { Db } from "../db/client";
import { syncRuns } from "../db/schema";
import { eq } from "drizzle-orm";

export interface SyncDeps {
  db: Db; now: () => number;
  canvasSync: (userId: number) => Promise<void>;
  mailSync: (userId: number) => Promise<void>;
  enrich: (userId: number) => Promise<void>;
}

export async function runUserSync(deps: SyncDeps, userId: number): Promise<void> {
  const jobs = [["canvas", deps.canvasSync], ["graph", deps.mailSync], ["enrich", deps.enrich]] as const;
  for (const [source, job] of jobs) {
    const run = deps.db.insert(syncRuns).values({ userId, source, startedAt: deps.now() }).returning().get();
    try {
      await job(userId);
      deps.db.update(syncRuns).set({ finishedAt: deps.now(), ok: true }).where(eq(syncRuns.id, run.id)).run();
    } catch (err) {
      deps.db.update(syncRuns).set({ finishedAt: deps.now(), ok: false, error: String(err) }).where(eq(syncRuns.id, run.id)).run();
    }
  }
}

export function computeBackoffMs(consecutiveFailures: number, baseMs: number): number {
  return Math.min(baseMs * 2 ** consecutiveFailures, 3_600_000);
}
```

- [ ] **Step 3: Wire the real worker entrypoint**

```ts
// src/worker/index.ts — run: npm run worker
import Anthropic from "@anthropic-ai/sdk";
import { eq, and, isNull, or, inArray } from "drizzle-orm";
import { createDb } from "../db/client";
import { components, items, modules, users } from "../db/schema";
import { applyCanvasSync, upsertMailItems } from "../db/repo";
import { loadEnv } from "../lib/env";
import { decrypt, encrypt } from "../lib/crypto";
import { createCanvasClient } from "../connectors/canvas/client";
import { normalizeCanvasCourse } from "../connectors/canvas/normalize";
import { fetchInboxDelta } from "../connectors/graph/client";
import { refreshAccessToken } from "../connectors/graph/auth";
import { linkMailToModule, normalizeMail } from "../connectors/graph/normalize";
import { triageEmail } from "../enrich/rules";
import { createScorer } from "../enrich/llm";
import { createWeightageExtractor, type WeightageSourceText, type WeightageSourcePdf } from "../enrich/weightage";
import { computeBackoffMs, runUserSync } from "./sync";

const env = loadEnv();
const db = createDb(env.DATABASE_PATH);
const anthropic = env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }) : null;
const scorer = anthropic ? createScorer(anthropic, env.ANTHROPIC_MODEL) : null;
const extractor = anthropic ? createWeightageExtractor(anthropic, env.ANTHROPIC_MODEL) : null;

const SYLLABUS_NAME_RE = /(syllabus|assessment|grading|outline)/i;

async function canvasSync(userId: number): Promise<void> {
  const user = db.select().from(users).where(eq(users.id, userId)).get()!;
  if (!user.canvasTokenEnc) return;
  const canvas = createCanvasClient(env.CANVAS_BASE_URL, decrypt(user.canvasTokenEnc, env.SECRET_KEY));
  for (const course of await canvas.listActiveCourses()) {
    const [groups, announcements, events] = await Promise.all([
      canvas.listAssignmentGroups(course.id),
      canvas.listAnnouncements(course.id),
      canvas.listCalendarEvents(course.id),
    ]);
    const sync = normalizeCanvasCourse(course, groups, announcements, events);
    const { moduleId } = applyCanvasSync(db, userId, sync, Date.now());

    // Weightage extraction: once per module, only when nothing (canvas/llm/manual) exists yet.
    if (!extractor) continue;
    const have = db.select().from(components).where(eq(components.moduleId, moduleId)).all();
    if (have.length > 0) continue;
    const texts: WeightageSourceText[] = [];
    if (sync.module.syllabusBody) texts.push({ label: "Canvas syllabus page", text: sync.module.syllabusBody });
    for (const p of (await canvas.listPages(course.id)).filter((p) => SYLLABUS_NAME_RE.test(p.title)).slice(0, 3))
      texts.push({ label: `Page: ${p.title}`, text: await canvas.getPageBody(course.id, p.url) });
    const pdfs: WeightageSourcePdf[] = [];
    for (const f of (await canvas.listSyllabusFiles(course.id)).filter((f) => f.content_type === "application/pdf").slice(0, 2))
      pdfs.push({ label: f.display_name, base64: Buffer.from(await canvas.downloadFile(f.url)).toString("base64") });
    const extracted = await extractor(texts, pdfs);
    if (extracted) for (const c of extracted) {
      db.insert(components).values({ moduleId, name: c.name, weightPct: c.weightPct, source: "llm_syllabus", evidence: c.evidence })
        .onConflictDoNothing().run();
    }
  }
}

async function mailSync(userId: number): Promise<void> {
  const user = db.select().from(users).where(eq(users.id, userId)).get()!;
  if (!user.msRefreshTokenEnc || !env.MS_CLIENT_ID) return;
  const { accessToken, refreshToken } = await refreshAccessToken(env.MS_CLIENT_ID, decrypt(user.msRefreshTokenEnc, env.SECRET_KEY));
  const { messages, deltaLink } = await fetchInboxDelta(accessToken, user.msDeltaLink);
  const byCode = new Map(db.select().from(modules).where(eq(modules.userId, userId)).all().map((m) => [m.code, m.id]));
  upsertMailItems(db, userId, messages.filter((m) => m.id).map((m) => linkMailToModule(normalizeMail(m), byCode)), Date.now());
  db.update(users).set({ msDeltaLink: deltaLink, msRefreshTokenEnc: encrypt(refreshToken, env.SECRET_KEY) })
    .where(eq(users.id, userId)).run();
}

async function enrich(userId: number): Promise<void> {
  const activeCodes = db.select().from(modules).where(and(eq(modules.userId, userId), eq(modules.active, true))).all().map((m) => m.code);
  const pending = db.select().from(items).where(and(
    eq(items.userId, userId), eq(items.type, "email"),
    or(isNull(items.triage), inArray(items.triage, ["unscored"])),
  )).all();
  for (const mail of pending) {
    const ruled = triageEmail({ sender: mail.sender, title: mail.title, body: mail.body, moduleId: mail.moduleId }, { activeCodes });
    if (ruled.verdict !== "ambiguous" || !scorer) {
      db.update(items).set({ triage: ruled.verdict === "ambiguous" ? "unscored" : ruled.verdict, importanceReason: ruled.reason })
        .where(eq(items.id, mail.id)).run();
      continue;
    }
    const scored = await scorer({ sender: mail.sender, title: mail.title, body: mail.body });
    db.update(items).set({ triage: scored.triage, importance: scored.importance, importanceReason: scored.reason })
      .where(eq(items.id, mail.id)).run();
  }
}

const failures = new Map<string, number>();
async function loop(): Promise<void> {
  for (const user of db.select().from(users).all()) {
    await runUserSync({
      db, now: Date.now,
      canvasSync: guarded("canvas", canvasSync),
      mailSync: guarded("graph", mailSync),
      enrich: guarded("enrich", enrich),
    }, user.id);
  }
  setTimeout(loop, env.POLL_INTERVAL_MS);
}
function guarded(source: string, fn: (userId: number) => Promise<void>) {
  return async (userId: number) => {
    const key = `${source}:${userId}`;
    const wait = computeBackoffMs(failures.get(key) ?? 0, env.POLL_INTERVAL_MS);
    const last = failures.get(`${key}:at`) ?? 0;
    if ((failures.get(key) ?? 0) > 0 && Date.now() - last < wait) return; // still backing off
    try { await fn(userId); failures.set(key, 0); }
    catch (err) { failures.set(key, (failures.get(key) ?? 0) + 1); failures.set(`${key}:at`, Date.now()); throw err; }
  };
}
console.log("openpapr worker starting");
void loop();
```
Note the double bookkeeping (`syncRuns` in DB for the UI, in-memory `failures` for backoff) is deliberate — restarts reset backoff, which is fine.

- [ ] **Step 4: Run tests + typecheck, commit**

Run: `npx vitest run src/worker/sync.test.ts` → PASS. `npx tsc --noEmit` → clean.
```bash
git add src/worker/ && git commit -m "feat: worker loop with per-source isolation and backoff"
```

---

### Task 14: Session auth + API routes

**Files:**
- Create: `src/server/auth.ts`, `src/server/auth.test.ts`, `src/server/overview.ts`, `src/server/overview.test.ts`, and route files: `src/app/api/login/route.ts`, `src/app/api/overview/route.ts`, `src/app/api/items/[id]/dismiss/route.ts`, `src/app/api/components/manual/route.ts`, `src/app/api/seen/route.ts`, plus `src/server/db.ts` (shared singleton) and `src/middleware.ts`

**Interfaces:**
- Produces from `auth.ts`: `signSession(secretHex: string, ttlMs?: number): string` (format `exp.hmacHex` where hmac = HMAC-SHA256(`exp`, key)) and `verifySession(value: string | undefined, secretHex: string): boolean`.
- Produces from `overview.ts` (pure query layer over `Db`, unit-testable without HTTP):
```ts
export interface Overview {
  lastSeenAt: number;
  whatsNew: ItemRow[];                          // firstSeenAt > lastSeenAt, newest first, cap 20
  todos: ItemRow[];                             // type in (assignment,event), !dismissed, !submitted; overdue (dueAt < now) first, then dueAt asc, nulls last
  mail: { important: ItemRow[]; filteredCount: number };  // important = triage in (important,ambiguous,unscored) & !dismissed, newest 20; filteredCount = garbage count
  modules: { id: number; code: string; name: string; components: ComponentRow[]; latestAnnouncements: ItemRow[]; unaccountedPct: number | null }[];
  syncStatus: { source: string; lastOkAt: number | null; stale: boolean }[];  // stale = now - lastOkAt > 3 * pollIntervalMs
  graphAuthBroken: boolean;   // latest graph sync_run failed with /401|invalid_grant/ — drives the reconnect banner
}
export function getOverview(db: Db, userId: number, now: number, pollIntervalMs: number): Overview;
```
  Component precedence per (module, name): manual > llm_syllabus > canvas_api — dedupe by lowercased name keeping highest precedence. `unaccountedPct` = 100 − sum(weightPct) when components exist and sum < 90, else null.
- Route contract: all `/api/*` except `/api/login` return 401 without a valid `session` cookie (enforced in `src/middleware.ts`, which also redirects pages to `/login`). `POST /api/login {password}` → sets `session` HttpOnly cookie (30 days) when password matches `APP_PASSWORD`. `POST /api/seen {}` → sets `lastSeenAt = Date.now()`. `POST /api/items/:id/dismiss` → sets dismissed. `POST /api/components/manual {moduleId, name, weightPct|null, scorePct|null}` → upserts a `manual` component.

- [ ] **Step 1: Write failing tests for auth + overview** (pure functions; representative cases below, cover each ordering rule)

```ts
// src/server/auth.test.ts
import { describe, expect, it } from "vitest";
import { signSession, verifySession } from "./auth";
const key = "ab".repeat(32);
describe("session", () => {
  it("round-trips", () => expect(verifySession(signSession(key), key)).toBe(true));
  it("rejects tampering", () => expect(verifySession(signSession(key) + "0", key)).toBe(false));
  it("rejects expired", () => expect(verifySession(signSession(key, -1000), key)).toBe(false));
  it("rejects undefined", () => expect(verifySession(undefined, key)).toBe(false));
});
```

```ts
// src/server/overview.test.ts — seed an in-memory db, assert:
// 1. todos: overdue first, then dueAt asc, submitted/dismissed excluded
// 2. mail.important includes ambiguous+unscored (fail-open), filteredCount counts garbage only
// 3. whatsNew only items with firstSeenAt > lastSeenAt
// 4. component precedence: manual row shadows llm_syllabus row of the same name
// 5. unaccountedPct: components summing to 75 → 25; summing to 100 → null; none → null
// 6. syncStatus.stale true when last ok run is older than 3 * pollIntervalMs
import { describe, expect, it } from "vitest";
import { createDb } from "../db/client";
import { components, items, modules, syncRuns, users } from "../db/schema";
import { getOverview } from "./overview";

const setup = () => {
  const db = createDb(":memory:");
  db.insert(users).values({ name: "a", lastSeenAt: 100 }).run();
  const mod = db.insert(modules).values({ userId: 1, canvasCourseId: 7, code: "CS2103T", name: "SE" }).returning().get();
  return { db, moduleId: mod.id };
};

describe("getOverview", () => {
  it("orders todos overdue-first then by due date", () => {
    const { db } = setup();
    const base = { userId: 1, source: "canvas" as const, type: "assignment" as const, firstSeenAt: 1, title: "" };
    db.insert(items).values([
      { ...base, sourceId: "a:1", title: "later", dueAt: 5000 },
      { ...base, sourceId: "a:2", title: "overdue", dueAt: 500 },
      { ...base, sourceId: "a:3", title: "soon", dueAt: 2000 },
      { ...base, sourceId: "a:4", title: "done", dueAt: 100, submitted: true },
    ]).run();
    const o = getOverview(db, 1, 1000, 300_000);
    expect(o.todos.map((t) => t.title)).toEqual(["overdue", "soon", "later"]);
  });
  it("fails open in the mail feed and counts filtered garbage", () => {
    const { db } = setup();
    const base = { userId: 1, source: "graph" as const, type: "email" as const, firstSeenAt: 1 };
    db.insert(items).values([
      { ...base, sourceId: "m:1", title: "imp", triage: "important" },
      { ...base, sourceId: "m:2", title: "unk", triage: "unscored" },
      { ...base, sourceId: "m:3", title: "amb", triage: "ambiguous" },
      { ...base, sourceId: "m:4", title: "junk", triage: "garbage" },
    ]).run();
    const o = getOverview(db, 1, 1000, 300_000);
    expect(o.mail.important.map((m) => m.title).sort()).toEqual(["amb", "imp", "unk"]);
    expect(o.mail.filteredCount).toBe(1);
  });
  it("manual components shadow llm rows and compute unaccounted", () => {
    const { db, moduleId } = setup();
    db.insert(components).values([
      { moduleId, name: "tP", weightPct: 45, source: "llm_syllabus", evidence: "tP 45%" },
      { moduleId, name: "tP", weightPct: 50, source: "manual" },
      { moduleId, name: "Finals", weightPct: 25, source: "canvas_api" },
    ]).run();
    const m = getOverview(db, 1, 1000, 300_000).modules[0];
    expect(m.components.find((c) => c.name === "tP")!.source).toBe("manual");
    expect(m.unaccountedPct).toBe(25);
  });
  it("flags broken graph auth for the reconnect banner", () => {
    const { db } = setup();
    db.insert(syncRuns).values({ userId: 1, source: "graph", startedAt: 0, finishedAt: 1, ok: false, error: "Graph 401: invalid_grant" }).run();
    expect(getOverview(db, 1, 1000, 300_000).graphAuthBroken).toBe(true);
  });
  it("flags stale sources", () => {
    const { db } = setup();
    db.insert(syncRuns).values({ userId: 1, source: "graph", startedAt: 0, finishedAt: 0, ok: true }).run();
    const o = getOverview(db, 1, 10_000_000, 300_000);
    expect(o.syncStatus.find((s) => s.source === "graph")!.stale).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify both fail**, then implement `auth.ts`:

```ts
// src/server/auth.ts
import { createHmac, timingSafeEqual } from "node:crypto";

const mac = (exp: string, keyHex: string) =>
  createHmac("sha256", Buffer.from(keyHex, "hex")).update(exp).digest("hex");

export function signSession(secretHex: string, ttlMs = 30 * 24 * 3_600_000): string {
  const exp = String(Date.now() + ttlMs);
  return `${exp}.${mac(exp, secretHex)}`;
}

export function verifySession(value: string | undefined, secretHex: string): boolean {
  if (!value) return false;
  const [exp, sig] = value.split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const want = Buffer.from(mac(exp, secretHex));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}
```

- [ ] **Step 3: Implement `overview.ts`** — plain Drizzle queries implementing exactly the Interfaces contract (select items/components/modules/syncRuns for the user, sort and group in TS; `ItemRow`/`ComponentRow` are `typeof items.$inferSelect` / `typeof components.$inferSelect`). Keep it one exported function plus small helpers; no SQL strings.

- [ ] **Step 4: Implement routes + middleware**

```ts
// src/server/db.ts — lazy singleton shared by all routes
import { createDb, type Db } from "../db/client";
import { loadEnv } from "../lib/env";
let db: Db | null = null;
export const getDb = () => (db ??= createDb(loadEnv().DATABASE_PATH));
```

```ts
// src/middleware.ts
import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "./server/auth";

export function middleware(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith("/api/login") || req.nextUrl.pathname === "/login") return NextResponse.next();
  const ok = verifySession(req.cookies.get("session")?.value, process.env.SECRET_KEY ?? "");
  if (ok) return NextResponse.next();
  return req.nextUrl.pathname.startsWith("/api")
    ? NextResponse.json({ error: "unauthorized" }, { status: 401 })
    : NextResponse.redirect(new URL("/login", req.url));
}
export const config = { matcher: ["/((?!_next|favicon.ico).*)"] };
```
(`verifySession` uses only `node:crypto` — add `export const runtime = "nodejs"` handling by keeping middleware logic crypto-free if the Edge runtime rejects it: fall back to re-implementing `mac` with the Web Crypto API `crypto.subtle` in middleware only. Implementer: try the simple version first; if `next build` errors on node:crypto in middleware, do the subtle-crypto variant.)

Routes are thin wrappers, e.g.:
```ts
// src/app/api/overview/route.ts
import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { getOverview } from "@/server/overview";
import { loadEnv } from "@/lib/env";
export const dynamic = "force-dynamic";
export function GET() {
  return NextResponse.json(getOverview(getDb(), 1, Date.now(), loadEnv().POLL_INTERVAL_MS));
}
```
`login/route.ts`: compare `password` from JSON body with `APP_PASSWORD`, on match `NextResponse.json({ok:true})` with `res.cookies.set("session", signSession(SECRET_KEY), { httpOnly: true, sameSite: "lax", secure: true, path: "/" })`, else 401. `seen`, `dismiss`, `components/manual`: one Drizzle statement each on `getDb()`, scoped to `userId = 1` (single-user phase 1; the hardcoded `1` lives only in route files, marked `// TODO(phase-3): session → userId`).

- [ ] **Step 5: Run all tests + build, commit**

Run: `npx vitest run` → PASS; `npm run build` → clean.
```bash
git add src/server/ src/app/api/ src/middleware.ts && git commit -m "feat: password session, middleware, and overview API"
```

---

### Task 15: UI — quiet ink

**Files:**
- Create/modify: `src/app/globals.css`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/login/page.tsx`, `src/app/mail/page.tsx`, `src/app/modules/[id]/page.tsx`, `src/components/{Rail,WhatsNew,TodoList,MailList,ModuleCard,SyncStatus}.tsx`

**Interfaces:**
- Consumes: `Overview` JSON from `/api/overview` (fetched client-side with `fetch("/api/overview")` in a small `useOverview()` hook, or server-side via direct `getOverview` call in server components — use server components + direct call for pages, client components only for buttons that POST).
- Visual contract (from the spec's UI section — implement, don't reinterpret):
  - Tokens in `globals.css`: `--surface: #fcfcfc; --line: #ececee; --ink: #18181b; --ink-2: #71717a; --ink-3: #a1a1aa; --accent: #0f766e; --danger: #dc2626; --warn: #b45309;`. Font: Geist (bundled with create-next-app) with tabular numerals (`font-variant-numeric: tabular-nums`) on weights/dates. No shadows, no gradients, no emoji. Hairline borders only.
  - Layout: 52px fixed left rail (Home/Modules/Mail icons — inline SVG, Lucide paths, thin stroke), main column `max-w-[760px] mx-auto`.
  - Home order: persistent amber banner "Reconnect Microsoft — run scripts/connect-microsoft.ts" when `graphAuthBroken` (spec: token death must be loud, not quiet); header (date + week + per-source sync status, amber `⚠` text when `stale`), what's-new strip (teal-tinted box, red label for `deadline_change` items; strip renders only when `whatsNew.length > 0`; a "Mark seen" button POSTs `/api/seen`), to-dos (overdue rows pinned top in `--danger`, weight badge from the item's module components when a component name fuzzy-matches the item title — else no badge; deadline order NEVER changes by weight), important mail (sender bold, one-line `importanceReason` in `--ink-3`, `filteredCount` link to `/mail?filtered=1`), module cards grid (2-col: weightage table with per-row source label — `canvas`/`syllabus*`/`manual` — `syllabus*` in `--warn` with `title={evidence}` tooltip; explicit `Unaccounted N% — add manually` row in `--warn` when `unaccountedPct != null`; latest announcement line).
  - `/mail`: full list newest-first; `?filtered=1` also shows garbage rows (greyed) with their reasons. Dismiss buttons POST `/api/items/:id/dismiss`.
  - `/modules/[id]`: full component table (all sources shown, shadowing indicated), evidence quotes, announcement list; inline form POSTs `/api/components/manual`.
  - `/login`: single password field POSTing `/api/login`, redirect to `/` on 200.

- [ ] **Step 1: Implement tokens + layout + components.** No unit tests for JSX; correctness is covered by Task 16's Playwright smoke. Keep every component a server component except `MarkSeenButton`, `DismissButton`, `ManualComponentForm`, `LoginForm` (`"use client"`, plain `fetch` POST + `router.refresh()`).

- [ ] **Step 2: Manual check with an empty DB.** Run `npm run dev`, log in, confirm: empty states render ("No to-dos", "No mail yet", "weightage unknown — add manually"), nothing crashes with zero modules.

- [ ] **Step 3: Commit**

```bash
git add src/app/ src/components/ && git commit -m "feat: quiet-ink UI - home, mail, module detail, login"
```

---

### Task 16: Seed script + Playwright smoke

**Files:**
- Create: `scripts/seed-demo.ts`, `e2e/smoke.spec.ts`, `playwright.config.ts`

**Interfaces:**
- Consumes: schema from Task 4. `npm i -D @playwright/test && npx playwright install chromium`.
- Produces: `scripts/seed-demo.ts` writes `data/demo.db` containing: 1 user; 2 modules (CS2103T with mixed-source components incl. one `llm_syllabus` row with evidence + one manual override; ST2334 with components summing to 75); 4 todos (one overdue, one submitted), 1 deadline_change item, 4 emails (important/ambiguous/unscored/garbage with reasons), sync_runs rows with one stale source. Idempotent: deletes the file first.

- [ ] **Step 1: Write the seed script** — plain inserts mirroring the fixtures above; end with `console.log("seeded data/demo.db")`.

- [ ] **Step 2: Playwright config with webServer**

```ts
// playwright.config.ts
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "e2e",
  use: { baseURL: "http://localhost:3777" },
  webServer: {
    command: "npx tsx scripts/seed-demo.ts && npm run build && npx next start -p 3777",
    port: 3777,
    env: {
      DATABASE_PATH: "data/demo.db",
      SECRET_KEY: "ab".repeat(32),
      APP_PASSWORD: "test-password",
    },
    timeout: 180_000,
  },
});
```

- [ ] **Step 3: Write the smoke test**

```ts
// e2e/smoke.spec.ts
import { expect, test } from "@playwright/test";

test("login, home sections, mail, module detail", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Password").fill("test-password");
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByText("New since your last visit")).toBeVisible();
  await expect(page.getByText("Deadline moved", { exact: false })).toBeVisible();
  await expect(page.getByText(/overdue/i).first()).toBeVisible();
  await expect(page.getByText(/filtered/i)).toBeVisible();          // filtered-mail count link
  await expect(page.getByText(/Unaccounted/)).toBeVisible();        // honest weightage row
  await expect(page.getByText(/syllabus\*/).first()).toBeVisible(); // source label
  await page.getByText(/filtered/i).click();
  await expect(page).toHaveURL(/\/mail/);
  await page.goto("/modules/1");
  await expect(page.getByText(/manual/i).first()).toBeVisible();
});
```

- [ ] **Step 4: Run, fix UI selectors until green, commit**

Run: `npx playwright test` → PASS.
```bash
git add scripts/seed-demo.ts e2e/ playwright.config.ts && git commit -m "test: seeded end-to-end smoke"
```

---

### Task 17: Deploy

**Files:**
- Create: `Dockerfile`, `start.sh`, `fly.toml`, `README.md`
- Modify: `next.config.ts` (`output: "standalone"`)

**Interfaces:**
- Consumes: everything. Requires `flyctl` auth'd (`fly auth login` — ask Aiden to run it interactively if needed).
- Produces: a running app at `https://openpapr.fly.dev` with a persistent volume at `/data`.

- [ ] **Step 1: Dockerfile + start.sh**

```dockerfile
# Dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/src ./src
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/tsconfig.json ./
COPY start.sh ./
EXPOSE 3000
CMD ["sh", "start.sh"]
```
(Standalone output prunes node_modules; we re-copy the full node_modules because the worker runs from TS source via tsx. Trade image size for simplicity — acceptable at this scale.)

```sh
# start.sh — worker in background, web in foreground; container dies if web dies
npx tsx src/worker/index.ts &
node server.js
```

- [ ] **Step 2: fly.toml + launch**

```toml
# fly.toml
app = "openpapr"
primary_region = "sin"
[build]
[env]
  DATABASE_PATH = "/data/openpapr.db"
[mounts]
  source = "openpapr_data"
  destination = "/data"
[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = false   # worker must keep polling
  min_machines_running = 1
```
Run: `fly launch --no-deploy --copy-config`, then `fly volumes create openpapr_data --size 1 --region sin`, then `fly secrets set SECRET_KEY=$(openssl rand -hex 32) APP_PASSWORD=... ANTHROPIC_API_KEY=... MS_CLIENT_ID=...`, then `fly deploy`. **Show Aiden the full command lines before running them** (per his standing preference for launch commands).

- [ ] **Step 3: Post-deploy setup**

SSH in (`fly ssh console`) and run a one-off user insert + Canvas token store, then `npx tsx scripts/connect-microsoft.ts` (device code printed in the console works from any browser). Verify `/api/overview` returns data and the dashboard renders over HTTPS.

- [ ] **Step 4: README + final commit**

`README.md`: what it is (link to spec), local dev (`.env` from `.env.example`, `npm run dev` + `npm run worker`), how to connect Canvas/Microsoft, deploy runbook (the fly commands above), where data lives. Keep to a page.
```bash
git add -A && git commit -m "feat: fly.io deployment with worker+web container"
```

---

## Plan self-review notes

- Spec coverage: phases 0–1 fully tasked; phase 2 (planner) and phase 3 (multi-user) intentionally out of scope — `userId` is threaded through every function so phase 3 needs no rework; `scorePct` is already collected for phase 2.
- Type consistency spot-checks done: `NormalizedCanvasSync` (T7→T13), `MailItem` (T7 placeholder→T9→T13), `GraphMessage` (T8→T9), `RuleVerdict`/`LlmScore` (T10/T11→T13), `Overview` (T14→T15), `computeBackoffMs` (T13 internal).
- Known deviations from spec, accepted: weightage sources exclude first-week announcements (syllabus body + pages + PDFs only — announcements are already items and rarely carry the breakdown; revisit if Task 1's spike says otherwise).
