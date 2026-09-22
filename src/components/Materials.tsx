import { categoryLabel } from "@/lib/materials";

export interface MaterialFile {
  id: number;
  canvasFileId: number;
  displayName: string;
  sizeBytes: number | null;
  hidden: boolean;
  linkedFrom: string | null;
  category: string | null;
}

const size = (bytes: number | null) =>
  bytes == null ? "" : bytes >= 1_000_000 ? `${Math.round(bytes / 1_000_000)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`;

const ext = (name: string) => {
  const m = name.match(/\.([a-z0-9]{1,5})$/i);
  return m ? m[1].toUpperCase() : null;
};

// The same deck uploaded twice (or once to Files and once to a page) shows
// once: same name and size means the same bytes. The Files-tab copy wins
// because its link is the stable one.
export function dedupeMaterials<T extends { displayName: string; sizeBytes: number | null; hidden: boolean }>(files: T[]): T[] {
  const seen = new Map<string, T>();
  for (const f of files) {
    const key = `${f.displayName.toLowerCase()}|${f.sizeBytes ?? ""}`;
    const prev = seen.get(key);
    if (!prev || (prev.hidden && !f.hidden)) seen.set(key, f);
  }
  const kept = new Set(seen.values());
  return files.filter((f) => kept.has(f));
}

// A module's files grouped by category. The groups flow into columns
// (CSS multi-column, each group unbreakable) rather than sitting in a grid,
// so a twelve-row group beside a four-row one leaves no hole, and short
// groups stack under each other. Rows open the file on Canvas itself — the
// user is signed in there, and Canvas re-signs its own download links — so
// no bytes pass through this app. Files the Files tab does not list say
// where they were found, since that is the only way back to them.
export function Materials({ files: allFiles, canvasBaseUrl, canvasCourseId }: { files: MaterialFile[]; canvasBaseUrl: string; canvasCourseId: number }) {
  const files = dedupeMaterials(allFiles);
  if (files.length === 0) return <p className="text-sm text-ink-3">No files recorded yet.</p>;

  const groups: { label: string; rows: MaterialFile[] }[] = [];
  for (const f of files) {
    const label = categoryLabel(f.category);
    const g = groups[groups.length - 1];
    if (g && g.label === label) g.rows.push(f);
    else groups.push({ label, rows: [f] });
  }

  return (
    <div className="columns-1 gap-x-12 lg:columns-2">
      {groups.map((g) => (
        <ul key={g.label} className="mb-6 flex break-inside-avoid flex-col">
          <li className="pb-2 text-[13px] font-semibold text-ink-2">
            {g.label} <span className="font-normal tabular-nums text-ink-3">· {g.rows.length}</span>
          </li>
          {g.rows.map((f) => {
            const meta = [ext(f.displayName), size(f.sizeBytes) || null].filter(Boolean).join(" · ");
            const where = f.hidden ? (f.linkedFrom ? `linked from ${f.linkedFrom}` : "linked from course content") : null;
            return (
              <li key={f.id} className="flex items-baseline justify-between gap-4 border-t border-line py-2">
                <a
                  href={`${canvasBaseUrl}/courses/${canvasCourseId}/files/${f.canvasFileId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 truncate text-sm text-ink hover:text-accent hover:underline"
                  title={f.displayName}
                >
                  {f.displayName}
                </a>
                <span className="shrink-0 text-[13px] tabular-nums text-ink-3" title={where ?? undefined}>
                  {meta}
                  {where && <> · {where}</>}
                </span>
              </li>
            );
          })}
        </ul>
      ))}
    </div>
  );
}
