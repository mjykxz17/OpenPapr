"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

export type ListFile = { id: number; name: string; group: string; meta: string };

// The module's files beside the viewer: switching is one click (or j/k), and
// the list keeps its place because only the viewer re-renders.
export function FileList({ moduleId, files, currentId }: { moduleId: number; files: ListFile[]; currentId: number }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? files.filter((f) => f.name.toLowerCase().includes(needle)) : files;
  }, [files, q]);

  useEffect(() => {
    listRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest" });
  }, [currentId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== "j" && e.key !== "k") return;
      const i = shown.findIndex((f) => f.id === currentId);
      const next = shown[i + (e.key === "j" ? 1 : -1)];
      if (next) { e.preventDefault(); router.push(`/modules/${moduleId}/files/${next.id}`); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown, currentId, moduleId, router]);

  let lastGroup = "";
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 p-2">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter files"
          aria-label="Filter files"
          className="h-8 w-full rounded-md border border-line-2 bg-surface px-2.5 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-accent" />
      </div>
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-1 pb-3">
        {shown.length === 0 && <p className="px-2 py-3 text-[13px] text-ink-3">No match.</p>}
        {shown.map((f) => {
          const header = f.group !== lastGroup ? f.group : null;
          lastGroup = f.group;
          const active = f.id === currentId;
          return (
            <div key={f.id}>
              {header && <p className="px-2 pb-1 pt-3 text-[12px] font-semibold text-ink-2">{header}</p>}
              <Link href={`/modules/${moduleId}/files/${f.id}`} aria-current={active ? "page" : undefined} title={f.name}
                className={`block rounded-md px-2 py-1.5 text-[13px] transition-colors ${
                  active ? "bg-accent-soft text-ink" : "text-ink-2 hover:bg-ink/[0.05] hover:text-ink"
                }`}>
                <span className="block truncate">{f.name}</span>
                <span className="block text-[11px] tabular-nums text-ink-3">{f.meta}</span>
              </Link>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Mobile: the same list as a select, since there is no room for a column.
export function FileSelect({ moduleId, files, currentId }: { moduleId: number; files: ListFile[]; currentId: number }) {
  const router = useRouter();
  return (
    <select aria-label="Switch file" value={currentId} onChange={(e) => router.push(`/modules/${moduleId}/files/${e.target.value}`)}
      className="h-9 w-full rounded-md border border-line-2 bg-surface px-2 text-[13px] text-ink lg:hidden">
      {files.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
    </select>
  );
}

// Asks the server to fetch the next file from Canvas while this one is being
// read, so switching to it is instant. One byte comes back; the server keeps
// the rest on its disk.
export function WarmNext({ href }: { href: string | null }) {
  useEffect(() => {
    if (!href) return;
    const t = setTimeout(() => { void fetch(href, { headers: { Range: "bytes=0-0" } }).catch(() => {}); }, 2500);
    return () => clearTimeout(t);
  }, [href]);
  return null;
}
