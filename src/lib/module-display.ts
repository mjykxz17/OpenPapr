// Canvas names courses "CS4238 Computer Security Practice [2610]". The code
// and the term are shown as their own elements, so the title should carry
// neither; a name that is only the code keeps it rather than going blank.
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

export function moduleDisplay(mod: { code: string; name: string }): { title: string; termCode: string | null } {
  const termCode = mod.name.match(/\[(\d+)\]\s*$/)?.[1] ?? null;
  const title = mod.name
    .replace(new RegExp(`^${escapeRe(mod.code)}\\b[\\s:—-]*`), "")
    .replace(/\s*\[\d+\]\s*$/, "")
    .trim() || mod.name;
  return { title, termCode };
}
