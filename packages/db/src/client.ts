import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema.js";

export type NovaDb = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

export function createDb(path: string): NovaDb {
  const inMemory = path === ":memory:";
  if (!inMemory) mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma("foreign_keys = ON");
  if (!inMemory) sqlite.pragma("journal_mode = WAL");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
  return db;
}
