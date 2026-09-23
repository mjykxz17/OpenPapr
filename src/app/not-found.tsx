import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-surface px-6 text-ink">
      <div className="max-w-md text-center">
        <p className="font-mono text-[13px] text-ink-3">404</p>
        <h1 className="mt-1 text-xl font-semibold">Nothing here</h1>
        <p className="mt-2 text-sm text-ink-2">The page may have moved, or the link is wrong.</p>
        <Link href="/" className="mt-5 inline-flex h-10 items-center rounded-md bg-accent px-4 text-sm font-medium text-on-accent hover:bg-accent-strong">Home</Link>
      </div>
    </div>
  );
}
