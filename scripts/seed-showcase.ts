// run: npx tsx scripts/seed-showcase.ts
//
// A fuller, entirely fictional semester for screenshots and for trying the
// app without a Canvas account: four modules, tasks broken into steps, a
// weekly plan, announcements, a lecturer's forum reply and a study guide.
//   DATABASE_PATH=data/showcase.db SECRET_KEY=$(openssl rand -hex 32) APP_PASSWORD=showcase1 npm run dev
// then sign in as  demo / openpapr-demo.  Re-running starts from scratch.
import { existsSync, rmSync } from "node:fs";
import { createDb } from "../src/db/client";
import { users } from "../src/db/schema";
import { seedSemester } from "../src/demo/semester";
import { installDemoDecks } from "../src/server/demo";
import { hashPassword } from "../src/server/password";

const DB_PATH = process.env.SHOWCASE_DB ?? "data/showcase.db";
for (const s of ["", "-wal", "-shm"]) if (existsSync(DB_PATH + s)) rmSync(DB_PATH + s);
const db = createDb(DB_PATH);

const now = Date.now();
const D = 86_400_000;

const user = db.insert(users).values({ name: "Alex Tan", lastSeenAt: now - D, major: "Computer Science", studyYear: 2, username: "demo", passwordHash: hashPassword("openpapr-demo"), onboardedAt: now }).returning().get();
const u = user.id;

const { moduleIds } = seedSemester(db, u, now);
// The made-up CS3230 decks, into the cache the slide viewer reads from.
installDemoDecks(db, moduleIds, DB_PATH).then((n) => console.log(`seeded ${DB_PATH} with ${n} decks — sign in as demo / openpapr-demo`));
