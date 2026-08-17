import { z } from "zod";
import { chatJson, type CompatConfig } from "./openai-compat";

// Deadline extraction from announcement/email prose. Contract:
//   null  = LLM call failed or output unusable → caller leaves the item
//           unmarked and retries a later cycle.
//   []    = processed successfully, no dated obligations found → caller marks
//           the item done forever.
// Relative dates are resolved against the item's POSTED time (Asia/Singapore),
// never against the worker's clock.

export interface ExtractedAction { title: string; dueAt: number; evidence: string; }

const ActionsResult = z.object({
  found: z.boolean(),
  actions: z.array(z.object({ title: z.string(), due_at: z.string(), evidence: z.string() })),
});

const WINDOW_PAST_MS = 30 * 24 * 3_600_000;
const WINDOW_FUTURE_MS = 365 * 24 * 3_600_000;

export function parseActions(raw: unknown, referenceMs: number): ExtractedAction[] | null {
  const parsed = ActionsResult.safeParse(raw);
  if (!parsed.success) return null;
  if (!parsed.data.found) return [];
  const out: ExtractedAction[] = [];
  for (const a of parsed.data.actions) {
    const dueAt = Date.parse(a.due_at);
    if (Number.isNaN(dueAt)) continue;
    if (dueAt < referenceMs - WINDOW_PAST_MS || dueAt > referenceMs + WINDOW_FUTURE_MS) continue;
    out.push({ title: a.title, dueAt, evidence: a.evidence });
  }
  return out;
}

const SYSTEM = `You extract concrete student obligations that carry an EXPLICIT date or time from a university announcement or email. Examples: quizzes, registrations, lab closing times, submission windows, compulsory sessions. Resolve relative expressions ("tonight", "this Thursday", "next week") against the provided posted date. Timezone is Asia/Singapore (+08:00); output ISO 8601 timestamps with that offset. Quote the exact sentence as evidence. Skip obligations without an explicit date or time. If there are none, set found=false. Reply with ONLY a JSON object, no prose, no code fences: {"found": boolean, "actions": [{"title": "short imperative label", "due_at": "ISO 8601", "evidence": "verbatim quote"}]}`;

export function createCompatActionExtractor(cfg: CompatConfig, fetchFn: typeof fetch = fetch) {
  return async (item: { title: string; body: string | null; postedAt: number | null }): Promise<ExtractedAction[] | null> => {
    const reference = item.postedAt ?? Date.now();
    try {
      const raw = await chatJson(cfg, fetchFn, SYSTEM,
        `Posted: ${new Date(reference).toISOString()}\nTitle: ${item.title}\n\n${(item.body ?? "").slice(0, 4000)}`, 2048);
      return parseActions(raw, reference);
    } catch {
      return null;
    }
  };
}

export { isDuplicateOfExisting as isDuplicateAction } from "../db/repo";
