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
