import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema/index.js";

export type NovaDb = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

export function createDb(path: string): NovaDb {
  const inMemory = path === ":memory:";
  if (!inMemory) mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma("foreign_keys = ON");
  if (!inMemory) sqlite.pragma("journal_mode = WAL");
  return drizzle(sqlite, { schema });
}
