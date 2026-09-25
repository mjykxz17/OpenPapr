// Papi: a small sheet of paper with a folded corner, two dot eyes and very
// small feet. Pure SVG so it stays crisp at any size and follows the theme.
export type Mood = "idle" | "blink" | "look-left" | "look-right" | "talk" | "happy" | "sleep" | "think" | "wheee" | "dizzy";

// gaze: where to look, in -1..1 each way (follows the pointer); blush 0..1.
export function PapiFace({ mood, size = 64, gaze, blush = 0 }: { mood: Mood; size?: number; gaze?: { x: number; y: number } | null; blush?: number }) {
  const eyeDx = mood === "look-left" ? -2.5 : mood === "look-right" ? 2.5 : gaze ? gaze.x * 2.6 : 0;
  const eyeDy = gaze && !mood.startsWith("look") ? gaze.y * 1.8 : 0;
  const closed = mood === "blink" || mood === "sleep";
  const happy = mood === "happy" || mood === "wheee";
  return (
    <svg viewBox="0 0 64 70" width={size} height={size * 70 / 64} aria-hidden className="block overflow-visible">
      {/* a soft shadow to stand on, then feet */}
      <ellipse cx="32" cy="68.5" rx="20" ry="2.2" className="fill-[var(--papi-shadow)]" />
      <ellipse cx="24" cy="66" rx="5" ry="2.6" className="fill-[var(--papi-foot)]" />
      <ellipse cx="40" cy="66" rx="5" ry="2.6" className="fill-[var(--papi-foot)]" />
      {/* body: a sheet with the top-right corner folded down */}
      <path d="M12 6 h30 l12 12 v38 a8 8 0 0 1 -8 8 h-34 a8 8 0 0 1 -8 -8 v-42 a8 8 0 0 1 8 -8 z"
        className="fill-[var(--papi-paper)] stroke-[var(--papi-ink)]" strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M42 6 v8 a4 4 0 0 0 4 4 h8" className="fill-[var(--papi-fold)] stroke-[var(--papi-ink)]" strokeWidth="2.2" strokeLinejoin="round" />
      {/* ruled lines, faint */}
      <path d="M14 48 h36 M14 54 h28" className="stroke-[var(--papi-rule)]" strokeWidth="1.4" strokeLinecap="round" />
      {/* cheeks */}
      <g style={{ opacity: 0.75 + blush * 0.25 }}>
        <ellipse cx="17" cy="38" rx={3.6 + blush * 1.4} ry={2.2 + blush * 0.8} className="fill-[var(--papi-cheek)]" />
        <ellipse cx="44" cy="38" rx={3.6 + blush * 1.4} ry={2.2 + blush * 0.8} className="fill-[var(--papi-cheek)]" />
      </g>
      {/* eyes */}
      <g transform={`translate(${eyeDx} ${eyeDy})`}>
        {mood === "dizzy" ? (
          <path d="M20 27 l6 6 M26 27 l-6 6 M35 27 l6 6 M41 27 l-6 6" className="stroke-[var(--papi-ink)]" strokeWidth="2.2" strokeLinecap="round" />
        ) : closed ? (
          <path d="M20 30 q3 2.4 6 0 M35 30 q3 2.4 6 0" className="stroke-[var(--papi-ink)]" strokeWidth="2.2" fill="none" strokeLinecap="round" />
        ) : happy ? (
          <path d="M20 31 q3 -3.4 6 0 M35 31 q3 -3.4 6 0" className="stroke-[var(--papi-ink)]" strokeWidth="2.2" fill="none" strokeLinecap="round" />
        ) : (
          <>
            <ellipse cx="23" cy="29.5" rx="3.1" ry="3.8" className="fill-[var(--papi-ink)]" />
            <ellipse cx="38" cy="29.5" rx="3.1" ry="3.8" className="fill-[var(--papi-ink)]" />
            <circle cx="24.2" cy="28" r="1.1" className="fill-[var(--papi-paper)]" />
            <circle cx="39.2" cy="28" r="1.1" className="fill-[var(--papi-paper)]" />
          </>
        )}
      </g>
      {/* mouth */}
      {mood === "wheee" ? (
        <ellipse cx="30.5" cy="40" rx="3.6" ry="3.4" className="fill-[var(--papi-ink)]" />
      ) : mood === "dizzy" ? (
        <path d="M26 40 q2 -2 4 0 q2 2 4 0" className="stroke-[var(--papi-ink)]" strokeWidth="2" fill="none" strokeLinecap="round" />
      ) : mood === "talk" ? (
        <ellipse cx="30.5" cy="39.5" rx="3" ry="2.6" className="fill-[var(--papi-ink)] papi-talk" />
      ) : mood === "think" ? (
        <path d="M27.5 40 h6" className="stroke-[var(--papi-ink)]" strokeWidth="2" strokeLinecap="round" />
      ) : mood === "sleep" ? (
        <ellipse cx="30.5" cy="40" rx="1.8" ry="1.4" className="fill-[var(--papi-ink)]" />
      ) : (
        <path d={happy ? "M26 38 q4.5 5 9 0" : "M27 38.5 q3.5 3 7 0"} className="stroke-[var(--papi-ink)]" strokeWidth="2" fill="none" strokeLinecap="round" />
      )}
    </svg>
  );
}
