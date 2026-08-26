"use client";

import { useState, useEffect, useRef, isValidElement, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkUnwrapImages from "remark-unwrap-images";
import type { Components } from "react-markdown";
import { splitGuideIntoChapters, extractSubheadings, slugifyHeading } from "@/lib/study-chapters";
import { parseSlideCitation, deckProxyUrl, parseSlideImage, slideImageUrl } from "@/lib/slide-citation";
import { MermaidDiagram } from "@/components/MermaidDiagram";

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
  h1: ({ children }) => <h1 className="mt-8 mb-4 text-2xl font-semibold text-ink first:mt-0">{children}</h1>,
  h2: ({ children }) => (
    <h2 id={slugifyHeading(nodeText(children))} className="mt-2 mb-5 scroll-mt-24 text-[26px] font-semibold leading-tight text-ink">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 id={slugifyHeading(nodeText(children))} className="mt-10 mb-3 scroll-mt-24 text-[18px] font-semibold leading-snug text-ink">{children}</h3>
  ),
  p: ({ children }) => <p className="my-4 text-[16px] leading-[1.65] text-ink">{children}</p>,
  ul: ({ children }) => <ul className="my-4 list-disc space-y-1.5 pl-5 text-[16px] leading-[1.65] text-ink">{children}</ul>,
  ol: ({ children }) => <ol className="my-4 list-decimal space-y-1.5 pl-5 text-[16px] leading-[1.65] text-ink">{children}</ol>,
  li: ({ children }) => <li className="marker:text-ink-3">{children}</li>,
  strong: ({ children }) => <strong className="font-medium text-ink">{children}</strong>,
  em: ({ children }) => <em className="italic text-ink-2">{children}</em>,
  a: ({ href, children }) => {
    const cite = href ? parseSlideCitation(href) : null;
    if (cite) {
      return (
        <a
          href={deckProxyUrl(moduleId, cite.deck, cite.page)}
          target="_blank"
          rel="noreferrer"
          title={`${cite.deck} · slide ${cite.page}`}
          className="mx-0.5 inline-flex items-baseline rounded border border-line px-1.5 py-px align-baseline text-[0.7rem] tabular-nums text-ink-3 no-underline hover:border-accent hover:text-accent"
        >
          {children}
        </a>
      );
    }
    return (
      <a href={href} target="_blank" rel="noreferrer" className="underline decoration-line hover:text-accent">
        {children}
      </a>
    );
  },
  img: ({ src, alt }) => {
    const fig = typeof src === "string" ? parseSlideImage(src) : null;
    const url = fig ? slideImageUrl(moduleId, fig.deck, fig.page) : typeof src === "string" ? src : "";
    return (
      <figure className="my-5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={alt ?? (fig ? `${fig.deck} slide ${fig.page}` : "")} loading="lazy" className="block w-full rounded border border-line" />
        {alt && <figcaption className="mt-1.5 text-xs text-ink-3">{alt}</figcaption>}
      </figure>
    );
  },
  code: ({ className, children }) => {
    if (className?.includes("language-mermaid")) return <MermaidDiagram chart={String(children).trim()} />;
    return <code className="rounded bg-ink/5 px-1 py-0.5 font-mono text-[0.85em] text-ink">{children}</code>;
  },
  pre: ({ children }) => {
    const child = Array.isArray(children) ? children[0] : children;
    const cls = (child as { props?: { className?: string } })?.props?.className ?? "";
    if (cls.includes("language-mermaid")) return <>{children}</>;
    return (
      <pre className="my-3 overflow-x-auto rounded border border-line bg-ink/[0.03] p-3 text-sm leading-relaxed">{children}</pre>
    );
  },
  blockquote: ({ children }) => (
    <blockquote className="my-5 rounded-lg border border-line bg-ink/[0.02] px-4 py-3 text-[15px] leading-[1.6] text-ink-2">{children}</blockquote>
  ),
  hr: () => <hr className="my-6 border-line" />,
  table: ({ children }) => (
    <div className="guide-wide my-4 overflow-x-auto">
      <table className="w-full border-collapse text-sm tabular-nums">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-line py-2 pr-3 text-left text-xs font-medium uppercase tracking-wide text-ink-3">{children}</th>
  ),
  td: ({ children }) => <td className="border-b border-line py-2 pr-3 align-top text-ink">{children}</td>,
  };
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

export function StudyGuide({ markdown, moduleId }: { markdown: string; moduleId: number }) {
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
  if (chapters.length === 0) {
    return (
      <div className="w-full">
        <Body markdown={markdown} moduleId={moduleId} />
      </div>
    );
  }

  const chapterNav = (
    <nav aria-label="Chapters" className="sticky top-6 hidden self-start lg:block">
      <p className="mb-2 px-2 text-[11px] font-medium uppercase tracking-wide text-ink-3">Chapters</p>
      <ul className="space-y-0.5">
        {chapters.map((c, i) => (
          <li key={c.label}>
            <button
              type="button"
              aria-current={i === active ? "true" : undefined}
              onClick={() => selectChapter(i)}
              className={`block w-full rounded-md px-2 py-1.5 text-left text-[14px] leading-snug transition-colors ${
                i === active
                  ? "bg-ink/[0.07] font-medium text-ink"
                  : "text-ink-3 hover:bg-ink/[0.04] hover:text-ink-2"
              }`}
            >
              {c.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );

  const sectionNav = (
    <nav aria-label="On this page" className="sticky top-6 hidden max-h-[calc(100dvh-3rem)] self-start overflow-y-auto lg:block">
      {subs.length > 0 && (
        <>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-3">On this page</p>
          <ul className="border-l border-line">
            {subs.map((h) => {
              const current = activeSlug === h.slug;
              return (
                <li key={h.slug}>
                  <a
                    href={`#${h.slug}`}
                    onClick={(e) => { e.preventDefault(); setActiveSlug(h.slug); scrollToHeading(h.slug); }}
                    className={`-ml-px block border-l-2 py-1 pl-3 text-[13px] leading-snug transition-colors ${
                      current ? "border-ink font-medium text-ink" : "border-transparent text-ink-3 hover:text-ink-2"
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

  return (
    <div className="w-full lg:grid lg:grid-cols-[13.5rem_minmax(0,1fr)_12rem] lg:items-start lg:gap-10">
      {chapterNav}

      <div className="min-w-0">
        <div ref={tabsAnchor} aria-hidden className="h-0" />
        {preamble && (
          <div className="mb-10">
            <Body markdown={preamble} moduleId={moduleId} />
          </div>
        )}
        <Body markdown={chapters[active].markdown} moduleId={moduleId} />
      </div>

      {sectionNav}
    </div>
  );
}
