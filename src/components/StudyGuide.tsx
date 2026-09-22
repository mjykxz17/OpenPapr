"use client";

import { useState, useEffect, useRef, useCallback, useMemo, isValidElement, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkUnwrapImages from "remark-unwrap-images";
import type { Components } from "react-markdown";
import { splitGuideIntoChapters, extractSubheadings, slugifyHeading } from "@/lib/study-chapters";
import { parseSlideCitation, deckProxyUrl, parseSlideImage, slideImageUrl, citedPagesByDeck } from "@/lib/slide-citation";
import { MermaidDiagram } from "@/components/MermaidDiagram";
import { SlidePanel, type OpenDeck, type PanelMode } from "@/components/SlidePanel";
import { SlidePanelContext, useSlidePanel, type SlideRef } from "@/components/slide-panel-context";

// Flattens heading children to plain text so headings can be given stable ids
// that the outline sidebar links to.
function nodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (isValidElement(node)) return nodeText((node.props as { children?: ReactNode }).children);
  return "";
}

// Quiet-ink element mapping. The guide markdown is self-authored and trusted;
// react-markdown does not render raw HTML unless asked, so this is safe.
// A ```mermaid block renders as a diagram; a [text](slide:deck#N) link becomes
// a chip that opens the deck at page N; ![alt](slide-img:deck#N) embeds a slide.
// scroll-mt keeps anchored headings clear of the sticky tab bar.
function componentsFor(moduleId: number): Components {
  return {
  h1: ({ children }) => <h1 className="mt-8 mb-4 text-[34px] font-semibold leading-tight tracking-[-0.01em] text-ink first:mt-0">{children}</h1>,
  h2: ({ children }) => (
    <h2 id={slugifyHeading(nodeText(children))} className="mt-2 mb-5 scroll-mt-24 text-[30px] font-semibold leading-[1.15] tracking-[-0.01em] text-ink">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 id={slugifyHeading(nodeText(children))} className="mt-8 mb-2 scroll-mt-24 text-[20px] font-semibold leading-[1.3] text-ink">{children}</h3>
  ),
  p: ({ children }) => <p className="my-3 text-[16px] leading-[1.65] text-ink">{children}</p>,
  ul: ({ children }) => <ul className="my-3 list-disc space-y-1.5 pl-5 text-[16px] leading-[1.65] text-ink">{children}</ul>,
  ol: ({ children }) => <ol className="my-3 list-decimal space-y-1.5 pl-5 text-[16px] leading-[1.65] text-ink">{children}</ol>,
  li: ({ children }) => <li className="marker:text-ink-3">{children}</li>,
  strong: ({ children }) => <strong className="font-medium text-ink">{children}</strong>,
  em: ({ children }) => <em className="italic text-ink-2">{children}</em>,
  a: ({ href, children }) => {
    const cite = href ? parseSlideCitation(href) : null;
    if (cite) return <SlideChip moduleId={moduleId} cite={cite}>{children}</SlideChip>;
    return (
      <a href={href} target="_blank" rel="noreferrer" className="underline decoration-line-2 underline-offset-2 hover:text-accent">
        {children}
      </a>
    );
  },
  img: ({ src, alt }) => {
    const fig = typeof src === "string" ? parseSlideImage(src) : null;
    const url = fig ? slideImageUrl(moduleId, fig.deck, fig.page) : typeof src === "string" ? src : "";
    return (
      <figure className="my-5 flex flex-col gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={alt ?? (fig ? `${fig.deck} slide ${fig.page}` : "")} loading="lazy" className="block w-full rounded-md border border-line" />
        {(alt || fig) && (
          <figcaption className="flex items-baseline justify-between gap-4 text-[13px] text-ink-2">
            <span>{alt}</span>
            {fig && (
              <a
                href={deckProxyUrl(moduleId, fig.deck, fig.page)}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 font-medium text-accent no-underline hover:underline"
              >
                Open {fig.deck}, slide {fig.page} →
              </a>
            )}
          </figcaption>
        )}
      </figure>
    );
  },
  code: ({ className, children }) => {
    if (className?.includes("language-mermaid")) return <MermaidDiagram chart={String(children).trim()} />;
    return <code className="rounded bg-ink/[0.06] px-1 py-0.5 font-mono text-[0.85em] text-ink">{children}</code>;
  },
  pre: ({ children }) => {
    const child = Array.isArray(children) ? children[0] : children;
    const cls = (child as { props?: { className?: string } })?.props?.className ?? "";
    if (cls.includes("language-mermaid")) return <>{children}</>;
    return (
      <pre className="my-3 overflow-x-auto rounded-md border border-line bg-ink/[0.03] p-3 text-sm leading-relaxed">{children}</pre>
    );
  },
  blockquote: ({ children }) => (
    <blockquote className="my-5 rounded-md border border-line bg-ink/[0.02] px-4 py-3 text-[15px] leading-[1.6] text-ink-2">{children}</blockquote>
  ),
  hr: () => <hr className="my-6 border-line" />,
  table: ({ children }) => (
    <div className="guide-wide my-4 overflow-x-auto">
      <table className="w-full border-collapse text-sm tabular-nums">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-line py-2 pr-3 text-left text-xs font-semibold uppercase tracking-[0.06em] text-ink-2">{children}</th>
  ),
  td: ({ children }) => <td className="border-b border-line py-2 pr-3 align-top text-ink">{children}</td>,
  };
}

