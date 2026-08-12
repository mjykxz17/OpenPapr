# one-ring

A Canvas + NUS Outlook dashboard: one place to see, per module, the module
structure, assessment weightage, and newest announcements, plus a filtered
view of important mail. Design and phasing are in
[`docs/superpowers/specs/2026-08-12-canvas-outlook-dashboard-design.md`](docs/superpowers/specs/2026-08-12-canvas-outlook-dashboard-design.md).

Single-user today (built for Aiden), with `userId` threaded through every
table and function so adding more people later is mechanical, not a rewrite.

## Local dev

```bash
cp .env.example .env   # fill in SECRET_KEY, APP_PASSWORD at minimum
npm install
npm run dev             # web, http://localhost:3000
npm run worker          # separate terminal: pollers + LLM enrichment
```

`SECRET_KEY` is 64 hex chars (`openssl rand -hex 32`), used to encrypt stored
Canvas/Microsoft tokens. `APP_PASSWORD` gates the whole app behind a single
password (min 8 chars) — there is no per-user login yet.

Run the tests with `npm test` (Vitest) and `npx playwright test` (end-to-end,
seeds a demo fixture and drives a real browser against it).

## Connecting Canvas and Microsoft

Both connections write an encrypted token onto a `users` row and are one-time
setup per person, not something done through the UI yet.

- **Canvas**: generate a personal access token at Canvas → Account → Settings
  → New Access Token, then encrypt-and-store it against the user row (e.g. via
  a short `npx tsx -e` script using `encrypt()` from `src/lib/crypto.ts` and
  `createDb()` from `src/db/client.ts`).
- **Microsoft**: run `npx tsx scripts/connect-microsoft.ts --user <id>`. It
  prints a device code — open the URL it gives you in any browser, sign in,
  and grant `Mail.Read` + `offline_access`. The refresh token is stored
  encrypted; the worker refreshes it on every poll.

The worker only picks up a module or mailbox once the corresponding token is
present, so it's safe to deploy before either is connected.

## Deploying

One container, two processes: **web** (`next start`, via the standalone
server) serves pages and API routes; **worker** (`tsx src/worker/index.ts`)
runs pollers and LLM enrichment in the background inside the same container.
The web process is what Docker watches — if it dies, the container dies and
Fly restarts it.

Deploy target is Fly.io, one always-on machine, SQLite on a persistent
volume at `/data`. Run these from the repo root, in order:

```bash
fly launch --no-deploy --copy-config
fly volumes create one_ring_data --size 1 --region sin
fly secrets set SECRET_KEY=$(openssl rand -hex 32) APP_PASSWORD=... ANTHROPIC_API_KEY=... MS_CLIENT_ID=...
fly deploy
```

After the first deploy, `fly ssh console` in and:

1. Insert the first `users` row and store its Canvas token (see "Connecting
   Canvas and Microsoft" above).
2. Run `npx tsx scripts/connect-microsoft.ts` — the device code it prints
   works from any browser, not just the console.
3. Confirm `/api/overview` returns data and the dashboard renders at
   `https://one-ring-<suffix>.fly.dev`.

## Where data lives

Everything is one SQLite file, `DATABASE_PATH` (default `data/one-ring.db`
locally, `/data/one-ring.db` in production), on the Fly volume `one_ring_data`
mounted at `/data`. There is no external database. Back up by copying that
one file.
