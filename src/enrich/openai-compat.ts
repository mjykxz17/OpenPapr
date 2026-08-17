import { z } from "zod";
import type { LlmScore } from "./llm";
import type { ExtractedComponent, WeightageSourceText } from "./weightage";

// OpenAI-compatible provider (Agnes agrouter). Same contracts as ./llm and
// ./weightage, but JSON is requested in the prompt and validated with zod —
// no server-side structured outputs. Both functions stay fail-open.

export interface CompatConfig { baseUrl: string; apiKey: string; model: string; }

const EmailScore = z.object({ important: z.boolean(), score: z.number(), reason: z.string() });
const WeightageResult = z.object({
  found: z.boolean(),
  components: z.array(z.object({ name: z.string(), weight_pct: z.number(), evidence: z.string() })),
});

export function extractJson(text: string): unknown | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function chatJson(cfg: CompatConfig, fetchFn: typeof fetch, system: string, user: string, maxTokens: number): Promise<unknown | null> {
  const res = await fetchFn(`${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`llm ${res.status}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return extractJson(data.choices?.[0]?.message?.content ?? "");
}

const SCORER_SYSTEM = `You triage university email for an NUS undergraduate. Important: anything from professors or the university that affects their modules, grades, deadlines, exams, or enrolment. Garbage: newsletters, event promotion, mass CC blasts, vendor marketing. Reply with ONLY a JSON object, no prose, no code fences: {"important": boolean, "score": number 0..1 (1 = must see today), "reason": "one short line a student can read at a glance"}`;

export function createCompatScorer(cfg: CompatConfig, fetchFn: typeof fetch = fetch) {
  return async (mail: { sender: string | null; title: string; body: string | null }): Promise<LlmScore> => {
    try {
      const raw = await chatJson(cfg, fetchFn, SCORER_SYSTEM,
        `From: ${mail.sender ?? "unknown"}\nSubject: ${mail.title}\n\n${(mail.body ?? "").slice(0, 2000)}`, 1024);
      const parsed = EmailScore.safeParse(raw);
      if (!parsed.success) return { triage: "unscored", importance: null, reason: "llm unavailable" };
      const { score, reason } = parsed.data;
      const triage = score >= 0.6 ? "important" : score <= 0.2 ? "garbage" : "ambiguous";
      return { triage, importance: score, reason };
    } catch {
      return { triage: "unscored", importance: null, reason: "llm unavailable" };
    }
  };
}

const WEIGHTAGE_SYSTEM = `You extract assessment component weightage from university course materials. Report only weightings explicitly stated in the sources, quoting the exact sentence as evidence. If the sources do not state a complete weightage breakdown, set found=false and return no components — never guess or fill gaps. Reply with ONLY a JSON object, no prose, no code fences: {"found": boolean, "components": [{"name": string, "weight_pct": number, "evidence": "verbatim quote"}]}`;

export function createCompatWeightageExtractor(cfg: CompatConfig, fetchFn: typeof fetch = fetch) {
  return async (texts: WeightageSourceText[]): Promise<ExtractedComponent[] | null> => {
    if (texts.length === 0) return null;
    try {
      const raw = await chatJson(cfg, fetchFn, WEIGHTAGE_SYSTEM,
        texts.map((t) => `=== ${t.label} ===\n${t.text.slice(0, 20_000)}`).join("\n\n")
          + "\n\nExtract the assessment weightage breakdown for this module.", 2048);
      const parsed = WeightageResult.safeParse(raw);
      if (!parsed.success || !parsed.data.found || parsed.data.components.length === 0) return null;
      const sum = parsed.data.components.reduce((s, c) => s + c.weight_pct, 0);
      if (sum < 90 || sum > 110) return null;
      return parsed.data.components.map((c) => ({ name: c.name, weightPct: c.weight_pct, evidence: c.evidence }));
    } catch {
      return null;
    }
  };
}
