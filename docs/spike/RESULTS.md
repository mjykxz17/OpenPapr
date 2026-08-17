# Phase-0 spike results

## Canvas (run 2026-08-17, token generated via Chrome automation)

- Token generation: **works** for students, but NUS caps expiry at **90 days**
  (UI enforces it; current token expires 2026-11-15). The token must be
  rotated quarterly — the staleness badge + reconnect flow covers detection.
  Token stored in git-ignored `.canvas-token` (mode 600). Note: the Canvas
  token-details modal renders a CSS soft hyphen at the line wrap — the real
  token has no `-`; copy from the DOM, not from pixels.
- API reachable: **yes** (`/users/self`, `/courses`, `/assignment_groups`,
  `/discussion_topics` all 200 with Bearer auth).
- `enrollment_state=active` returns **9 courses including past terms**
  (2024/25 S2, 2025/26 S1) and Non-Academic shells (RC1010A, THE1001/1002).
  Term filtering (module `term` field) is required to keep old modules off
  the dashboard — bumped on the fast-follow list.
- Current term (2610 = 2026/27 S1): CS4238, CS4239/CS5439, GEC1044, IFS4103.
- Weighted assignment groups: **only IFS4103** has real weights
  (Project 1 20 / Assignments1-4 20 / Project 2 Work 50 / Participation 10).
  CS4238, CS4239, GEC1044 all have weight=0 groups → **LLM syllabus
  extraction is load-bearing for 3 of 4 current modules**, as the spec
  anticipated.
- `syllabus_body`: populated for all current-term modules (~3.8-4.1KB HTML);
  EMPTY only on Non-Academic shells. Extraction source confirmed.
- Announcements: present (CS4239: 5, GEC1044: 5, IFS4103: 3).
- Fixtures captured from live API into `tests/fixtures/canvas/`:
  `courses.json`, `assignment_groups.json` (IFS4103, weighted),
  `announcements.json` (CS4239).

## Graph

- Not yet run — requires the Entra multi-tenant app registration
  (user-gated). Verdict pending.

## LLM provider (added 2026-08-17)

- Decision: use the free Agnes AI endpoint instead of a paid Anthropic key.
- `https://your-openai-compatible-host/v1` (OpenAI-compatible), model
  `agnes-2.5-flash`, key from your provider console. Verified via
  `/v1/models` and a chat completion; follows JSON-only instructions;
  reasoning tokens not separately billed. one-ring gains an
  OpenAI-compatible provider path selected by env.
