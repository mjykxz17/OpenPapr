import Link from "next/link";
import type { ReactNode } from "react";

// The frame every home widget sits in: a title, an optional link or control
// on the right, and the body.
export function WidgetCard({ title, href, linkLabel = "Open", action, children, className = "" }: { title: string; href?: string; linkLabel?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`@container flex h-full flex-col gap-3 overflow-hidden rounded-[10px] border border-line bg-panel px-[18px] py-4 ${className}`}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="truncate text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-2">{title}</h2>
        {action}
        {href && <Link href={href} className="hidden shrink-0 text-[12px] text-ink-3 hover:text-accent @[210px]:inline">{linkLabel} →</Link>}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

