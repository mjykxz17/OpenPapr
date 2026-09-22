"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";

// PDFs render in the browser with PDF.js rather than as server-drawn images:
// the server only streams byte ranges from its cache, so the first page of a
// 20MB deck shows as soon as its bytes arrive, text can be selected and
// searched with the browser, and zooming never waits on the server.

type Fit = "page" | "width" | number; // number = fixed zoom, 1 = 100%

const MAX_DPR = 2;
const MAX_CANVAS_PIXELS = 16_000_000;
const KEEP_RENDERED = 6; // pages either side of the current one kept in memory
const GAP = 16;

type PdfJs = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<PdfJs> | null = null;
function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= import("pdfjs-dist").then((m) => {
    m.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
    return m;
  });
  return pdfjsPromise;
}

type Size = { w: number; h: number }; // at scale 1, in CSS px

export function PdfViewer({ src, storageKey, preparing }: { src: string; storageKey: string; preparing?: string }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<Size[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(0); // bytes, for the loading line
  const [fit, setFit] = useState<Fit>("page");
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [current, setCurrent] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const pdfjsRef = useRef<PdfJs | null>(null);

  // --- load -----------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    let task: ReturnType<PdfJs["getDocument"]> | null = null;
    setDoc(null); setSizes([]); setError(null); setLoaded(0);
    (async () => {
      try {
        const pdfjs = await loadPdfJs();
        pdfjsRef.current = pdfjs;
        task = pdfjs.getDocument({
          url: src,
          rangeChunkSize: 256 * 1024,
          cMapUrl: "/pdfjs/cmaps/",
          cMapPacked: true,
          standardFontDataUrl: "/pdfjs/standard_fonts/",
          wasmUrl: "/pdfjs/wasm/",
          withCredentials: true,
        });
        task.onProgress = ({ loaded: l }: { loaded: number }) => { if (!cancelled) setLoaded(l); };
        const d = await task.promise;
        if (cancelled) { void d.destroy(); return; }
        // Every page gets the first page's size until its own is known, so the
        // scrollbar is right immediately; decks are nearly always uniform.
        const first = (await d.getPage(1)).getViewport({ scale: 1 });
        const initial = Array.from({ length: d.numPages }, () => ({ w: first.width, h: first.height }));
        if (cancelled) return;
        setFit(first.width >= first.height ? "page" : "width");
        setSizes(initial);
        setDoc(d);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setError(/Unexpected server response \((\d+)\)/.test(msg)
          ? await describeHttpError(src)
          : "This PDF could not be opened.");
      }
    })();
    return () => { cancelled = true; void task?.destroy(); };
  }, [src]);

  // --- container size ---------------------------------------------------
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const base = sizes[0];
  const scale = (() => {
    if (!base || box.w === 0) return 1;
    const availW = Math.max(200, box.w - 48);
    const availH = Math.max(200, box.h - 2 * GAP);
    if (fit === "width") return availW / base.w;
    if (fit === "page") return Math.min(availW / base.w, availH / base.h);
    return fit;
  })();

  // --- page tracking ---------------------------------------------------
  const offsets = (() => {
    const out: number[] = [];
    let y = GAP;
    for (const s of sizes) { out.push(y); y += Math.round(s.h * scale) + GAP; }
    return { tops: out, total: y };
  })();

  const pageAt = useCallback((scrollTop: number, viewH: number) => {
    const mid = scrollTop + viewH / 3;
    let lo = 0, hi = offsets.tops.length - 1, ans = 0;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (offsets.tops[m]! <= mid) { ans = m; lo = m + 1; } else hi = m - 1;
    }
    return ans + 1;
  }, [offsets.tops]);

  const [scrollTop, setScrollTop] = useState(0);
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    setScrollTop(el.scrollTop);
    const p = pageAt(el.scrollTop, el.clientHeight);
    if (p !== current) { setCurrent(p); setPageInput(String(p)); }
  };

  const goTo = useCallback((page: number, smooth = false) => {
    const el = scroller.current;
    if (!el || sizes.length === 0) return;
    const p = Math.min(Math.max(1, page), sizes.length);
    el.scrollTo({ top: offsets.tops[p - 1]! - GAP, behavior: smooth ? "smooth" : "auto" });
    setCurrent(p); setPageInput(String(p));
  }, [offsets.tops, sizes.length]);

  // Keep the same page in view across zoom changes and resizes.
  const anchor = useRef(1);
  useEffect(() => { anchor.current = current; }, [current]);
  const firstLayout = useRef(true);
  useLayoutEffect(() => {
    if (!doc) return;
    if (firstLayout.current) {
      firstLayout.current = false;
      let saved = 1;
      try { saved = Number(localStorage.getItem(storageKey)) || 1; } catch { /* storage off */ }
      goTo(saved);
      return;
    }
    goTo(anchor.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, scale]);

  useEffect(() => {
    if (!doc) return;
    try { localStorage.setItem(storageKey, String(current)); } catch { /* storage off */ }
  }, [current, doc, storageKey]);

  // --- keyboard ---------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowRight" || e.key === "PageDown" || (e.key === " " && fit === "page")) { e.preventDefault(); goTo(current + 1); }
      else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); goTo(current - 1); }
      else if (e.key === "Home") { e.preventDefault(); goTo(1); }
      else if (e.key === "End") { e.preventDefault(); goTo(sizes.length); }
      else if (e.key === "+" || e.key === "=") { e.preventDefault(); zoom(1.2); }
      else if (e.key === "-") { e.preventDefault(); zoom(1 / 1.2); }
      else if (e.key === "0") { e.preventDefault(); setFit("page"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const zoom = (factor: number) => setFit(Math.min(4, Math.max(0.25, Math.round(scale * factor * 100) / 100)));

  // --- which pages to draw ----------------------------------------------
  const viewH = box.h || 800;
  const visible: number[] = [];
  for (let i = 0; i < sizes.length; i++) {
    const top = offsets.tops[i]!, bottom = top + sizes[i]!.h * scale;
    if (bottom >= scrollTop - viewH && top <= scrollTop + viewH * 2) visible.push(i + 1);
  }
  const keep = new Set<number>();
  for (let p = current - KEEP_RENDERED; p <= current + KEEP_RENDERED; p++) keep.add(p);
  for (const p of visible) keep.add(p);

  const onSize = useCallback((page: number, s: Size) => {
    setSizes((prev) => {
      const old = prev[page - 1];
      if (!old || (Math.abs(old.w - s.w) < 0.5 && Math.abs(old.h - s.h) < 0.5)) return prev;
      const next = prev.slice(); next[page - 1] = s; return next;
    });
  }, []);

  const pct = Math.round(scale * 100);
  const btn = "flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-[13px] text-ink-2 transition-colors hover:bg-ink/[0.06] hover:text-ink disabled:opacity-40";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 overflow-x-auto border-b border-line bg-surface px-2 whitespace-nowrap">
        <div className="flex items-center gap-1">
          <button type="button" className={btn} onClick={() => goTo(current - 1)} disabled={!doc || current <= 1} aria-label="Previous page" title="Previous page (←)">‹</button>
          <form onSubmit={(e) => { e.preventDefault(); goTo(Number(pageInput) || 1); }} className="flex items-center gap-1.5 text-[13px] tabular-nums text-ink-2">
            <input aria-label="Page" value={pageInput} onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ""))}
              onFocus={(e) => e.currentTarget.select()} disabled={!doc}
              className="h-8 w-12 rounded-md border border-line-2 bg-surface text-center text-ink outline-none focus:border-accent" />
            <span>/ {sizes.length || "–"}</span>
          </form>
          <button type="button" className={btn} onClick={() => goTo(current + 1)} disabled={!doc || current >= sizes.length} aria-label="Next page" title="Next page (→)">›</button>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" className={btn} onClick={() => zoom(1 / 1.2)} disabled={!doc} aria-label="Zoom out" title="Zoom out (−)">−</button>
          <span className="hidden w-12 text-center text-[13px] tabular-nums text-ink-2 sm:inline">{pct}%</span>
          <button type="button" className={btn} onClick={() => zoom(1.2)} disabled={!doc} aria-label="Zoom in" title="Zoom in (+)">+</button>
          <span aria-hidden className="mx-1 hidden h-4 w-px bg-line sm:block" />
          <button type="button" className={`${btn} ${fit === "page" ? "bg-accent-soft text-ink" : ""}`} onClick={() => setFit("page")} disabled={!doc} aria-pressed={fit === "page"} title="Fit page (0)">Page</button>
          <button type="button" className={`${btn} ${fit === "width" ? "bg-accent-soft text-ink" : ""}`} onClick={() => setFit("width")} disabled={!doc} aria-pressed={fit === "width"}><span className="hidden sm:inline">Width</span><span className="sm:hidden" aria-hidden>↔</span></button>
        </div>
      </div>

      <div ref={scroller} onScroll={onScroll} tabIndex={-1} className="relative min-h-0 flex-1 overflow-auto bg-sunken outline-none">
        {error ? (
          <p role="alert" className="p-8 text-center text-sm text-danger">{error}</p>
        ) : !doc ? (
          <p className="p-8 text-center text-sm text-ink-2" role="status">
            {preparing ?? "Opening"}{loaded > 0 ? ` · ${(loaded / 1e6).toFixed(1)} MB` : "…"}
          </p>
        ) : (
          <div className="relative mx-auto" style={{ height: offsets.total, width: Math.max(...sizes.map((s) => s.w)) * scale + 48 }}>
            {sizes.map((s, i) => {
              const page = i + 1;
              return (
                <PdfPage key={page} doc={doc} pdfjs={pdfjsRef.current!} page={page} scale={scale} size={s}
                  top={offsets.tops[i]!} draw={keep.has(page)} onSize={onSize} />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

async function describeHttpError(src: string): Promise<string> {
  try {
    const res = await fetch(src, { headers: { Range: "bytes=0-0" } });
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    if (body?.error) return body.error.charAt(0).toUpperCase() + body.error.slice(1) + ".";
  } catch { /* offline */ }
  return "This file could not be loaded.";
}

const PdfPage = memo(function PdfPage({ doc, pdfjs, page, scale, size, top, draw, onSize }: {
  doc: PDFDocumentProxy; pdfjs: PdfJs; page: number; scale: number; size: Size; top: number; draw: boolean;
  onSize: (page: number, s: Size) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [drawn, setDrawn] = useState<number | null>(null); // scale it was drawn at
  const drawnRef = useRef<number | null>(null);

  useEffect(() => {
    if (!draw) {
      // Free the bitmap of pages far from view; big decks would otherwise hold
      // hundreds of full-resolution canvases.
      const c = canvasRef.current;
      if (c) { c.width = 0; c.height = 0; }
      if (textRef.current) textRef.current.replaceChildren();
      drawnRef.current = null;
      setDrawn(null);
      return;
    }
    if (drawnRef.current === scale) return;
    let cancelled = false;
    let task: RenderTask | null = null;
    let textLayer: { cancel: () => void } | null = null;
    (async () => {
      let p: PDFPageProxy;
      try { p = await doc.getPage(page); } catch { return; }
      if (cancelled) return;
      const vp1 = p.getViewport({ scale: 1 });
      onSize(page, { w: vp1.width, h: vp1.height });
      const vp = p.getViewport({ scale });
      const canvas = canvasRef.current;
      if (!canvas) return;
      let dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      if (vp.width * vp.height * dpr * dpr > MAX_CANVAS_PIXELS) dpr = Math.sqrt(MAX_CANVAS_PIXELS / (vp.width * vp.height));
      // Draw offscreen first, so the old bitmap stays up until the new one is ready.
      const off = document.createElement("canvas");
      off.width = Math.floor(vp.width * dpr);
      off.height = Math.floor(vp.height * dpr);
      task = p.render({ canvas: off, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
      try { await task.promise; } catch { return; }
      if (cancelled) return;
      canvas.width = off.width;
      canvas.height = off.height;
      canvas.getContext("2d")?.drawImage(off, 0, 0);
      off.width = 0; off.height = 0;
      drawnRef.current = scale;
      setDrawn(scale);

      const layer = textRef.current;
      if (layer) {
        layer.replaceChildren();
        const tl = new pdfjs.TextLayer({ textContentSource: p.streamTextContent(), container: layer, viewport: vp });
        textLayer = tl;
        try { await tl.render(); } catch { /* cancelled */ }
      }
    })();
    return () => { cancelled = true; task?.cancel(); textLayer?.cancel(); };
  }, [doc, pdfjs, page, scale, draw, onSize]);

  const w = Math.round(size.w * scale), h = Math.round(size.h * scale);
  return (
    <div
      data-page={page}
      className="absolute left-1/2 overflow-hidden bg-white shadow-[0_1px_3px_rgb(0_0_0/0.12),0_0_0_1px_rgb(0_0_0/0.04)]"
      style={{
        top, width: w, height: h, transform: "translateX(-50%)",
        ["--total-scale-factor" as string]: String(scale), ["--scale-round-x" as string]: "1px", ["--scale-round-y" as string]: "1px",
      }}
    >
      <canvas ref={canvasRef} aria-label={`Page ${page}`} className="block h-full w-full" />
      <div ref={textRef} className="textLayer" />
      {drawn === null && <span className="absolute inset-0 flex items-center justify-center text-[12px] tabular-nums text-zinc-400">{page}</span>}
    </div>
  );
});
