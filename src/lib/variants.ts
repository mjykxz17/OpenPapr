// One piece of work posted once per tutorial group: "Indemnity Form (TD1)",
// "Indemnity Form (TD2)" … "Indemnity Form (TE12)". The student does only
// their own, so the set reads as one to-do, and submitting any one clears it.

// A trailing group code: letters then digits, as in TD11, G03, B2, T01A.
const VARIANT_RE = /^(.*?\S)[\s\-–:_]*[([]?\b([A-Z]{1,4}\d{1,3}[A-Z]?)\b[)\]]?\s*$/;
export const MIN_VARIANTS = 4;
const DAY = 86_400_000;

export function variantStem(title: string): string | null {
  const m = VARIANT_RE.exec(title.trim());
  if (!m) return null;
  const stem = m[1].replace(/[\s\-–:_([]+$/, "").trim();
  return stem.length >= 3 ? stem : null;
}

export type VariantGroup = { key: string; stem: string; ids: number[] };

// Groups of assignments in one module that share a stem and a due day.
export function variantGroups(rows: { id: number; moduleId: number | null; type: string; title: string; dueAt: number | null }[]): Map<number, VariantGroup> {
  const groups = new Map<string, VariantGroup>();
  for (const r of rows) {
    if (r.type !== "assignment" || r.moduleId === null) continue;
    const stem = variantStem(r.title);
    if (!stem) continue;
    const day = r.dueAt === null ? "none" : String(Math.floor((r.dueAt + 8 * 3_600_000) / DAY));
    const key = `${r.moduleId}::${stem.toLowerCase()}::${day}`;
    const g = groups.get(key) ?? { key, stem, ids: [] };
    g.ids.push(r.id);
    groups.set(key, g);
  }
  const byItem = new Map<number, VariantGroup>();
  for (const g of groups.values()) if (g.ids.length >= MIN_VARIANTS) {
    g.ids.sort((a, b) => a - b);
    for (const id of g.ids) byItem.set(id, g);
  }
  return byItem;
}
