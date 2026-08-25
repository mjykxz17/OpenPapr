"use client";

import { useEffect, useRef, useState } from "react";

let seq = 0;

// Renders a mermaid diagram from its source. mermaid touches the DOM and is
// large, so it is imported lazily on the client only. On a parse/render error
// we fall back to showing the diagram source rather than breaking the page.
export function MermaidDiagram({ chart }: { chart: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({ startOnLoad: false, theme: "neutral", securityLevel: "strict", fontFamily: "inherit" });
        const { svg } = await mermaid.render(`mmd-${seq++}`, chart);
        if (!cancelled && ref.current) ref.current.innerHTML = svg;
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chart]);

  if (failed) {
    return (
      <pre className="guide-wide my-4 overflow-x-auto rounded border border-line bg-ink/[0.03] p-3 text-xs leading-relaxed text-ink-2">
        {chart}
      </pre>
    );
  }
  return <div ref={ref} className="guide-wide my-5 flex justify-center overflow-x-auto [&_svg]:max-w-full" aria-label="diagram" />;
}
