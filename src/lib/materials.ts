import type { FileCategory } from "@/db/schema";

// How a module's files are grouped on its page. Reading order is the order a
// student reaches for things: what was taught, what to do, what to read, what
// to practise. Images come last because they are mostly announcement
// decoration, and files nobody has categorised yet sit just before them.
export type MaterialGroupKey = FileCategory | "uncategorised";

export const MATERIAL_GROUPS: { key: MaterialGroupKey; label: string }[] = [
  { key: "slides", label: "Lecture slides" },
  { key: "tutorial", label: "Tutorials and labs" },
  { key: "assignment", label: "Assignments" },
  { key: "reading", label: "Readings" },
  { key: "practice", label: "Practice and past papers" },
  { key: "admin", label: "Admin" },
  { key: "other", label: "Other" },
  { key: "uncategorised", label: "Uncategorised" },
  { key: "image", label: "Images" },
];

export function groupMaterials<T extends { category: string | null }>(rows: T[]): { key: MaterialGroupKey; label: string; files: T[] }[] {
  return MATERIAL_GROUPS
    .map((g) => ({ ...g, files: rows.filter((r) => (r.category ?? "uncategorised") === g.key) }))
    .filter((g) => g.files.length > 0);
}
