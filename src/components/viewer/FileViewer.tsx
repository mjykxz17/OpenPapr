"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { FileKind } from "@/lib/file-kind";

// PDF.js is ~1MB; only pages that show a PDF load it.
const PdfViewer = dynamic(() => import("./PdfViewer").then((m) => m.PdfViewer), {
  ssr: false,
  loading: () => <p className="p-8 text-center text-sm text-ink-2">Opening…</p>,
});

export function FileViewer({ moduleId, fileId, kind, name, ext }: {
  moduleId: number; fileId: number; kind: FileKind; name: string; ext: string;
}) {
  const raw = `/api/modules/${moduleId}/files/${fileId}`;
  const key = `file-page:${moduleId}:${fileId}`;

  if (kind === "pdf") return <PdfViewer src={raw} storageKey={key} />;
  if (kind === "office") {
    return (
      <PdfViewer src={`${raw}?as=pdf`} storageKey={key}
        preparing={`Preparing ${ext.toUpperCase()} preview — the first open converts it, later opens are instant`} />
    );
  }
  if (kind === "image") return <ImageView src={raw} name={name} />;
  if (kind === "video") {
    return (
      <div className="flex h-full items-center justify-center bg-black">
        <video src={raw} controls preload="metadata" className="max-h-full max-w-full" />
      </div>
    );
  }
  if (kind === "audio") {
    return <div className="flex h-full items-center justify-center p-8"><audio src={raw} controls preload="metadata" className="w-full max-w-xl" /></div>;
  }
  if (kind === "text") return <TextView src={raw} ext={ext} />;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="text-sm text-ink-2">{ext ? `.${ext} files` : "This file"} can’t be previewed here.</p>
      <a href={`${raw}?download=1`} className="h-9 rounded-md bg-accent px-4 text-sm font-medium leading-9 text-on-accent hover:bg-accent-strong">
        Download {name}
      </a>
    </div>
  );
}

function ImageView({ src, name }: { src: string; name: string }) {
  const [actual, setActual] = useState(false);
  return (
    <div className={`h-full overflow-auto bg-sunken ${actual ? "" : "flex items-center justify-center"} p-4`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={name} onClick={() => setActual((a) => !a)} title={actual ? "Fit to window" : "Actual size"}
        className={actual ? "max-w-none cursor-zoom-out" : "max-h-full max-w-full cursor-zoom-in object-contain"} />
    </div>
  );
}

const MAX_TEXT = 2_000_000;

function parseCsv(text: string, sep: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
      if (rows.length >= 5000) break;
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function TextView({ src, ext }: { src: string; ext: string }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(src, { headers: { Range: `bytes=0-${MAX_TEXT - 1}` } });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? "could not load this file");
        }
        const t = await res.text();
        if (!cancelled) setText(t);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "could not load this file");
      }
    })();
    return () => { cancelled = true; };
  }, [src]);

  if (error) return <p role="alert" className="p-8 text-center text-sm text-danger">{error}</p>;
  if (text === null) return <p className="p-8 text-center text-sm text-ink-2">Opening…</p>;

  if (ext === "csv" || ext === "tsv") {
    const rows = parseCsv(text, ext === "tsv" ? "\t" : ",");
    const [head, ...body] = rows;
    return (
      <div className="h-full overflow-auto">
        <table className="min-w-full border-collapse text-[13px] tabular-nums">
          {head && (
            <thead className="sticky top-0 bg-panel">
              <tr>{head.map((h, i) => <th key={i} className="border-b border-line-2 px-3 py-2 text-left font-semibold text-ink">{h}</th>)}</tr>
            </thead>
          )}
          <tbody>
            {body.map((r, i) => (
              <tr key={i} className="even:bg-sunken">
                {r.map((c, j) => <td key={j} className="border-b border-line px-3 py-1.5 whitespace-nowrap text-ink">{c}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <pre className="h-full overflow-auto whitespace-pre-wrap break-words p-6 font-mono text-[13px] leading-relaxed text-ink">
      {text}
      {text.length >= MAX_TEXT && "\n\n… (showing the first 2 MB — download for the rest)"}
    </pre>
  );
}
