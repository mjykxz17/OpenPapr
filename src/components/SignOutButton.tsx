"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

function SignOutIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5M21 12H9" />
    </svg>
  );
}

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    try {
      await fetch("/api/logout", { method: "POST" });
    } catch {
      // Even if the request fails the safest thing is still to send the user to
      // the sign-in page; a stale cookie is rejected there anyway.
    }
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={pending}
      title="Sign out"
      aria-label="Sign out"
      className="flex h-9 w-9 items-center justify-center text-ink-3 hover:text-danger disabled:opacity-50"
    >
      <SignOutIcon />
    </button>
  );
}
