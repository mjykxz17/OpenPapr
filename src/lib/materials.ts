import type { FileCategory } from "@/db/schema";

// Display order and names for file categories. Reading order is the order a
// student reaches for things: what was taught, what to do, what to read, what
// to practise. Files nobody has categorised yet sit after the named groups,
// and images last, since they are mostly announcement decoration.
export const CATEGORY_ORDER: { key: FileCategory | "uncategorised"; label: string }[] = [
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

const rank = new Map(CATEGORY_ORDER.map((c, i) => [c.key, i]));

export function categoryLabel(category: string | null): string {
  return CATEGORY_ORDER.find((c) => c.key === (category ?? "uncategorised"))?.label ?? "Other";
}

export function sortMaterials<T extends { displayName: string; category: string | null }>(rows: T[]): T[] {
  const r = (x: T) => rank.get((x.category ?? "uncategorised") as FileCategory | "uncategorised") ?? rank.get("other")!;
  return [...rows].sort((a, b) =>
    r(a) - r(b) || a.displayName.localeCompare(b.displayName, undefined, { numeric: true, sensitivity: "base" }));
}
