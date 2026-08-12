import type { GraphMessage } from "./client";
import { detectModuleCodes } from "../../enrich/rules";

export interface MailItem {
  sourceId: string; title: string; body: string | null; url: string | null;
  sender: string | null; sourceCreatedAt: number | null; moduleId?: number | null;
}

export function normalizeMail(msg: GraphMessage): MailItem {
  return {
    sourceId: `mail:${msg.id}`,
    title: msg.subject ?? "(no subject)",
    body: msg.bodyPreview ?? null,
    url: msg.webLink ?? null,
    sender: msg.from?.emailAddress?.address ?? null,
    sourceCreatedAt: msg.receivedDateTime ? Date.parse(msg.receivedDateTime) : null,
    moduleId: null,
  };
}

export function linkMailToModule(mail: MailItem, modulesByCode: Map<string, number>): MailItem {
  for (const code of detectModuleCodes(`${mail.title} ${mail.body ?? ""}`)) {
    const id = modulesByCode.get(code);
    if (id !== undefined) return { ...mail, moduleId: id };
  }
  return mail;
}
