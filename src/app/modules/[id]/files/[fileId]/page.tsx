import Link from "next/link";
import { getDb } from "@/server/db";
import { requireUserId } from "@/server/session";
import { ownedFile } from "@/server/files";
import { listModuleFiles } from "@/db/repo";
import { loadEnv } from "@/lib/env";
import { categoryLabel, sortMaterials } from "@/lib/materials";
import { fileExt, fileKind } from "@/lib/file-kind";
import { AppShell } from "@/components/AppShell";
import { dedupeMaterials } from "@/components/Materials";
import { FileViewer } from "@/components/viewer/FileViewer";
import { FileList, FileSelect, WarmNext, type ListFile } from "@/components/viewer/FileList";

export const dynamic = "force-dynamic";

const size = (bytes: number | null) =>
  bytes == null ? "" : bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(bytes >= 10_000_000 ? 0 : 1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`;

// Any module file, opened inside the app: PDFs and slides in PDF.js, office
// files converted to PDF once on the server, images, video, audio and text
// natively. The module's file list stays beside it for switching.
export default async function FilePage({ params }: { params: Promise<{ id: string; fileId: string }> }) {
  const { id, fileId } = await params;
  const userId = await requireUserId();
  const db = getDb();
  const row = ownedFile(db, userId, Number(id), Number(fileId));
  if (!row) {
    return (
      <AppShell>
        <p className="text-sm text-ink-3">File not found.</p>
        <Link href={`/modules/${id}`} className="mt-2 inline-block text-sm text-accent underline">Back to the module</Link>
      </AppShell>
    );
  }
  const { file, mod } = row;
  const list: ListFile[] = sortMaterials(dedupeMaterials(listModuleFiles(db, mod.id))).map((f) => ({
    id: f.id, name: f.displayName, group: categoryLabel(f.category),
    meta: [fileExt(f.displayName).toUpperCase(), size(f.sizeBytes)].filter(Boolean).join(" · "),
  }));
  if (!list.some((f) => f.id === file.id)) {
    list.push({ id: file.id, name: file.displayName, group: categoryLabel(file.category), meta: size(file.sizeBytes) });
  }

  const kind = fileKind(file.displayName);
  const ext = fileExt(file.displayName);
  const at = list.findIndex((f) => f.id === file.id);
  const next = list.slice(at + 1).find((f) => ["pdf", "office"].includes(fileKind(f.name)));
  const nextRaw = next ? `/api/modules/${mod.id}/files/${next.id}${fileKind(next.name) === "office" ? "?as=pdf" : ""}` : null;
  const canvasUrl = `${loadEnv().CANVAS_BASE_URL}/courses/${mod.canvasCourseId}/files/${file.canvasFileId}`;

  return (
    <AppShell bleed>
      <div className="flex h-dvh flex-col">
        <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-2 sm:px-6">
          <Link href={`/modules/${mod.id}`} className="text-[13px] text-ink-2 hover:text-accent">← {mod.code}</Link>
          <span aria-hidden className="hidden h-4 w-px bg-line sm:block" />
          <h1 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink" title={file.displayName}>{file.displayName}</h1>
          <div className="flex items-center gap-3 text-[13px]">
            <span className="tabular-nums text-ink-3">{[ext.toUpperCase(), size(file.sizeBytes)].filter(Boolean).join(" · ")}</span>
            <a href={`/api/modules/${mod.id}/files/${file.id}?download=1`} className="text-ink-2 hover:text-accent">Download</a>
            <a href={canvasUrl} target="_blank" rel="noreferrer" className="text-ink-3 hover:text-accent" title="Open this file on Canvas">Canvas ↗</a>
          </div>
          <div className="w-full lg:hidden"><FileSelect moduleId={mod.id} files={list} currentId={file.id} /></div>
        </header>
        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)]">
          <nav aria-label="Module files" className="hidden min-h-0 border-r border-line lg:block">
            <FileList moduleId={mod.id} files={list} currentId={file.id} />
          </nav>
          <div className="min-h-0">
            <FileViewer key={file.id} moduleId={mod.id} fileId={file.id} kind={kind} name={file.displayName} ext={ext} />
          </div>
        </div>
      </div>
      <WarmNext href={nextRaw} />
    </AppShell>
  );
}
