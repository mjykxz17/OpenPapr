# one-ring: Canvas + NUS Outlook dashboard — design

Date: 2026-08-12
Status: approved (brainstorming session)

## Problem

Canvas at NUS has no standard way to see, per module: the module structure, the
assessment component weightage, and the newest announcements. Each professor
lays their course out differently. The built-in to-do list is badly ordered.
Separately, NUS Outlook mail mixes genuinely important messages (from
professors, about deadlines, exams, grades) with large volumes of noise
(newsletters, event blasts, mass mail). Important information is scattered
across two systems with no unified view.

one-ring is a web application that pulls from both sources and presents the
important information in one place.

## Users and scope

- Primary user: Aiden, now. Built so that a small number of friends can be
  added later: no hardcoded identity anywhere; every per-person value (Canvas
  token, Microsoft credentials, preferences) lives in a `users` row.
- Not a public product. No NUS IT partnership, no app-store presence.

## Phasing

- **Phase 0 — feasibility spike.** Before real code:
  1. Register a free multi-tenant application in a personal Entra ID tenant.
     Attempt OAuth sign-in with the NUS account requesting `Mail.Read` and
     `offline_access`. Determine whether the NUS tenant permits user consent.
  2. Confirm a personal access token can be generated on `canvas.nus.edu.sg`
     (Account → Settings → New Access Token) and that it can list courses,
     assignments, assignment groups, and announcements.
  - If Graph consent is blocked, fall back to an Outlook auto-forward rule to
    a personal Gmail account, read via the Gmail API. The mail connector is an
    interface so the rest of the system is indifferent to which path won.
    (If NUS also blocks external auto-forwarding, this project's mail half is
    reduced to manual paste / periodic export; reassess then.)
- **Phase 1 — core dashboard.** Pollers, database, LLM enrichment, and the
  views: module cards, unified to-do list, filtered email feed, what's-new.
- **Phase 2 — grade planner.** What-if view over components and known scores.
- **Phase 3 — friends.** Additional users, per-user login, onboarding notes.

## Architecture

A single Next.js (TypeScript) application in one container, deployed to a
cheap always-on host (Fly.io or Railway). Two processes in the container:

- **web** — Next.js server: UI pages and API routes. Never calls Canvas or
  Graph directly. Writes only user-state data (seen/dismissed flags, manual
  component overrides, `last_seen_at`); never writes source data.
- **worker** — background process: pollers and the LLM enricher. The only
  writer of source data (modules, items, non-manual components, sync_runs).

Storage is SQLite on a persistent volume, accessed through Drizzle ORM.
SQLite is sufficient for single-digit users; nothing in the design assumes
SQLite specifically, so a later move to Postgres is mechanical.

LLM calls use the Claude API with a Haiku-class model.

## Data model

