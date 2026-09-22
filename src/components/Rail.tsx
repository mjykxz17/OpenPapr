"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignOutButton } from "./SignOutButton";

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M9 22V12h6v10" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}

function RemindersIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2v3M16 2v3M3.5 9h17" />
      <rect width="17" height="16" x="3.5" y="5" rx="2" />
      <path d="m8.5 14 2 2 4-4" />
    </svg>
  );
}

function StudyIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

const NAV = [
  { href: "/", label: "Home", Icon: HomeIcon },
  { href: "/reminders", label: "Reminders", Icon: RemindersIcon },
  { href: "/study", label: "Study guides", Icon: StudyIcon },
  { href: "/mail", label: "Mail", Icon: MailIcon },
] as const;

// The rail is the only persistent chrome, so it also says where you are:
// the current section's icon sits on an accent tint and carries
// aria-current. Targets are 44px — the minimum a finger can hit.
export function Rail() {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" || pathname.startsWith("/modules") : pathname.startsWith(href));
  return (
    <nav aria-label="Primary" className="fixed inset-y-0 left-0 z-10 flex w-14 flex-col items-center gap-1 border-r border-line bg-surface py-3">
      {NAV.map(({ href, label, Icon }) => {
        const active = isActive(href);
        return (
          <Link
            key={href}
            href={href}
            title={label}
            aria-label={label}
            aria-current={active ? "page" : undefined}
            className={`flex h-11 w-11 items-center justify-center rounded-md transition-colors ${
              active ? "bg-accent-soft text-accent" : "text-ink-2 hover:bg-ink/[0.05] hover:text-ink"
            }`}
          >
            <Icon />
          </Link>
        );
      })}
      <div className="mt-auto">
        <SignOutButton />
      </div>
    </nav>
  );
}
