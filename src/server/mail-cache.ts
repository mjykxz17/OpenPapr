import { dirname, join } from "node:path";

// Where a student's email attachments are kept (see worker/mail-attachments).
export const mailCacheDir = (userId: number) =>
  join(dirname(process.env.DATABASE_PATH ?? "data/openpapr.db"), "mail-cache", String(userId));
