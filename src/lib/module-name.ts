// Canvas course names repeat the code and carry a term id:
// "CS4239/CS5439 Software Security [2610]" → "Software Security".
export function shortModuleName(code: string, name: string): string {
  let n = name.replace(/\s*\[[^\]]*\]\s*$/, "").trim();
  const lead = new RegExp(`^(?:[A-Z]{2,4}\\d{4}[A-Z]{0,2}\\s*[/,&]\\s*)*${code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[A-Z]{0,2}(?:\\s*[/,&]\\s*[A-Z]{2,4}\\d{4}[A-Z]{0,2})*[\\s:\\-–]*`);
  n = n.replace(lead, "").trim();
  return n || name;
}

// Syllabus component names carry codes and asides: "Group Field Work
// (Medicine Hall) (CA3)" → "Group Field Work". Keeps the name if that would
// leave nothing.
export function shortComponentName(name: string): string {
  const n = name.replace(/\s*\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
  return n || name;
}
