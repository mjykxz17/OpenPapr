// Mail needs this instance to have an Outlook (Microsoft) app set up: without
// one nothing can connect or sync, so the Mail page is a 404 and nothing
// links to it. With one, the rail links it for everyone but the demo account.
export function mailEnabled(env: { MS_CLIENT_ID?: string }): boolean {
  return Boolean(env.MS_CLIENT_ID?.trim());
}

// Whether to count Outlook as one of the user's synced sources (on the home
// sync line, say). A token left over from before the app was removed doesn't
// count: there is no Mail page to fix it on.
export function mailConnected(env: { MS_CLIENT_ID?: string }, user: { msRefreshTokenEnc?: string | null } | null | undefined): boolean {
  return mailEnabled(env) && Boolean(user?.msRefreshTokenEnc);
}
