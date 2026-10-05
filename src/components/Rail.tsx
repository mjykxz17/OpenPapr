"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignOutButton } from "./SignOutButton";
import { AppearanceMenu } from "./AppearanceMenu";
import { PapiMark } from "./brand/PapiMark";
import { openSearch } from "./SearchPalette";
import { ChangesBell } from "./ChangesBell";

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

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function AccountIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  );
}

const NAV = [
  { href: "/", label: "Home", Icon: HomeIcon },
  { href: "/tasks", label: "Tasks", Icon: RemindersIcon },
  { href: "/study", label: "Study guides", Icon: StudyIcon },
  { href: "/mail", label: "Mail", Icon: MailIcon },
] as const;

// The rail is the only persistent chrome, so it also says where you are:
// the current section's icon sits on an accent tint and carries
// aria-current. Targets are 44px — the minimum a finger can hit.
export function Rail({ showMail = true, changes = null }: { showMail?: boolean; changes?: number | null }) {
  const nav = NAV.filter((n) => showMail || n.href !== "/mail");
  const pathname = usePathname();
  // A module's guide belongs to Guides; the rest of a module page to Home.
  const inGuide = /^\/modules\/[^/]+\/guide/.test(pathname);
  const isActive = (href: string) => (href === "/" ? pathname === "/" || (pathname.startsWith("/modules") && !inGuide)
    : href === "/study" ? pathname.startsWith("/study") || inGuide : pathname.startsWith(href));
  return (
    <>
    {/* On a phone the rail becomes a tab bar along the bottom, where a thumb
        reaches. Appearance and sign-out move to the Account tab. */}
    <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden">
      {[...nav, { href: "/account", label: "Account", Icon: AccountIcon }].map(({ href, label, Icon }) => {
        const active = isActive(href);
        return (
          <Link key={href} href={href} aria-current={active ? "page" : undefined}
            className={`flex h-[60px] flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${active ? "text-accent" : "text-ink-3"}`}>
            <Icon />
            <span>{label === "Study guides" ? "Guides" : label}</span>
          </Link>
        );
      })}
      <button type="button" onClick={openSearch} className="flex h-[60px] flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-ink-3">
        <SearchIcon />
        <span>Search</span>
      </button>
    </nav>
    <nav aria-label="Primary" className="fixed inset-y-0 left-0 z-10 hidden w-14 flex-col items-center gap-1 border-r border-line bg-surface py-3 sm:flex">
      <Link href="/" title="OpenPapr" aria-label="OpenPapr home" className="mb-2 flex h-11 w-11 items-center justify-center rounded-md transition-transform hover:-translate-y-0.5">
        <PapiMark size={30} />
      </Link>
      <button type="button" onClick={openSearch} title="Search (⌘K)" aria-label="Search"
        className="flex h-11 w-11 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-ink/[0.05] hover:text-ink">
        <SearchIcon />
      </button>
      {nav.map(({ href, label, Icon }) => {
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
      {changes !== null && <ChangesBell count={changes} />}
      <div className="mt-auto flex flex-col items-center gap-1">
        <Link
          href="/account"
          title="Account"
          aria-label="Account"
          aria-current={isActive("/account") ? "page" : undefined}
          className={`flex h-11 w-11 items-center justify-center rounded-md transition-colors ${
            isActive("/account") ? "bg-accent-soft text-accent" : "text-ink-2 hover:bg-ink/[0.05] hover:text-ink"
          }`}
        >
          <AccountIcon />
        </Link>
        <AppearanceMenu />
        <SignOutButton />
      </div>
    </nav>
    </>
  );
}
