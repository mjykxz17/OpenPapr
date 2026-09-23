import Link from "next/link";

// The way back up one level, drawn as a button rather than a line of grey
// text: a bordered target with a clear chevron, the same size and look on
// every page, so it is found at a glance.
export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="group inline-flex h-9 shrink-0 items-center gap-1.5 self-start rounded-md border border-line-2 bg-panel pl-2 pr-3 text-[14px] font-medium text-ink no-underline transition-colors hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden
        className="transition-transform group-hover:-translate-x-0.5">
        <path d="m15 18-6-6 6-6" />
      </svg>
      <span className="sr-only">Back to </span>
      {children}
    </Link>
  );
}
