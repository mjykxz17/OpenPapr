// run: OPENPAPR_USERNAME=you OPENPAPR_PASSWORD=... npx tsx scripts/set-password.ts [--user 1]
//
// Sets or changes the sign-in username and password for an account, so the
// Canvas token never has to be pasted again. Credentials are read from the
// environment rather than argv so they do not land in shell history or in the
// process list; only the resulting scrypt hash is written to the database.
import { eq } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { users } from "../src/db/schema";
import { loadEnv } from "../src/lib/env";
import { hashPassword, normalizeUsername } from "../src/server/password";
import { setCredentials } from "../src/db/repo";
import { parseUserArg } from "../src/lib/cli";

function main(): void {
  const rawUser = process.env.OPENPAPR_USERNAME ?? "";
  const password = process.env.OPENPAPR_PASSWORD ?? "";
  if (!rawUser || !password) throw new Error("set OPENPAPR_USERNAME and OPENPAPR_PASSWORD");
  if (password.length < 8) throw new Error("password must be at least 8 characters");

  const username = normalizeUsername(rawUser);
  const env = loadEnv();
  const db = createDb(env.DATABASE_PATH);
  const userId = parseUserArg(process.argv);

  const row = db.select().from(users).where(eq(users.id, userId)).get();
  if (!row) throw new Error(`no user ${userId}`);

  if (!setCredentials(db, userId, username, hashPassword(password))) {
    throw new Error(`username "${username}" already belongs to another account`);
  }
  console.log(`set username "${username}" for user ${userId} (${row.name}); password stored as a scrypt hash`);
}

main();
