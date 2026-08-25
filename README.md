# OpenPapr

Turn your own university course material into chaptered study guides, and share them with your cohort.

> **Status: early, single-user.** What runs today is a working self-hosted dashboard for one
> person, used by its author. Multi-tenant accounts, the shared Library, publishing and forking
> are designed but not built. Study-guide generation is currently a semi-manual pipeline, not an
> in-app job. Details are in [Status and limits](#status-and-limits) — read that before you plan
> anything around this.

## What it does

You connect your Canvas LMS account. A background worker polls Canvas and pulls your courses,
assignment groups, announcements and calendar events into a local SQLite database, and an LLM
extracts assessment weightings from syllabus pages and prelim slide decks when Canvas does not
expose them as structured `group_weight` values. The result is a per-module dashboard: what the
module is graded on, what is due, what was announced. Optionally it also pulls your Outlook
mailbox through the Microsoft Graph API and triages it against your enrolled module codes.

On top of that sits the part the project is actually about: study guides generated from your own
lecture slides, rendered chapter-by-chapter with the source slide one click away.

Three things are meant to be distinctive about it.

**Guides are generated from your own source material, with per-claim slide citations.** Guide
markdown uses two custom link schemes that the renderer understands: `[slide 62](slide:U0-prelim#62)`
renders as a small chip that opens that deck's PDF at page 62, and
`![what a stack frame looks like](slide-img:C-part2-pointers#15)` embeds a PNG of that actual slide,
rendered on demand from the deck. Diagrams the slides only describe in prose are recreated as
```` ```mermaid ```` blocks and drawn client-side. So every claim in a guide is traceable back to
the exact slide it came from, and figures are the professor's own rather than reconstructions.
This part is built and working.

**Same-deck dedupe, so a cohort generates once.** Two students in the same module have the same
decks. Generation is expensive; doing it once per deck rather than once per student is the whole
economic argument for making this shareable. *Designed, not built* — there is no content-hash
column and no shared generation cache in the schema today.

**Canvas enrolment is the sharing boundary.** The unit of sharing is intended to be a course
Library that you can see because Canvas says you are enrolled in that course — not an invite link,
not a public feed. Notes stay private by default; publishing to the Library and forking a
classmate's guide are opt-in actions. *Designed, not built* — see the roadmap.

## Screenshot

<!-- TODO: add docs/screenshot.png (module page with the study-guide tab open, a slide chip and an
     embedded slide figure visible) and replace this comment with the image. -->

_Placeholder._

## Quick start

### Prerequisites

- Node.js 22 (the container image is `node:22-alpine`; anything ≥20 should work)
- A Canvas account at an institution that allows personal access tokens
- **LibreOffice** — only if your courses distribute `.pptx`/`.ppt` decks rather than PDFs. It is
  called headlessly to convert decks to PDF so slide citations and slide images work. Not needed
  for PDF-only courses, and not bundled or shipped with this project.
- An LLM API key — either an Anthropic key or any OpenAI-compatible chat-completions endpoint.
  Without one the app still runs; weightage extraction, mail triage and deadline extraction are
  skipped and the rules-only path is used.

`better-sqlite3` is compiled from source on musl; on glibc Linux and macOS a prebuilt binary is
used and `npm install` needs no toolchain.

### Environment

```bash
cp .env.example .env
```

Fill in at least `SECRET_KEY` and `APP_PASSWORD`. The full set, as validated by
[`src/lib/env.ts`](src/lib/env.ts):

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `SECRET_KEY` | yes | — | 64 hex chars (`openssl rand -hex 32`). Encrypts stored Canvas and Microsoft tokens at rest. |
| `APP_PASSWORD` | yes | — | Minimum 8 characters. A single shared password gates the whole app; there is no per-user login. |
| `DATABASE_PATH` | no | `data/openpapr.db` | SQLite file. Everything lives here. |
| `CANVAS_BASE_URL` | no | your institution's Canvas host | e.g. `https://canvas.example.edu`. |
| `MS_CLIENT_ID` | no | — | Microsoft Entra ID app client id, for the optional Outlook mail sync. |
| `ANTHROPIC_API_KEY` | no | — | Enables the Anthropic LLM path. |
| `ANTHROPIC_MODEL` | no | `claude-haiku-4-5` | Model used on the Anthropic path. |
| `OPENAI_COMPAT_BASE_URL` | no | — | Any OpenAI-compatible `/v1` endpoint. Takes precedence over Anthropic when set together with the key below. |
| `OPENAI_COMPAT_API_KEY` | no | — | Key for that endpoint. |
| `OPENAI_COMPAT_MODEL` | no | — | Model id for that endpoint. |
| `POLL_INTERVAL_MS` | no | `300000` | How often the worker polls Canvas and Outlook. |

The OpenAI-compatible path does not support PDF document inputs, so when it is selected the worker
extracts text from candidate PDFs locally instead of sending the file. The Anthropic path sends
the PDF.

### Install and run

```bash
npm install
npm run dev      # web, http://localhost:3000
npm run worker   # in a second terminal: Canvas/Outlook pollers and LLM enrichment
```

There is no separate migration step. `createDb()` runs the Drizzle migrations in `drizzle/` on
startup and creates the database file and its parent directory if missing. If you change
`src/db/schema.ts`, generate a new migration with `npx drizzle-kit generate` and commit it.

To look at the UI without connecting anything real:

```bash
npx tsx scripts/seed-demo.ts   # writes a synthetic fixture to data/demo.db
DATABASE_PATH=data/demo.db npm run dev
```

### Connecting Canvas

Generate a personal access token in Canvas under Account → Settings → New Access Token. There is
no UI or CLI for storing it yet — you insert the `users` row and the encrypted token yourself, for
example with a short `npx tsx -e` script that uses `encrypt()` from
[`src/lib/crypto.ts`](src/lib/crypto.ts) and `createDb()` from [`src/db/client.ts`](src/db/client.ts).
Institutions commonly cap token lifetime (90 days is typical), so expect to rotate it.

### Connecting Outlook (optional)

```bash
npx tsx scripts/connect-microsoft.ts --user 1
```

It prints a device code and a URL. Sign in in any browser and grant `Mail.Read` and
`offline_access`. The refresh token is stored encrypted and refreshed by the worker on every poll.
This requires `MS_CLIENT_ID` and a tenant that permits the consent; if your institution blocks it,
skip this — the Canvas side works on its own.

The worker only touches a source once its token is present, so it is safe to start before either
connection exists.

### Tests

```bash
npm test                  # vitest, unit tests under src/**/*.test.ts
npx playwright install    # once
npx playwright test       # e2e: seeds the demo fixture, builds, drives a real browser on :3777
```

The Playwright config builds the app and serves it on port 3777 against `data/demo.db` with a
throwaway `SECRET_KEY` and password, so it does not touch your real database.

## How study-guide generation works today

Honestly: it is a pipeline you drive by hand, not a button in the app. The rendering half is fully
built; the authoring half is not yet a job.

1. **Cache the decks.** For PowerPoint courses, download and convert every deck to PDF:

   ```bash
   npx tsx scripts/cache-decks.ts CS1010 --user 1
   ```

   This pulls `.pptx`/`.ppt` files from the Canvas course, converts each with headless LibreOffice,
   and writes them to `data/deck-cache/<canvasCourseId>/<stem>.pdf`. Set `SOFFICE_BIN` if your
   LibreOffice binary is not at the macOS default path. PDF-native courses need no caching — decks
   are fetched from Canvas on demand.

2. **Generate the guide.** This step happens outside the app: the deck PDFs are fed to a model that
   writes one Markdown file per module, chaptered with `## ` headings, citing slides with
   `[…](slide:<deck-stem>#<page>)` and embedding figures with `![…](slide-img:<deck-stem>#<page>)`.
   There is no in-app job, no queue and no prompt checked into this repo yet — that is the single
   biggest gap between what the project is and what it does. See the roadmap.

3. **Import it.**

   ```bash
   npx tsx scripts/import-study-guides.ts --dir ./guides --user 1
   ```

   Files are matched to modules by the code that prefixes the filename
   (`CS1010-software-security.md` → module `CS1010`). Import is idempotent: re-running replaces
   each guide in place. The first italic line of the file (`*Prepared from 8 decks, 351 slides.*`)
   is stored as the provenance note shown under the guide.

4. **Read it.** The guide appears on the module page and in `/study`.
   [`src/lib/study-chapters.ts`](src/lib/study-chapters.ts) splits it into a preamble plus one tab
   per `## ` chapter and builds an outline from the `### ` subheadings;
   [`src/components/StudyGuide.tsx`](src/components/StudyGuide.tsx) renders it, turning `slide:`
   links into citation chips (`/api/modules/:id/deck` proxies the PDF with a `#page=N` fragment),
   `slide-img:` images into server-rendered PNGs (`/api/modules/:id/slide` renders the page with
   `pdf-parse`), and ```` ```mermaid ```` blocks into diagrams. Both routes resolve the cached
   converted PDF first and fall back to fetching the PDF from Canvas.

Both deck routes check that the module belongs to the requesting user before serving bytes.

## Project layout

```
src/app/            Next.js App Router pages (/, /modules/[id], /study, /mail, /login) and API routes
src/components/     React components; StudyGuide.tsx and MermaidDiagram.tsx are the guide renderer
src/connectors/     canvas/ and graph/ — HTTP clients plus pure normalizers, tested separately
src/enrich/         LLM-backed enrichment: mail scoring, weightage extraction, deadline extraction
src/db/             Drizzle schema, migration-applying client, repository functions
src/server/         Server-only helpers: auth, overview assembly, deck resolution
src/lib/            Pure utilities: env schema, crypto, PDF text/render, slide citations, chapters
src/worker/         The background poller (npm run worker)
drizzle/            Generated SQL migrations, applied automatically on startup
scripts/            One-off operator scripts: cache-decks, import-study-guides, connect-microsoft, seed-demo
e2e/                Playwright smoke test
docs/               Design spec, implementation plan, feasibility spike notes
```

Data model, in one line each: `users` holds encrypted per-person tokens; `modules` is one Canvas
course; `components` is one graded item with a weight and a provenance `source`; `items` is the
unified feed of announcements, assignments, emails, events and deadlines; `study_guides` holds one
Markdown document per module; `sync_runs` records every poll for the staleness badge.

## Status and limits

What works: Canvas sync, LLM weightage extraction with quoted evidence, the module dashboard,
deadline extraction and classification, optional Outlook triage, the study-guide reader with slide
citations, embedded slide figures and Mermaid diagrams, and deck conversion for PowerPoint courses.

What does not:

- **One user.** The schema threads `userId` through every table, but every web page and API route
  hardcodes user `1` (grep for `TODO(phase-3)`). Authentication is one shared `APP_PASSWORD`, not
  accounts.
- **No Library.** There is no publish action, no fork, no cross-user read path, and no notion of a
  course-scoped collection. Guides are rows in your own database.
- **No dedupe.** Nothing hashes a deck or reuses another student's generation.
- **Generation is out-of-band.** Step 2 above is manual. Getting it into the worker as a real job,
  with the prompt in this repo, is the next substantial piece of work.
- **Canvas-shaped assumptions.** Module codes are parsed from Canvas course names, and weightage
  heuristics look for prelim/admin-looking decks. Both were tuned against one institution's Canvas
  and will need adjusting elsewhere.
- **Your material goes to an LLM.** Syllabus text, email bodies and slide content are sent to
  whichever provider you configure. That is a deliberate, disclosed trade; there is no local-model
  path today.

This is self-hosted software with no institutional affiliation or endorsement. You are responsible
for whether your use of your own course material complies with your institution's rules.

## Roadmap

The milestones are ordered by what unblocks what, not by size.

1. **In-app generation.** Move guide authoring into the worker as a queued job: deck discovery,
   conversion, prompting, citation validation (every `slide:` target must resolve to a real page),
   and write-through to `study_guides`. Removes the manual step and makes everything after it
   possible.
2. **Accounts.** Replace the shared password with real sessions, resolve `userId` from the session
   instead of the hardcoded `1`, and add a Canvas connect flow in the UI so onboarding is not a
   `tsx -e` script.
3. **Deck identity and dedupe.** Content-hash each deck, key generated guides on the set of deck
   hashes rather than on the module row, and reuse an existing generation when a second student in
   the same course presents the same decks.
4. **The Library.** Per-course collections gated on Canvas enrolment, an explicit publish action,
   read access for classmates, and forking a published guide into your own editable copy with
   attribution preserved.
5. **Grade planner.** A what-if view over `components` and known scores — already sketched in the
   design spec, deferred behind the above.

Design documents live in [`docs/`](docs/): the spec describes the data model and the fail-open
enrichment contract, and the plan is a task-by-task TDD breakdown of the phases that are built.
They predate the OpenPapr framing and still use the project's earlier name in places.

## Contributing

Issues and pull requests are welcome, with the caveat that the project is early enough that
interfaces change without ceremony.

- Tests come first. Unit tests sit next to the module they cover (`foo.ts` / `foo.test.ts`) and run
  under Vitest; the connectors are split into an HTTP client and a pure normalizer so the
  normalizer can be tested without a network.
- Both gates must pass before a pull request: `npm test` and `npx playwright test`.
- **Never commit real data.** Fixtures must be hand-authored and synthetic —
  [`scripts/seed-demo.ts`](scripts/seed-demo.ts) is the model to follow. Do not capture live API
  responses into `tests/fixtures/`: real Canvas payloads carry course UUIDs and calendar-feed URLs
  that are unauthenticated capability tokens, other people's names, and instructor-authored course
  material. Use `example.edu` addresses and invented names.
- `data/`, `.env*` and any token file are gitignored. Keep it that way.
- Do not put provider hostnames, model ids from private endpoints, or anything about where a key
  came from into committed files, including documentation.

## Licence

Licensed under the GNU Affero General Public License, version 3 or later. The full text is in
[`LICENSE`](LICENSE).

<!-- TODO before first public release:
     - set the copyright holder line
     - add THIRD-PARTY-NOTICES.md: caniuse-lite (CC-BY-4.0, attribution is a licence condition),
       sharp's optional platform binaries bundling libvips (LGPL-3.0-or-later), and a pointer to
       package-lock.json for full dependency resolution.
     - confirm AGPL vs a permissive licence while sole copyright holder; requires a contributor
       licence agreement from the first external pull request if the option is to stay open.
-->

LibreOffice is invoked as an external program and is neither vendored nor distributed by this
project; install it yourself if you need PowerPoint conversion.
