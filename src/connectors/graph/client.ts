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

const BASE = "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$select=subject,from,bodyPreview,receivedDateTime,webLink";

export async function fetchInboxDelta(accessToken: string, deltaLink: string | null, fetchFn: typeof fetch = fetch) {
  let url = deltaLink ?? BASE;
  const messages: GraphMessage[] = [];
  for (;;) {
    const res = await fetchFn(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new Error(`Graph ${res.status}: ${await res.text()}`);
    const page = (await res.json()) as { value?: GraphMessage[]; "@odata.nextLink"?: string; "@odata.deltaLink"?: string };
    messages.push(...(page.value ?? []));
    if (page["@odata.nextLink"]) { url = page["@odata.nextLink"]; continue; }
    return { messages, deltaLink: page["@odata.deltaLink"] ?? url };
  }
}
