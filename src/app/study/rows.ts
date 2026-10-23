import { guideEntry, type GuideState } from "@/components/module/guide-entry";

// The Guides list: every module, not only those with a guide, so a module
// without one says why. Modules with a guide come first, newest first; the
// rest follow in the home screen's order. A module hidden from home is left
// out unless it has a guide.

export type StudyModule = { id: number; code: string; name: string; hidden: boolean; position: number | null };
export type StudyGuideRow = { moduleId: number; title: string | null; sourceNote: string | null; generatedAt: number };
export type StudyRow = { moduleId: number; code: string; name: string; title: string | null; guide: StudyGuideRow | null; note: string };

export function studyRows(
  mods: StudyModule[], guides: StudyGuideRow[], status: (moduleId: number) => Omit<GuideState, "hasGuide" | "canWrite" | "demo">, canWrite: boolean, demo = false,
): StudyRow[] {
  const byModule = new Map(guides.map((g) => [g.moduleId, g]));
  const rows: StudyRow[] = [];
  for (const m of mods) {
    const g = byModule.get(m.id) ?? null;
    if (!g && m.hidden) continue;
    const note = g ? "" : guideEntry({ ...status(m.id), hasGuide: false, canWrite, demo }).note;
    rows.push({ moduleId: m.id, code: m.code, name: m.name, title: g?.title ?? null, guide: g, note });
  }
  // Placed modules by their saved position, then unplaced ones by id, as on Home.
  const order = new Map(mods.map((m) => [m.id, m.position ?? 1e9 + m.id]));
  return rows.sort((a, b) => Number(Boolean(b.guide)) - Number(Boolean(a.guide))
    || (b.guide?.generatedAt ?? 0) - (a.guide?.generatedAt ?? 0)
    || (order.get(a.moduleId) ?? 0) - (order.get(b.moduleId) ?? 0));
}
