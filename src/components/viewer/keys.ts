// The PDF viewer listens for its keys on the whole window, so it has to
// leave alone the ones meant for something else on the page: typing in a
// field, a key another handler already took, and Space on a button or link
// (Papi in the rail, the toolbar), which presses it — taking that Space to
// turn the page swallowed the press.
type Target = { isContentEditable?: boolean; tagName?: string; closest?: (selector: string) => unknown } | null;

export function viewerTakesKey(e: { key: string; defaultPrevented: boolean; target: unknown }): boolean {
  if (e.defaultPrevented) return false;
  const t = e.target as Target;
  if (t?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName ?? "")) return false;
  if ((e.key === " " || e.key === "Enter") && t?.closest?.("button, a[href], summary, [role=button], [role=tab]")) return false;
  return true;
}
