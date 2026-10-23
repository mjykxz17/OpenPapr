// Code fences the way markdown renderers read them (CommonMark): a run of
// three or more backticks or tildes opens a fence, and only a run of the
// same character, at least as long, with nothing else on the line, closes
// it. So a ````markdown block can show a ``` block inside it, and a
// "```python" line inside a fence is code, not its end. Fences may be
// indented, as they are inside list items.
//
// Every guide step that walks fences (normalising, checking, cleaning
// citations) reads them through this, so they all agree on where code is.

export type FenceRole = "open" | "close" | "code" | "text";
export type Fence = { char: string; len: number; indent: string };

const OPEN_RE = /^(\s*)(`{3,}|~{3,})(.*)$/;
const CLOSE_RE = /^(\s*)(`{3,}|~{3,})\s*$/;

export function fenceOpener(line: string): Fence | null {
  const m = line.match(OPEN_RE);
  if (!m) return null;
  // A backtick fence's info string can't hold a backtick: "```a``` b" is
  // inline code.
  if (m[2]![0] === "`" && m[3]!.includes("`")) return null;
  return { char: m[2]![0]!, len: m[2]!.length, indent: m[1]! };
}

export function closesFence(line: string, open: Fence): boolean {
  const m = line.match(CLOSE_RE);
  return !!m && m[2]![0] === open.char && m[2]!.length >= open.len;
}

// What each line is. A fence still open at the end is reported in `open`.
export function fenceRoles(lines: string[]): { roles: FenceRole[]; open: Fence | null } {
  const roles: FenceRole[] = [];
  let open: Fence | null = null;
  for (const line of lines) {
    if (open) {
      if (closesFence(line, open)) { roles.push("close"); open = null; } else roles.push("code");
      continue;
    }
    const f = fenceOpener(line);
    if (f) { roles.push("open"); open = f; } else roles.push("text");
  }
  return { roles, open };
}

// The line that closes a fence that was left open.
export const closingFence = (f: Fence) => `${f.indent}${f.char.repeat(f.len)}`;