// A slide citation. With the side panel available it shows the slide there —
// a plain click never leaves the page — and a modifier-click or middle-click
// still opens the PDF in a new tab, because the href is real. The chip that
// matches what the panel is showing goes solid.
function SlideChip({ moduleId, cite, children }: { moduleId: number; cite: SlideRef; children: ReactNode }) {
  const panel = useSlidePanel();
  const current = panel?.current && panel.current.deck === cite.deck && panel.current.page === cite.page;
  return (
    <a
      href={deckProxyUrl(moduleId, cite.deck, cite.page)}
      target="_blank"
      rel="noreferrer"
      title={`${cite.deck} · slide ${cite.page}`}
      aria-current={current ? "true" : undefined}
      onClick={(e) => {
        if (!panel || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        panel.show(cite);
      }}
      className={`ml-0.5 inline-flex items-center gap-1 rounded px-1.5 py-px align-baseline text-[12px] font-medium tabular-nums no-underline transition-colors ${
        current ? "bg-accent text-on-accent" : "bg-accent-soft text-accent hover:bg-accent hover:text-on-accent"
      }`}
    >
      <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="3" y="5" width="18" height="14" rx="2" />
      </svg>
      {children}
    </a>
  );
}

function Body({ markdown, moduleId }: { markdown: string; moduleId: number }) {
  return (
    <div className="guide">
      <Markdown remarkPlugins={[remarkGfm, remarkUnwrapImages]} urlTransform={(u) => u} components={componentsFor(moduleId)}>
        {markdown}
      </Markdown>
    </div>
  );
}


// Collapsed-outline bar length, scaled to the heading it stands for and
// clamped so the rail stays a tidy ragged edge rather than a jagged one.
const barWidth = (label: string, min = 14, max = 30) =>
  `${Math.round(min + Math.min(1, label.length / 46) * (max - min))}px`;
const posKey = (moduleId: number) => `sg-pos:${moduleId}`;

type PanelState = { open: boolean; tabs: OpenDeck[]; active: string; mode: PanelMode };
type Layout = { chapters: boolean; outline: boolean; thumbs: boolean; panelW: number };
const LAYOUT_KEY = "sg-layout";
const PANEL_MIN = 360;
const PANEL_MAX = 960;
const DEFAULT_LAYOUT: Layout = { chapters: true, outline: true, thumbs: true, panelW: 640 };

// True once the viewport is at least `px` wide. False on the server and on
// the first client render, so markup matches before it settles.
function useMinWidth(px: number): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${px}px)`);
    const update = () => setOk(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [px]);
  return ok;
}

// A small on/off button for the reading toolbar. It is always rendered in
// the same place; when it cannot apply right now it is disabled and says
// why, rather than disappearing.
function ToggleButton({ on, onClick, label, title, disabled, className = "", children }: {
  on: boolean; onClick: () => void; label: string; title: string; disabled?: boolean; className?: string; children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`h-8 items-center gap-1.5 rounded-md border px-2.5 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:border-line disabled:bg-transparent disabled:text-ink-3 ${
        on ? "border-accent bg-accent-soft text-accent" : "border-line-2 bg-panel text-ink-2 hover:border-ink-3 hover:text-ink"
      } ${className || "flex"}`}
    >
      {children}
      <span>{label}</span>
    </button>
  );
}
const panelKey = (moduleId: number) => `sg-panel:${moduleId}`;
const EMPTY_PANEL: PanelState = { open: false, tabs: [], active: "", mode: "slide" };

export function StudyGuide({ markdown, moduleId, decks = [] }: { markdown: string; moduleId: number; decks?: string[] }) {
  const { preamble: rawPreamble, chapters } = splitGuideIntoChapters(markdown);
  // Drop the guide's own H1. The page already names the module in its header
  // and again in the "Study guide" label, so rendering "<Module> — Study
  // Guide" a third time is pure repetition. Removed rather than hidden with
  // CSS, so the document outline stays honest for screen readers.
  const preamble = rawPreamble.replace(/^\s*#\s+.*(?:\n|$)/, "").trim();
  const [active, setActive] = useState(0);
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const pendingScroll = useRef<string | null>(null); // section to scroll to after a restored chapter renders
  const tabsRef = useRef<HTMLDivElement | null>(null);      // the sticky chapter bar
  const tabsAnchor = useRef<HTMLDivElement | null>(null);   // zero-height marker at the bar's resting position
  const restored = useRef(false);

  const subs = chapters.length ? extractSubheadings(chapters[active].markdown) : [];
  const spyKey = subs.map((s) => s.slug).join("|");

  // Restore the last-read chapter + section for this module (once, on mount).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(posKey(moduleId));
      if (raw) {
        const { c, s } = JSON.parse(raw);
        if (typeof c === "number" && c >= 0 && c < chapters.length) {
          pendingScroll.current = typeof s === "string" ? s : null;
          setActive(c);
        }
      }
    } catch {}
    restored.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleId]);

  // Once the restored chapter is on the page, scroll to the saved section.
  useEffect(() => {
    const slug = pendingScroll.current;
    if (!slug || !document.getElementById(slug)) return; // wrong chapter yet — wait
    pendingScroll.current = null;
    let cancelled = false;
    const go = () => {
      if (!cancelled) document.getElementById(slug)?.scrollIntoView();
    };
    const stop = () => {
      cancelled = true;
    };
    go();
    // Mermaid diagrams and lazy images above the target render after this and
    // shift it down; corrective re-scrolls settle on the right spot — unless
    // the reader has already started scrolling, in which case we back off.
    const timers = [setTimeout(go, 300), setTimeout(go, 800)];
    window.addEventListener("wheel", stop, { passive: true, once: true });
    window.addEventListener("touchmove", stop, { passive: true, once: true });
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchmove", stop);
    };
  }, [active]);

  // Persist position as the reader moves (only after the initial restore).
  useEffect(() => {
    if (!restored.current) return;
    try {
      localStorage.setItem(posKey(moduleId), JSON.stringify({ c: active, s: activeSlug }));
    } catch {}
  }, [moduleId, active, activeSlug]);

  // The slide panel: which decks are open, at which page, and whether the
  // note editor shows. Remembered per module like the reading position.
  const [panel, setPanel] = useState<PanelState>(EMPTY_PANEL);
  const panelLoaded = useRef(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(panelKey(moduleId));
      if (raw) {
        const p = JSON.parse(raw) as Partial<PanelState>;
        if (Array.isArray(p.tabs)) setPanel({ open: !!p.open && p.tabs.length > 0, tabs: p.tabs, active: p.active ?? p.tabs[0]?.deck ?? "", mode: p.mode === "split" || p.mode === "notes" ? p.mode : "slide" });
      }
    } catch {}
    panelLoaded.current = true;
  }, [moduleId]);
  useEffect(() => {
    if (!panelLoaded.current) return;
    try { localStorage.setItem(panelKey(moduleId), JSON.stringify(panel)); } catch {}
  }, [moduleId, panel]);

  const showSlide = useCallback((ref: SlideRef) => {
    setPanel((p) => {
      const has = p.tabs.some((t) => t.deck === ref.deck);
      const tabs = has ? p.tabs.map((t) => (t.deck === ref.deck ? { ...t, page: ref.page } : t)) : [...p.tabs, { deck: ref.deck, page: ref.page }];
      return { ...p, open: true, tabs, active: ref.deck };
    });
  }, []);
  const activeTab = panel.open ? panel.tabs.find((t) => t.deck === panel.active) ?? null : null;
  const panelApi = useMemo(
    () => ({ show: showSlide, current: activeTab ? { deck: activeTab.deck, page: activeTab.page } : null }),
    [showSlide, activeTab],
  );
  const panelOpen = panel.open && panel.tabs.length > 0;
  const cited = useMemo(() => citedPagesByDeck(markdown), [markdown]);

  // Layout preferences, global rather than per module: which side columns
  // show, how wide the docked panel is, and whether it shows thumbnails.
  const [layout, setLayout] = useState<Layout>(DEFAULT_LAYOUT);
  const layoutLoaded = useRef(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LAYOUT_KEY);
      if (raw) setLayout({ ...DEFAULT_LAYOUT, ...JSON.parse(raw) });
    } catch {}
    layoutLoaded.current = true;
  }, []);
  useEffect(() => {
    if (!layoutLoaded.current) return;
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch {}
  }, [layout]);
  const setPref = <K extends keyof Layout>(k: K, v: Layout[K]) => setLayout((l) => ({ ...l, [k]: v }));

  // The Slides toggle: reopen what was open; with nothing remembered, open
  // the first deck the guide cites, at its first cited page.
  const firstSlide = useMemo<SlideRef | null>(() => {
    const [deck, pages] = Object.entries(cited)[0] ?? [];
    if (deck && pages?.length) return { deck, page: pages[0] };
    return decks[0] ? { deck: decks[0], page: 1 } : null;
  }, [cited, decks]);
  const canOpenPanel = panel.tabs.length > 0 || firstSlide !== null;
  const toggleSlides = useCallback(() => {
    setPanel((p) => {
      if (p.open && p.tabs.length > 0) return { ...p, open: false };
      if (p.tabs.length > 0) return { ...p, open: true };
      if (!firstSlide) return p;
      return { ...p, open: true, tabs: [{ ...firstSlide }], active: firstSlide.deck };
    });
  }, [firstSlide]);

  // Drag the panel's left edge to resize it. The prose keeps at least
  // 360px; the panel stays between 360px and 960px.
  const asideRef = useRef<HTMLElement | null>(null);
  const clampWidth = (w: number) => {
    const max = Math.max(PANEL_MIN, Math.min(PANEL_MAX, window.innerWidth - 56 - 80 - 40 - 360));
    return Math.round(Math.max(PANEL_MIN, Math.min(max, w)));
  };
  function startResize(e: React.PointerEvent) {
    if (e.button !== 0 || !asideRef.current) return;
    e.preventDefault();
    const right = asideRef.current.getBoundingClientRect().right;
    const move = (ev: PointerEvent) => setPref("panelW", clampWidth(right - ev.clientX));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
  function resizeByKey(e: React.KeyboardEvent) {
    const step = e.shiftKey ? 80 : 24;
    if (e.key === "ArrowLeft") { e.preventDefault(); setPref("panelW", clampWidth(layout.panelW + step)); }
    if (e.key === "ArrowRight") { e.preventDefault(); setPref("panelW", clampWidth(layout.panelW - step)); }
  }

  const slidesIcon = (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M14 4v16" />
    </svg>
  );
  const slidesToggle = (
    <ToggleButton
      on={panelOpen}
      onClick={toggleSlides}
      disabled={!canOpenPanel}
      label="Slides"
      title={canOpenPanel ? (panelOpen ? "Hide the slide panel" : "Show the slide panel") : "This module has no PDF slides"}
    >
      {slidesIcon}
    </ToggleButton>
  );
  const panelStyle = { "--panel-w": `${layout.panelW}px` } as React.CSSProperties;

  // What fits right now decides whether Chapters/Outline are enabled; the
  // buttons themselves never move or vanish.
  const isLg = useMinWidth(1024);
  const isXl = useMinWidth(1280);
  const is2xl = useMinWidth(1536);
  const docked = panelOpen && isXl;
  const chaptersFit = isLg && (!docked || is2xl);
  const outlineFits = isLg && !docked;

  // The reading bar: one strip pinned to the top of the reading area, the
  // same buttons in the same order on every page and in every state. The
  // chapter picker lives at its left so the current chapter is always named.
  const readingBar = (
    <>
      <div ref={tabsAnchor} aria-hidden className="h-0" />
      <div
        ref={tabsRef}
        className="sticky top-0 z-20 -mx-3 mb-6 flex h-14 items-center gap-2 border-b border-line bg-surface px-3"
      >
        {chapters.length > 0 && (
          <label className="flex min-w-0 items-center gap-2 text-[13px] text-ink-2">
            <span className="hidden sm:inline">Chapter</span>
            <select
              value={active}
              onChange={(e) => selectChapter(Number(e.target.value))}
              className="h-8 min-w-0 max-w-[18rem] rounded-md border border-line-2 bg-panel px-2 text-[13px] text-ink"
            >
              {chapters.map((c, i) => (
                <option key={c.label} value={i}>{i + 1}. {c.label}</option>
              ))}
            </select>
          </label>
        )}
        <div role="toolbar" aria-label="Layout" className="ml-auto flex shrink-0 items-center gap-1.5">
          {chapters.length > 0 && (
            <>
              <ToggleButton
                on={layout.chapters && chaptersFit}
                onClick={() => setPref("chapters", !layout.chapters)}
                disabled={!chaptersFit}
                label="Chapters"
                title={!chaptersFit ? "No room for the chapter list beside the slides — close Slides or widen the window" : layout.chapters ? "Hide the chapter list" : "Show the chapter list"}
                className="hidden lg:flex"
              >
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></svg>
              </ToggleButton>
              <ToggleButton
                on={layout.outline && outlineFits}
                onClick={() => setPref("outline", !layout.outline)}
                disabled={!outlineFits}
                label="Outline"
                title={!outlineFits ? "The slide panel is using this space — close Slides to show the outline" : layout.outline ? "Hide the section outline" : "Show the section outline"}
                className="hidden lg:flex"
              >
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>
              </ToggleButton>
            </>
          )}
          {slidesToggle}
        </div>
      </div>
    </>
  );
  const allDecks = useMemo(() => {
    const set = new Set(decks);
    for (const t of panel.tabs) set.add(t.deck);
    return [...set];
  }, [decks, panel.tabs]);

  // The chapter bar is the top of the reading area. Once it is stuck, nothing
  // should scroll above it — the guide's title and its long preamble are read
  // once, and jumping back to them on every tab or outline click loses the
  // reader's place. The sentinel sits at the bar's resting position, so its
  // document offset is exactly the point past which the bar is pinned.
  function tabsCeiling(): number {
    const el = tabsAnchor.current;
    return el ? Math.round(el.getBoundingClientRect().top + window.scrollY) : 0;
  }

  function scrollToY(y: number) {
    window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
  }

  // Switching chapters starts that chapter at the bar, not at the guide title.
  function selectChapter(i: number) {
    pendingScroll.current = null;
    setActive(i);
    scrollToY(tabsCeiling());
  }

  // Outline clicks land the heading just under the bar, and never above it.
  function scrollToHeading(slug: string) {
    const el = document.getElementById(slug);
    if (!el) return;
    const barH = tabsRef.current?.offsetHeight ?? 0;
    const target = el.getBoundingClientRect().top + window.scrollY - barH - 12;
    scrollToY(Math.max(target, tabsCeiling()));
  }

  // Scroll-spy: the active section is the last heading scrolled above the
  // sticky bar. A plain scroll listener tracks this reliably even in the long
  // gaps between headings (where an IntersectionObserver band goes stale).
  useEffect(() => {
    const ids = spyKey ? spyKey.split("|") : [];
    if (ids.length === 0) {
      setActiveSlug(null);
      return;
    }
    const onScroll = () => {
      let current = ids[0];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= 96) current = id; // 96px ≈ below the sticky tab bar
      }
      setActiveSlug(current);
    };
    onScroll();
    // Capture phase so it fires regardless of which element actually scrolls.
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    return () => window.removeEventListener("scroll", onScroll, { capture: true });
  }, [spyKey]);

  // Layout follows a documentation three-column shape: chapters on the left,
  // the reading column in the middle, the current chapter's sections on the
  // right. Navigation on both flanks is what lets the prose stay a comfortable
  // width without leaving the page half empty — the problem a single centred
  // column had.
  // Docked beside the prose from xl (1280px) up; below that there is no
  // room for both, so the same panel slides over the right edge as a
  // drawer, and closing it gives the page back.
  const slidePanel = panelOpen ? (
    <aside
      ref={asideRef}
      aria-label="Slides"
      className="fixed inset-y-0 right-0 z-30 flex w-[min(var(--panel-w),100vw)] min-h-0 flex-col bg-surface p-3 shadow-2xl xl:sticky xl:inset-auto xl:top-[72px] xl:z-auto xl:h-[calc(100dvh-88px)] xl:w-auto xl:bg-transparent xl:p-0 xl:shadow-none"
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize slide panel"
        aria-valuenow={layout.panelW}
        aria-valuemin={PANEL_MIN}
        aria-valuemax={PANEL_MAX}
        tabIndex={0}
        title="Drag to resize · double-click to reset"
        onPointerDown={startResize}
        onKeyDown={resizeByKey}
        onDoubleClick={() => setPref("panelW", DEFAULT_LAYOUT.panelW)}
        className="group absolute -left-[22px] top-0 hidden h-full w-4 cursor-col-resize items-center justify-center outline-none xl:flex"
      >
        <span className="h-10 w-1 rounded-full bg-line-2 transition-colors group-hover:bg-accent group-focus-visible:bg-accent" />
      </div>
      <SlidePanel
        moduleId={moduleId}
        cited={cited}
        decks={allDecks}
        tabs={panel.tabs}
        active={panel.active}
        mode={panel.mode}
        thumbs={layout.thumbs}
        onThumbs={(on) => setPref("thumbs", on)}
        onTabs={(tabs, active) => setPanel((p) => ({ ...p, tabs, active, open: tabs.length > 0 }))}
        onMode={(mode) => setPanel((p) => ({ ...p, mode }))}
        onClose={() => setPanel((p) => ({ ...p, open: false }))}
      />
    </aside>
  ) : null;

  if (chapters.length === 0) {
    return (
      <SlidePanelContext.Provider value={panelApi}>
        {readingBar}
        <div style={panelStyle} className={`w-full ${panelOpen ? "xl:grid xl:grid-cols-[minmax(0,1fr)_var(--panel-w)] xl:items-start xl:gap-10" : ""}`}>
          <div className="min-w-0">
            <Body markdown={markdown} moduleId={moduleId} />
          </div>
          {slidePanel}
        </div>
      </SlidePanelContext.Provider>
    );
  }

  const chapterNav = (
    <nav aria-label="Chapters" className="sticky top-[72px] hidden self-start lg:block">
      <p className="mb-2.5 px-2.5 text-xs font-semibold uppercase tracking-[0.06em] text-ink-2">Chapters</p>
      <ol className="space-y-0.5">
        {chapters.map((c, i) => (
          <li key={c.label}>
            <button
              type="button"
              aria-current={i === active ? "true" : undefined}
              onClick={() => selectChapter(i)}
              className={`flex w-full gap-2.5 rounded-md px-2.5 py-2 text-left text-[14px] leading-[1.4] transition-colors ${
                i === active ? "bg-accent-soft font-medium text-ink" : "text-ink-2 hover:bg-ink/[0.04] hover:text-ink"
              }`}
            >
              <span className={`shrink-0 tabular-nums ${i === active ? "text-accent" : "text-ink-3"}`}>{i + 1}</span>
              <span>{c.label}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );

  const sectionNav = (
    <nav aria-label="On this page" className="sticky top-[72px] hidden max-h-[calc(100dvh-88px)] self-start overflow-y-auto lg:block">
      {subs.length > 0 && (
        <>
          <p className="mb-2.5 text-xs font-semibold uppercase tracking-[0.06em] text-ink-2">On this page</p>
          <ul className="border-l border-line">
            {subs.map((h) => {
              const current = activeSlug === h.slug;
              return (
                <li key={h.slug}>
                  <a
                    href={`#${h.slug}`}
                    onClick={(e) => { e.preventDefault(); setActiveSlug(h.slug); scrollToHeading(h.slug); }}
                    className={`-ml-px block border-l-2 py-1.5 pl-3 text-[13px] leading-[1.4] transition-colors ${
                      current ? "border-accent font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink"
                    }`}
                  >
                    {h.label}
                  </a>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </nav>
  );

  // Columns: the chapter list and the outline can each be switched off.
  // With the panel docked (xl+) the outline gives way to it and the chapter
  // list only fits on 2xl; below xl the panel is a drawer over the page, so
  // the closed layout stays. Class strings are spelled out in full so
  // Tailwind can see them.
  const { chapters: showChapters, outline: showOutline } = layout;
  const closedGrid = showChapters
    ? showOutline ? "lg:grid lg:grid-cols-[15rem_minmax(0,1fr)_13.75rem] lg:gap-12" : "lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-12"
    : showOutline ? "lg:grid lg:grid-cols-[minmax(0,1fr)_13.75rem] lg:gap-12" : "";
  const grid = panelOpen
    ? `${closedGrid} xl:grid xl:grid-cols-[minmax(0,1fr)_var(--panel-w)] xl:gap-10 ${showChapters ? "2xl:grid-cols-[15rem_minmax(0,1fr)_var(--panel-w)]" : ""}`
    : closedGrid;
  const chapterWrap = !showChapters ? "hidden" : panelOpen ? "contents xl:hidden 2xl:contents" : "contents";
  const outlineWrap = !showOutline ? "hidden" : panelOpen ? "contents xl:hidden" : "contents";

  return (
    <SlidePanelContext.Provider value={panelApi}>
    {readingBar}
    <div style={panelStyle} className={`w-full lg:items-start ${grid}`}>
      <div className={chapterWrap}>{chapterNav}</div>

      <div className="min-w-0">
        {preamble && (
          <div className="mb-10">
            <Body markdown={preamble} moduleId={moduleId} />
          </div>
        )}
        <p className="guide mb-2">
          <span className="text-[13px] font-semibold uppercase tracking-[0.06em] text-accent">Chapter {active + 1} of {chapters.length}</span>
        </p>
        <Body markdown={chapters[active].markdown} moduleId={moduleId} />
      </div>

      <div className={outlineWrap}>{sectionNav}</div>
      {slidePanel}
    </div>
    </SlidePanelContext.Provider>
  );
}
