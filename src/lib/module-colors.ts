// One colour per module, in the order the modules are listed, shared by the
// home calendar and the Tasks views so CS4238 is the same teal everywhere.
export const MODULE_PALETTE = ["#3b82f6", "#f97316", "#14b8a6", "#8b5cf6", "#ec4899", "#0ea5e9", "#65a30d", "#ca8a04"];
export const NO_MODULE = "#71717a";

export function moduleColors(modules: { id: number }[]): (id: number | null) => string {
  const m = new Map(modules.map((x, i) => [x.id, MODULE_PALETTE[i % MODULE_PALETTE.length]!]));
  return (id) => (id != null ? m.get(id) ?? NO_MODULE : NO_MODULE);
}
