export interface GraphMessage {
  id: string;
  subject: string | null;
  bodyPreview: string | null;
  webLink: string | null;
  receivedDateTime: string | null;
  from?: {
    emailAddress?: {
      name?: string;
      address?: string;
    };
  };
}

export class DeltaExpiredError extends Error {}

const BASE = "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$select=subject,from,bodyPreview,receivedDateTime,webLink";

export async function fetchInboxDelta(accessToken: string, deltaLink: string | null, fetchFn: typeof fetch = fetch) {
  let url = deltaLink ?? BASE;
  const messages: GraphMessage[] = [];
  for (;;) {
    const res = await fetchFn(url, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(30_000) });
    // A delta link Microsoft no longer recognises (410 Gone, or
    // syncStateNotFound) means "start over": marked so the caller can reset.
    if (res.status === 410 || (deltaLink && url === deltaLink && res.status === 400)) {
      const body = await res.text();
      if (res.status === 410 || /syncState|resync/i.test(body)) throw new DeltaExpiredError(`Graph ${res.status}: ${body.slice(0, 200)}`);
      throw new Error(`Graph ${res.status}: ${body.slice(0, 300)}`);
    }
    if (!res.ok) throw new Error(`Graph ${res.status}: ${await res.text()}`);
    const page = (await res.json()) as { value?: GraphMessage[]; "@odata.nextLink"?: string; "@odata.deltaLink"?: string };
    messages.push(...(page.value ?? []));
    if (page["@odata.nextLink"]) { url = page["@odata.nextLink"]; continue; }
    return { messages, deltaLink: page["@odata.deltaLink"] ?? url };
  }
}
