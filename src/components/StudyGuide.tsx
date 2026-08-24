import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

// Quiet-ink element mapping. The guide markdown is self-authored and trusted;
// react-markdown does not render raw HTML unless asked, so this is safe to render.
const components: Components = {
  h1: ({ children }) => <h1 className="mt-8 mb-3 text-xl font-medium text-ink first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-8 mb-3 border-b border-line pb-1 text-base font-medium text-ink">{children}</h2>,
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
  code: ({ children }) => (
    <code className="rounded bg-ink/5 px-1 py-0.5 font-mono text-[0.85em] text-ink">{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="my-3 overflow-x-auto rounded border border-line bg-ink/[0.03] p-3 text-xs leading-relaxed">{children}</pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-2 border-line pl-4 text-sm italic text-ink-2">{children}</blockquote>
  ),
  hr: () => <hr className="my-6 border-line" />,
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto">
      <table className="w-full border-collapse text-sm tabular-nums">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead>{children}</thead>,
  th: ({ children }) => (
    <th className="border-b border-line py-2 pr-3 text-left text-xs font-medium uppercase tracking-wide text-ink-3">{children}</th>
  ),
  td: ({ children }) => <td className="border-b border-line py-2 pr-3 align-top text-ink">{children}</td>,
};

export function StudyGuide({ markdown }: { markdown: string }) {
  return (
    <div className="max-w-[68ch]">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {markdown}
      </Markdown>
    </div>
  );
}
