// run: npx tsx scripts/connect-microsoft.ts [--user 1]
import { createDb } from "../src/db/client";
import { users } from "../src/db/schema";
import { loadEnv } from "../src/lib/env";
import { encrypt } from "../src/lib/crypto";
import { runDeviceCodeFlow } from "../src/connectors/graph/auth";
import { parseUserArg } from "../src/lib/cli";
import { eq } from "drizzle-orm";

const env = loadEnv();
if (!env.MS_CLIENT_ID) throw new Error("Set MS_CLIENT_ID");
const userId = parseUserArg(process.argv);
const db = createDb(env.DATABASE_PATH);
const { refreshToken } = await runDeviceCodeFlow(env.MS_CLIENT_ID, (i) =>
  console.log(`\n>>> Open ${i.verificationUri} and enter code: ${i.userCode}\n`));
if (!refreshToken) throw new Error("No refresh token returned — check offline_access scope");
db.update(users).set({ msRefreshTokenEnc: encrypt(refreshToken, env.SECRET_KEY), msDeltaLink: null })
  .where(eq(users.id, userId)).run();
const updated = db.select().from(users).where(eq(users.id, userId)).get();
if (!updated?.msRefreshTokenEnc) throw new Error(`Failed to store token for user ${userId} — user may not exist`);
console.log(`Stored encrypted refresh token for user ${userId}.`);
