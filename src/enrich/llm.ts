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
