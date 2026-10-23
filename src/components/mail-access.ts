// Mail needs this instance to have an Outlook (Microsoft) app set up: without
// one nothing can connect or sync, so the Mail page is a 404 and nothing
// links to it. With one, the rail links it for everyone but the demo account.
export function mailEnabled(env: { MS_CLIENT_ID?: string }): boolean {
  return Boolean(env.MS_CLIENT_ID?.trim());
}
