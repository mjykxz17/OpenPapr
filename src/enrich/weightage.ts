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
