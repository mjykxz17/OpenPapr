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

// A module's files as one table, already sorted by category. Rows open the
// file on Canvas itself — the user is signed in there, and Canvas re-signs
// its own download links — so no bytes pass through this app. Files the
// Files tab does not list say where they were found, since that is the only
// way back to them.
export function Materials({ files, canvasBaseUrl, canvasCourseId }: { files: MaterialFile[]; canvasBaseUrl: string; canvasCourseId: number }) {
  if (files.length === 0) return <p className="text-sm text-ink-3">No files recorded yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3">
            <th className="py-1.5 pr-4 font-medium">File</th>
            <th className="py-1.5 pr-4 font-medium">Category</th>
            <th className="py-1.5 pr-4 text-right font-medium">Size</th>
            <th className="py-1.5 font-medium">Where</th>
          </tr>
        </thead>
        <tbody>
          {files.map((f) => (
            <tr key={f.id} className="border-b border-line">
              <td className="max-w-[520px] py-1.5 pr-4">
                <a
                  href={`${canvasBaseUrl}/courses/${canvasCourseId}/files/${f.canvasFileId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate text-ink hover:underline"
                  title={f.displayName}
                >
                  {f.displayName}
                </a>
              </td>
              <td className="whitespace-nowrap py-1.5 pr-4 text-ink-2">{categoryLabel(f.category)}</td>
              <td className="whitespace-nowrap py-1.5 pr-4 text-right text-xs tabular-nums text-ink-3">{size(f.sizeBytes)}</td>
              <td className="max-w-[280px] py-1.5 text-xs text-ink-3">
                {f.hidden ? (
                  <span className="block truncate" title={f.linkedFrom ? `Not in the Files tab. Linked from: ${f.linkedFrom}` : "Not in the Files tab; linked from course content."}>
                    {f.linkedFrom ? `via ${f.linkedFrom}` : "linked from content"}
                  </span>
                ) : (
                  "Files tab"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
