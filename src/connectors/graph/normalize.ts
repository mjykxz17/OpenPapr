export interface MailItem {
  sourceId: string;
  title: string;
  body: string | null;
  url: string | null;
  sender: string | null;
  sourceCreatedAt: number | null;
  moduleId?: number | null;
}
