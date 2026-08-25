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
    <h2 id={slugifyHeading(nodeText(children))} className="mt-2 mb-4 scroll-mt-24 text-xl font-semibold text-ink">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 id={slugifyHeading(nodeText(children))} className="mt-8 mb-2 scroll-mt-24 text-lg font-semibold text-ink">{children}</h3>
  ),
  p: ({ children }) => <p className="my-3.5 text-[17px] leading-[1.75] text-ink">{children}</p>,
  ul: ({ children }) => <ul className="my-3.5 list-disc space-y-2 pl-5 text-[17px] leading-[1.75] text-ink">{children}</ul>,
  ol: ({ children }) => <ol className="my-3.5 list-decimal space-y-2 pl-5 text-[17px] leading-[1.75] text-ink">{children}</ol>,
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
    <blockquote className="my-4 border-l-2 border-line pl-4 text-[17px] italic leading-[1.75] text-ink-2">{children}</blockquote>
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

function Body({ markdown, moduleId, wide }: { markdown: string; moduleId: number; wide: boolean }) {
  return (
    <div className="guide" data-width={wide ? "wide" : "measure"}>
      <Markdown remarkPlugins={[remarkGfm, remarkUnwrapImages]} urlTransform={(u) => u} components={componentsFor(moduleId)}>
        {markdown}
      </Markdown>
    </div>
  );
}

const WIDTH_KEY = "sg-width";

// Collapsed-outline bar length, scaled to the heading it stands for and
// clamped so the rail stays a tidy ragged edge rather than a jagged one.
const barWidth = (label: string, min = 14, max = 30) =>
  `${Math.round(min + Math.min(1, label.length / 46) * (max - min))}px`;
const posKey = (moduleId: number) => `sg-pos:${moduleId}`;

export function StudyGuide({ markdown, moduleId }: { markdown: string; moduleId: number }) {
  const { preamble, chapters } = splitGuideIntoChapters(markdown);
  const [active, setActive] = useState(0);
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  // Reading width is a per-reader preference, not per-guide: someone who wants
  // the full width wants it everywhere, so the key is not scoped to a module.
  const [wide, setWideState] = useState(true);

  useEffect(() => {
    try {
      // Full width is the default; "measure" is the stored opt-out.
      setWideState(localStorage.getItem(WIDTH_KEY) !== "measure");
    } catch {
      // Private browsing or storage disabled — the default is fine.
    }
  }, []);

  const setWide = (next: boolean) => {
    setWideState(next);
    try {
      localStorage.setItem(WIDTH_KEY, next ? "wide" : "measure");
    } catch {
      // Preference simply will not persist; the toggle still works this visit.
    }
  };
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

  // Prose width is governed by the measure grid in globals.css, not here, so
  // this only has to stop figures from spanning the whole 1280px shell.
  const widthClass = "w-full";

  // No chapters to tab — render the whole thing as before.
  if (chapters.length === 0) {
    return (
      <div className={widthClass}>
        <Body markdown={markdown} moduleId={moduleId} wide={wide} />
      </div>
    );
  }

  return (
    <div className={`${widthClass} lg:flex lg:gap-14`}>
      {/* Outline for the CURRENT chapter only — switch chapters via the tabs. */}
      {/* Collapsed to a minimap of bars, expanding to labels on hover or
          keyboard focus — the outline is glanceable while reading and only
          takes the page over when you reach for it. The collapsed rail keeps
          its narrow width in the flow and the expanded panel overlays, so the
          prose never reflows underneath the pointer. */}
      {/* No self-start: the wrapper must stretch to the full height of the
          flex row, because a sticky child can only travel inside its
          containing block. Shrink-wrapping it pinned the rail to the top of
          a 200px-tall box and it scrolled away with the page. */}
      <div className="hidden w-16 shrink-0 lg:block">
        <nav
          aria-label="On this page"
          className="group sticky top-6 z-30 w-16"
        >
          <div className="w-16 rounded-md py-2 pl-1 pr-2 transition-[width,box-shadow,background-color] duration-200 ease-out group-focus-within:w-[19rem] group-focus-within:bg-surface group-focus-within:shadow-lg group-focus-within:ring-1 group-focus-within:ring-line group-hover:w-[19rem] group-hover:bg-surface group-hover:shadow-lg group-hover:ring-1 group-hover:ring-line motion-reduce:transition-none">
            {/* overflow-x must be stated: CSS computes a non-visible value on
                one axis to `auto` on the other, so overflow-y-auto alone gave
                the collapsed rail a horizontal scrollbar under its bars. */}
            <div className="max-h-[calc(100dvh-5rem)] overflow-y-auto overflow-x-hidden">
              <div className="px-2 pb-2">
                <span className="block h-[3px] rounded-full bg-ink/70 group-hover:hidden group-focus-within:hidden" style={{ width: barWidth(chapters[active].label, 24, 34) }} />
                <span className="hidden text-[13px] font-semibold leading-snug text-ink group-focus-within:block group-hover:block">
                  {chapters[active].label}
                </span>
              </div>

              {subs.length > 0 && (
                <ul className="space-y-[7px] group-focus-within:space-y-0.5 group-hover:space-y-0.5">
                  {subs.map((h) => {
                    const current = activeSlug === h.slug;
                    return (
                      <li key={h.slug}>
                        <a
                          href={`#${h.slug}`}
                          onClick={(e) => { e.preventDefault(); setActiveSlug(h.slug); scrollToHeading(h.slug); }}
                          title={h.label}
                          className={`block rounded px-2 py-1 group-focus-within:py-1 group-hover:py-1 ${
                            current ? "" : "hover:bg-ink/[0.04]"
                          }`}
                        >
                          <span
                            className={`block h-[3px] rounded-full transition-colors group-focus-within:hidden group-hover:hidden ${
                              current ? "bg-accent" : "bg-ink/25"
                            }`}
                            style={{ width: barWidth(h.label) }}
                          />
                          <span
                            className={`hidden text-[13px] leading-snug group-focus-within:block group-hover:block ${
                              current ? "font-medium text-accent" : "text-ink-3"
                            }`}
                          >
                            {h.label}
                          </span>
                        </a>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </nav>
      </div>

      <div className="min-w-0 lg:flex-1">
        {preamble && <Body markdown={preamble} moduleId={moduleId} wide={wide} />}

        <div ref={tabsAnchor} aria-hidden className="h-0" />
        <div ref={tabsRef} className="sticky top-0 z-20 mt-4 flex items-stretch border-b border-line bg-surface">
        <div role="tablist" aria-label="Chapters" className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {chapters.map((c, i) => (
            <button
              key={c.label}
              role="tab"
              aria-selected={i === active}
              onClick={() => selectChapter(i)}
              className={`shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-[13px] transition-colors ${
                i === active ? "border-accent text-ink" : "border-transparent text-ink-3 hover:text-ink-2"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
          <button
            type="button"
            onClick={() => setWide(!wide)}
            title={wide ? "Use a comfortable reading width" : "Use the full width"}
            aria-pressed={wide}
            className="ml-2 hidden shrink-0 self-center whitespace-nowrap border-l border-line py-1 pl-3 text-[13px] text-ink-3 hover:text-accent lg:block"
          >
            {wide ? "Comfortable" : "Full width"}
          </button>
        </div>

        <div className="pt-4">
          <Body markdown={chapters[active].markdown} moduleId={moduleId} wide={wide} />
        </div>
      </div>
    </div>
  );
}
