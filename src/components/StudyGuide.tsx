"use client";

import { useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { splitGuideIntoChapters } from "@/lib/study-chapters";
import { MermaidDiagram } from "@/components/MermaidDiagram";

// Quiet-ink element mapping. The guide markdown is self-authored and trusted;
// react-markdown does not render raw HTML unless asked, so this is safe.
// A ```mermaid fenced block is rendered as a diagram instead of a code block.
const components: Components = {
  h1: ({ children }) => <h1 className="mt-8 mb-3 text-xl font-medium text-ink first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-2 mb-3 text-base font-medium text-ink">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-6 mb-2 text-sm font-medium uppercase tracking-wide text-ink-2">{children}</h3>,
  p: ({ children }) => <p className="my-3 text-sm leading-relaxed text-ink">{children}</p>,
  ul: ({ children }) => <ul className="my-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-ink">{children}</ul>,
  ol: ({ children }) => <ol className="my-3 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-ink">{children}</ol>,
  li: ({ children }) => <li className="marker:text-ink-3">{children}</li>,
  strong: ({ children }) => <strong className="font-medium text-ink">{children}</strong>,
  em: ({ children }) => <em className="italic text-ink-2">{children}</em>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer" className="underline decoration-line hover:text-accent">
      {children}
    </a>
  ),
  code: ({ className, children }) => {
    if (className?.includes("language-mermaid")) return <MermaidDiagram chart={String(children).trim()} />;
    return <code className="rounded bg-ink/5 px-1 py-0.5 font-mono text-[0.85em] text-ink">{children}</code>;
  },
  pre: ({ children }) => {
    const child = Array.isArray(children) ? children[0] : children;
    const cls = (child as { props?: { className?: string } })?.props?.className ?? "";
    // Mermaid diagrams render their own container — don't wrap them in <pre>.
    if (cls.includes("language-mermaid")) return <>{children}</>;
    return (
      <pre className="my-3 overflow-x-auto rounded border border-line bg-ink/[0.03] p-3 text-xs leading-relaxed">{children}</pre>
    );
  },
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-2 border-line pl-4 text-sm italic text-ink-2">{children}</blockquote>
  ),
  hr: () => <hr className="my-6 border-line" />,
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto">
      <table className="w-full border-collapse text-sm tabular-nums">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-line py-2 pr-3 text-left text-xs font-medium uppercase tracking-wide text-ink-3">{children}</th>
  ),
  td: ({ children }) => <td className="border-b border-line py-2 pr-3 align-top text-ink">{children}</td>,
};

function Body({ markdown }: { markdown: string }) {
  return (
    <Markdown remarkPlugins={[remarkGfm]} components={components}>
      {markdown}
    </Markdown>
  );
}

export function StudyGuide({ markdown }: { markdown: string }) {
  const { preamble, chapters } = splitGuideIntoChapters(markdown);
  const [active, setActive] = useState(0);

  // No chapters to tab — render the whole thing as before.
  if (chapters.length === 0) {
    return (
      <div className="max-w-[68ch]">
        <Body markdown={markdown} />
      </div>
    );
  }

  return (
    <div className="max-w-[72ch]">
      {preamble && <Body markdown={preamble} />}

      <div role="tablist" aria-label="Chapters" className="mt-4 flex gap-1 overflow-x-auto border-b border-line">
        {chapters.map((c, i) => (
          <button
            key={c.label}
            role="tab"
            aria-selected={i === active}
            onClick={() => setActive(i)}
            className={`shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-xs transition-colors ${
              i === active
                ? "border-accent text-ink"
                : "border-transparent text-ink-3 hover:text-ink-2"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="pt-2">
        <Body markdown={chapters[active].markdown} />
      </div>
    </div>
  );
}