- **users** — id, name, canvas token (encrypted), Microsoft refresh token
  (encrypted), `last_seen_at` (drives the what's-new view), preferences.
- **modules** — one row per Canvas course per user: Canvas course id, module
  code (e.g. CS2103T), name, term, active flag.
- **components** — the weightage table. Module id, component name (e.g.
  "Final exam", "Project"), weight percent, score where known, and:
  - `source`: `canvas_api` | `llm_syllabus` | `manual`. Manual always wins.
    The UI always displays the source of a weightage number.
  - `evidence`: for `llm_syllabus`, the quoted syllabus text the number came
    from, so it can be checked at a glance.
- **items** — every fact from every source, normalized to one shape:
  - `type`: `announcement` | `assignment` | `email` | `event` |
    `deadline_change`
  - `source` + `source_id` — dedup and idempotent upsert key
  - `module_id` — nullable; emails are linked to modules when a module code
    is detected in subject/body/sender
  - title, body, url, `due_at` (nullable), timestamps
  - `importance`: numeric score or `unscored`; `importance_reason`: one line
  - per-user state: seen, dismissed
- **sync_runs** — per source: started, finished, ok/error, error detail.
  Drives staleness badges in the UI.

## Data flow

**Canvas poller (every ~5 min).** Pulls courses, assignment groups (weights
where the professor configured weighted grading), assignments with the user's
submissions and scores, announcements, and planner/calendar events. Upserts
by (`source`, `source_id`), so re-polling is idempotent and edits (e.g. a
moved deadline) appear as `deadline_change` items rather than duplicates.

**Mail poller (every ~5 min).** Microsoft Graph delta query on the inbox:
each poll transfers only new and changed messages. New mail lands in `items`
as `importance: unscored`.

**Enricher (queue, runs after each poll).** Rules first, LLM second:

1. Rule pass (free, deterministic): link email to module by code detection;
   classify obvious noise (newsletter senders, event blasts, mass CC) and
   obvious importance (sender is a professor of a current module, subject
   contains deadline/exam/grade vocabulary) without an LLM call.
2. Only ambiguous emails go to the LLM for a one-shot importance score plus a
   one-line reason, both stored on the item.
3. **Fail-open**: if the LLM call fails or is uncertain, the email shows in
   the feed as unscored. Mail is hidden only on a confident garbage verdict,
   and a "show filtered" toggle always exists. Rationale: a false "important"
   costs a glance; a false "garbage" costs a missed exam notice.

**Weightage extraction (once per module per term, re-runnable on demand).**
Collect syllabus-shaped sources: the Canvas syllabus body, pages and files
whose names match syllabus/assessment/outline, first-week announcements.
Send to the LLM with a strict JSON schema (components must sum to
approximately 100%). Store as `llm_syllabus` components with quoted evidence.
If nothing usable is found, the module card shows "weightage unknown — add
manually" rather than a fabricated table.

## Views

- **Module cards** — one per active module: structure (Canvas modules list),
  weightage table with per-number source, latest announcements.
- **To-do list** — `items` of assignment/event types, not dismissed, not
  submitted (submission state comes from Canvas submissions data). Ordered by
  due date; overdue-but-submittable items pin to the top; weightage appears
  as a badge on each item but does not affect ordering.
- **Email feed** — important mail only, newest first, with the one-line
  reason; "show filtered" toggle reveals everything hidden.
- **What's-new** — all items created since `last_seen_at`, shown on open;
  viewing it advances `last_seen_at`.
- **Grade planner (phase 2)** — per module: current weighted standing from
  components and known scores, per-component "what it's worth", and what-if
  sliders for unscored components.

## UI design

Decided in a visual mockup session (mockups preserved under
`.superpowers/brainstorm/`, not committed).

**Layout — hybrid, one-page-first.** A slim icon rail (Home, Modules, Mail,
Planner) plus a one-page home. Home is a single scrolling column, max-width
~760px, in order: header (date, week of term, per-source sync status with the
staleness warning inline), what's-new strip, to-dos, important mail, module
cards grid. Module detail, the full mail archive (including filtered), and
the planner live on their own pages behind the rail.

**Style — "quiet ink".** Near-white surface (`#fcfcfc`), hairline borders
(`#ececee`), no shadows, no gradients, no emoji. One accent: muted teal
(`#0f766e`). Red (`#dc2626`) is reserved for overdue and deadline-moved;
amber (`#b45309`) is reserved for uncertainty and staleness (LLM-sourced
weightage, unaccounted percentages, stale sync). Section labels are tiny
uppercase letter-spaced text. Typeface: Geist or IBM Plex Sans (deliberately
not default Inter), tabular numerals for weights and dates.

**Component base.** shadcn/ui re-themed to the above (borders instead of
shadows, accent swapped); Lucide icons, thin weight, sparingly.

**Deliberate UI contracts with the data model:**

- Every weightage number carries its source label (`canvas` / `syllabus*` /
  `manual`); `syllabus*` opens the quoted evidence on click.
- Weight that does not sum to 100% shows as an explicit "Unaccounted N% — add
  manually" row, never silently normalized.
- Every mail row shows its one-line triage reason in muted text.
- The filtered-mail count is always visible with a reveal link.
- Overdue items pin to the top in red; weight badges inform but never
  reorder the deadline sort.

## Error handling

- Pollers are independent; one source failing never blocks the other.
- Failures recorded in `sync_runs`; retries with exponential backoff.
- The UI shows a per-source staleness badge whenever the last successful sync
  is older than about three poll intervals. Silent staleness is not possible.
- Expired or revoked Microsoft refresh tokens surface as a persistent
  "reconnect Microsoft" banner, not a quiet death.
- LLM failures fail open (see enricher).

## Security

- Canvas and Microsoft tokens are encrypted at rest; the key lives only in
  host environment secrets; decryption happens in the worker; tokens never
  reach the browser.
- The dashboard sits behind a login (simple password session in phase 1 — the
  app is on the public internet and holds private mail).
- HTTPS terminated by the hosting platform.
- Plainly stated: email bodies and syllabus text are sent to Anthropic's API
  for scoring/extraction. Acceptable for this project's owner; each future
  friend must be told before their account is added.

## Testing

- **Connectors**: recorded real Canvas/Graph JSON responses checked into the
  repo as fixtures; normalizer output asserted against them.
- **Rules and ordering**: triage rules and to-do ordering are pure functions
  with unit tests.
- **LLM prompts**: a small labeled evaluation set (a few dozen real emails
  marked important/garbage by hand; a few real syllabi with known
  weightages). Run on demand when a prompt changes, so prompt edits are
  measured, not guessed.
- **End to end**: one Playwright smoke test boots the app against a seeded
  database and checks every view renders.

## Out of scope

- Push notifications of any kind (Telegram, email, web push). "Real-time"
  means the poller keeps data fresh and the what's-new view shows deltas.
- Writing anything back to Canvas or Outlook (submissions, replies, rules).
- Public multi-tenant service, mobile app, offline mode.

## Risks

1. **Graph consent blocked by NUS tenant** — the phase 0 spike exists for
   this; Gmail-forwarding fallback documented above.
2. **LLM weightage extraction errors** — mitigated by evidence quoting,
   visible source labels, manual override, and the labeled evaluation set.
   The planner view is advisory, not authoritative.
3. **Canvas token scope/expiry policy at NUS** — personal tokens can be
   regenerated; the staleness badge plus reconnect banner make expiry loud.
4. **Cost** — hosting a few dollars monthly; LLM cost bounded by rules-first
   triage and per-term (not per-poll) weightage extraction.
