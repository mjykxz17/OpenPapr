import type { MaterialGroupKey } from "@/lib/materials";

export interface MaterialFile {
  id: number;
  canvasFileId: number;
  displayName: string;
  sizeBytes: number | null;
  hidden: boolean;
  linkedFrom: string | null;
}

export interface MaterialGroup { key: MaterialGroupKey; label: string; files: MaterialFile[] }

const size = (bytes: number | null) =>
  bytes == null ? "" : bytes >= 1_000_000 ? `${Math.round(bytes / 1_000_000)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`;

// A module's files, grouped by what they are. Rows open the file on Canvas
// itself — the user is signed in there, and Canvas re-signs its own download
// links — so no bytes pass through this app. Files the Files tab does not
// list say where they were found, since that is the only way back to them.
export function Materials({ groups, canvasBaseUrl, canvasCourseId }: { groups: MaterialGroup[]; canvasBaseUrl: string; canvasCourseId: number }) {
  if (groups.length === 0) return <p className="text-sm text-ink-3">No files recorded yet.</p>;
  return (
    <div className="space-y-5">
      {groups.map((g) => {
        const list = (
          <ul className="divide-y divide-line">
            {g.files.map((f) => (
              <li key={f.id} className="flex items-baseline gap-3 py-1.5 text-sm">
                <a
                  href={`${canvasBaseUrl}/courses/${canvasCourseId}/files/${f.canvasFileId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 flex-1 truncate text-ink hover:underline"
                  title={f.displayName}
                >
                  {f.displayName}
                </a>
                {f.hidden && f.linkedFrom && (
                  <span className="shrink-0 truncate text-[11px] text-ink-3" title={`Not in the Files tab. Linked from: ${f.linkedFrom}`}>
                    via {f.linkedFrom.length > 28 ? `${f.linkedFrom.slice(0, 28)}…` : f.linkedFrom}
                  </span>
                )}
                <span className="w-[52px] shrink-0 text-right text-xs tabular-nums text-ink-3">{size(f.sizeBytes)}</span>
              </li>
            ))}
          </ul>
        );
        // Images are almost always inline decoration from announcements; keep
        // them out of the way unless asked for.
        if (g.key === "image") {
          return (
            <details key={g.key}>
              <summary className="cursor-pointer select-none text-xs font-medium uppercase tracking-wide text-ink-3 hover:text-ink-2">
                {g.label} ({g.files.length})
              </summary>
              <div className="mt-2">{list}</div>
            </details>
          );
        }
        return (
          <div key={g.key}>
            <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-3">
              {g.label} <span className="font-normal normal-case tracking-normal text-ink-3/70">{g.files.length}</span>
            </h3>
            {list}
          </div>
        );
      })}
    </div>
  );
}
