import type { ComponentRow } from "@/server/overview";

// Assessment weighting as one bar: each component is a segment, in the
// order given, in a stepped accent ramp so the biggest reads darkest.
// Whatever the components leave unaccounted is a light neutral tail; no
// weights at all draws a dashed empty bar, so the tile still lines up.
export const SEGMENT_COLORS = ["bg-accent", "bg-seg-2", "bg-seg-3", "bg-seg-4", "bg-seg-5"] as const;

export function weightSegments(components: Pick<ComponentRow, "name" | "weightPct">[]) {
  return components
    .filter((c) => c.weightPct != null && c.weightPct > 0)
    .sort((a, b) => (b.weightPct ?? 0) - (a.weightPct ?? 0))
    .slice(0, SEGMENT_COLORS.length)
    .map((c, i) => ({ name: c.name, pct: c.weightPct as number, color: SEGMENT_COLORS[i] }));
}

export function WeightBar({
  components,
  height = "h-2",
  className = "",
}: {
  components: Pick<ComponentRow, "name" | "weightPct">[];
  height?: string;
  className?: string;
}) {
  const segments = weightSegments(components);
  if (segments.length === 0) {
    return <div aria-hidden className={`${height} rounded-full border border-dashed border-ink-3 ${className}`} />;
  }
  const total = segments.reduce((n, s) => n + s.pct, 0);
  const label = segments.map((s) => `${s.name} ${s.pct}%`).join(", ");
  return (
    <div role="img" aria-label={label} className={`flex ${height} gap-px overflow-hidden rounded-full ${className}`}>
      {segments.map((s) => (
        <span key={s.name} className={s.color} style={{ width: `${s.pct}%` }} />
      ))}
      {total < 100 && <span className="flex-grow bg-ink/[0.06]" />}
    </div>
  );
}
