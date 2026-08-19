import { z } from "zod";
import { chatJson, type CompatConfig } from "./openai-compat";

// Batched deadline classification: one call per cycle, never per item.
//   null = call failed → caller retries a later cycle.
//   Map  = every REQUESTED id has a category; ids the model omitted default to
//          "deliverable" (fail-open — never demote on silence), hallucinated
//          ids are dropped.

export type DeadlineCategory = "deliverable" | "routine";

const ClassificationResult = z.object({
  classifications: z.array(z.object({ id: z.number(), category: z.enum(["deliverable", "routine"]) })),
});

const SYSTEM = `You rank university to-do items for a student. "deliverable": anything with direct grade or administrative consequence — submissions, reports, quizzes, exams, registrations, surveys, license collection. "routine": recurring attendance and logistics — attend lecture/lab/tutorial, bring equipment, watch recorded lecture. Reply with ONLY a JSON object, no prose, no code fences: {"classifications": [{"id": number, "category": "deliverable"|"routine"}]}`;

export function createCompatDeadlineClassifier(cfg: CompatConfig, fetchFn: typeof fetch = fetch) {
  return async (deadlines: { id: number; title: string; module: string | null }[]): Promise<Map<number, DeadlineCategory> | null> => {
    if (deadlines.length === 0) return new Map();
    try {
      const raw = await chatJson(cfg, fetchFn, SYSTEM,
        deadlines.map((d) => `id=${d.id} [${d.module ?? "?"}] ${d.title}`).join("\n"), 2048);
      const parsed = ClassificationResult.safeParse(raw);
      if (!parsed.success) return null;
      const requested = new Set(deadlines.map((d) => d.id));
      const out = new Map<number, DeadlineCategory>();
      for (const c of parsed.data.classifications) if (requested.has(c.id)) out.set(c.id, c.category);
      for (const d of deadlines) if (!out.has(d.id)) out.set(d.id, "deliverable");
      return out;
    } catch {
      return null;
    }
  };
}
