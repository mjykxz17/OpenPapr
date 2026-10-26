export interface GraphMessage {
  id: string;
  subject: string | null;
  bodyPreview: string | null;
  webLink: string | null;
  receivedDateTime: string | null;
  // The whole body, as plain text (asked for with the Prefer header).
  body?: { contentType?: string; content?: string } | null;
  hasAttachments?: boolean;
  from?: {
    emailAddress?: {
      name?: string;
      address?: string;
    };
  };
}

export class DeltaExpiredError extends Error {}

const GRAPH = "https://graph.microsoft.com/v1.0";
const BASE = `${GRAPH}/me/mailFolders/inbox/messages/delta?$select=subject,from,bodyPreview,body,hasAttachments,receivedDateTime,webLink`;
// Bodies as text rather than HTML: what every reader of an email wants.
const TEXT_BODY = { Prefer: 'outlook.body-content-type="text"' };

export async function fetchInboxDelta(accessToken: string, deltaLink: string | null, fetchFn: typeof fetch = fetch) {
  let url = deltaLink ?? BASE;
  const messages: GraphMessage[] = [];
  for (;;) {
    const res = await fetchFn(url, { headers: { Authorization: `Bearer ${accessToken}`, ...TEXT_BODY }, signal: AbortSignal.timeout(30_000) });
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

// A message's attachments, without their bytes. Inline pictures (signatures,
// logos) and attached emails or links are not files worth keeping.
export type GraphAttachment = { id: string; name: string; contentType: string | null; size: number | null };
export async function listAttachments(accessToken: string, messageId: string, fetchFn: typeof fetch = fetch): Promise<GraphAttachment[]> {
  const res = await fetchFn(`${GRAPH}/me/messages/${encodeURIComponent(messageId)}/attachments?$select=id,name,contentType,size,isInline`, {
    headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Graph ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const page = (await res.json()) as { value?: { "@odata.type"?: string; id: string; name?: string; contentType?: string; size?: number; isInline?: boolean }[] };
  return (page.value ?? []).filter((a) => a["@odata.type"] === "#microsoft.graph.fileAttachment" && !a.isInline)
    .map((a) => ({ id: a.id, name: a.name ?? "attachment", contentType: a.contentType ?? null, size: a.size ?? null }));
}

export async function downloadAttachment(accessToken: string, messageId: string, attachmentId: string, fetchFn: typeof fetch = fetch): Promise<ReadableStream<Uint8Array>> {
  const res = await fetchFn(`${GRAPH}/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}/$value`, {
    headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok || !res.body) throw new Error(`Graph attachment ${res.status}`);
  return res.body;
}
