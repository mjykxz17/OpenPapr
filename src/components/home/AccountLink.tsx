import Link from "next/link";

// On a phone the tab bar's spot for Account went to Papi (Ask), so Account —
// with appearance and sign-out — is reached from the Home header instead.
export function AccountLink() {
  return (
    <Link href="/account" aria-label="Account" title="Account"
      className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-line-2 bg-panel text-ink hover:border-ink-3 sm:hidden">
      <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </svg>
    </Link>
  );
}
