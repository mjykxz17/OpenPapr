import { createDb, type Db } from "../db/client";
import { loadEnv } from "../lib/env";
let db: Db | null = null;
export const getDb = () => (db ??= createDb(loadEnv().DATABASE_PATH));
