// The OpenPapr logo: Papi standing still, drawn from the same shapes as the
// pet (PapiFace) and coloured by the same --papi-* tokens, so it follows the
// theme. Bolder strokes and no ruled lines, because it is shown small.
export function PapiMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg viewBox="-1 2 68 68" width={size} height={size} aria-hidden className={`block shrink-0 ${className}`}>
      <ellipse cx="24" cy="66" rx="5.5" ry="2.8" className="fill-[var(--papi-foot)]" />
      <ellipse cx="40" cy="66" rx="5.5" ry="2.8" className="fill-[var(--papi-foot)]" />
      <path d="M12 6 h30 l12 12 v38 a8 8 0 0 1 -8 8 h-34 a8 8 0 0 1 -8 -8 v-42 a8 8 0 0 1 8 -8 z"
        className="fill-[var(--papi-paper)] stroke-[var(--papi-ink)]" strokeWidth="3.2" strokeLinejoin="round" />
      <path d="M42 6 v8 a4 4 0 0 0 4 4 h8" className="fill-[var(--papi-fold)] stroke-[var(--papi-ink)]" strokeWidth="3.2" strokeLinejoin="round" />
      <ellipse cx="17" cy="40" rx="4.2" ry="2.7" className="fill-[var(--papi-cheek)]" />
      <ellipse cx="44" cy="40" rx="4.2" ry="2.7" className="fill-[var(--papi-cheek)]" />
      <ellipse cx="23" cy="30.5" rx="3.8" ry="4.6" className="fill-[var(--papi-ink)]" />
      <ellipse cx="38" cy="30.5" rx="3.8" ry="4.6" className="fill-[var(--papi-ink)]" />
      <circle cx="24.4" cy="28.8" r="1.3" className="fill-[var(--papi-paper)]" />
      <circle cx="39.4" cy="28.8" r="1.3" className="fill-[var(--papi-paper)]" />
      <path d="M26 39.5 q4.5 4.5 9 0" fill="none" className="stroke-[var(--papi-ink)]" strokeWidth="2.8" strokeLinecap="round" />
    </svg>
  );
}
