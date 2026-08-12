import type { ComponentRow, ItemRow, Overview } from "@/server/overview";

// manual > llm_syllabus > canvas_api — mirrors src/server/overview.ts's dedup precedence,
// but here it drives *display* (which row is "shadowed"), not dedup.
export const SOURCE_PRECEDENCE: Record<ComponentRow["source"], number> = {
  manual: 3,
  llm_syllabus: 2,
  canvas_api: 1,
};

export const SOURCE_LABEL: Record<ComponentRow["source"], string> = {
  canvas_api: "canvas",
  llm_syllabus: "syllabus*",
  manual: "manual",
};

/** Every component row for a module, annotated with whether a higher-precedence row shadows it. */
export function withShadowFlags(rows: ComponentRow[]): (ComponentRow & { shadowed: boolean })[] {
  const bestByName = new Map<string, number>();
  for (const r of rows) {
    const key = r.name.toLowerCase();
    const prec = SOURCE_PRECEDENCE[r.source];
    const existing = bestByName.get(key);
    if (existing === undefined || prec > existing) bestByName.set(key, prec);
  }
  return rows.map((r) => ({ ...r, shadowed: SOURCE_PRECEDENCE[r.source] < (bestByName.get(r.name.toLowerCase()) ?? 0) }));
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Loose match used only to decide whether a to-do gets a weight badge — never affects ordering. */
export function fuzzyMatch(title: string, componentName: string): boolean {
  const t = normalize(title);
  const c = normalize(componentName);
  if (!t || !c) return false;
  if (t.includes(c) || c.includes(t)) return true;
  const cWords = c.split(" ").filter((w) => w.length > 2);
  if (cWords.length === 0) return false;
  const tWords = new Set(t.split(" ").filter((w) => w.length > 2));
  return cWords.some((w) => tWords.has(w));
}

export function findWeightBadge(todo: ItemRow, modules: Overview["modules"]): number | null {
  if (todo.moduleId == null) return null;
  const mod = modules.find((m) => m.id === todo.moduleId);
  if (!mod) return null;
  const match = mod.components.find((c) => c.weightPct != null && fuzzyMatch(todo.title, c.name));
  return match?.weightPct ?? null;
}
