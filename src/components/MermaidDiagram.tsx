"use client";

import { useEffect, useRef, useState } from "react";
import { repairMermaid } from "@/lib/mermaid-fix";

let seq = 0;

// Renders a mermaid diagram from its source. mermaid touches the DOM and is
// large, so it is imported lazily on the client only. On a parse/render error
// we fall back to showing the diagram source rather than breaking the page.
export function MermaidDiagram({ chart }: { chart: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  // Diagrams are drawn as SVG with baked-in colours, so a theme switch has
  // to redraw them.
  const [theme, setTheme] = useState<string>("light");
  useEffect(() => {
    const el = document.documentElement;
    const read = () => setTheme(el.dataset.theme ?? "light");
    read();
    const mo = new MutationObserver(read);
    mo.observe(el, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const id = `mmd-${seq++}`;
      try {
        const mermaid = (await import("mermaid")).default;
        // suppressErrorRendering: on a bad diagram mermaid otherwise draws its
        // own "Syntax error" bomb graphic into a node it appends to <body>,
        // outside this component, where it piles up at the foot of the page.
        mermaid.initialize({
          startOnLoad: false, theme: theme === "dark" ? "dark" : "neutral", securityLevel: "strict",
          fontFamily: "inherit", suppressErrorRendering: true,
        });
        // Try the diagram as written, then with its labels repaired.
        const candidates = [chart, repairMermaid(chart)];
        let code: string | null = null;
        for (const c of candidates) {
          if (await mermaid.parse(c, { suppressErrors: true })) { code = c; break; }
        }
        if (!code) throw new Error("unparseable");
        const { svg } = await mermaid.render(id, code);
        if (!cancelled && ref.current) ref.current.innerHTML = svg;
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        // Whatever mermaid left behind in <body> for this render — but not
        // the finished SVG, which carries the same id inside this component.
        document.getElementById(`d${id}`)?.remove();
        const stray = document.getElementById(id);
        if (stray && !ref.current?.contains(stray)) stray.remove();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chart, theme]);

  if (failed) {
    return (
      <details className="guide-wide my-4 rounded-md border border-line bg-sunken px-3 py-2 text-[13px] text-ink-2">
        <summary className="cursor-pointer select-none">This diagram could not be drawn — show its source</summary>
        <pre className="mt-2 overflow-x-auto text-xs leading-relaxed">{chart}</pre>
      </details>
    );
  }
  return <div ref={ref} className="guide-wide my-5 flex justify-center overflow-x-auto [&_svg]:max-w-full" aria-label="diagram" />;
}
