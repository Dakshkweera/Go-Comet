import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, describe, expect, it } from "vitest";
import { createDb, documents } from "../../src/db/index.js";

const migrations = fileURLToPath(new URL("../../drizzle/", import.meta.url));
let dir: string;

afterEach(() => rmSync(dir, { recursive: true, force: true }));

function part1Folder() {
  const folder = join(dir, "part1");
  mkdirSync(join(folder, "meta"), { recursive: true });
  const journal = JSON.parse(readFileSync(join(migrations, "meta/_journal.json"), "utf8"));
  journal.entries = journal.entries.slice(0, 3);
  for (const { tag } of journal.entries) {
    copyFileSync(join(migrations, `${tag}.sql`), join(folder, `${tag}.sql`));
  }
  writeFileSync(join(folder, "meta/_journal.json"), JSON.stringify(journal));
  return folder;
}

describe("Part 2 migrations", () => {
  it("upgrade a Part 1 database without losing its rows", () => {
    dir = mkdtempSync(join(tmpdir(), "nova-migrate-"));
    const path = join(dir, "nova.db");
    const sqlite = new Database(path);
    sqlite.pragma("foreign_keys = ON");
    migrate(drizzle(sqlite), { migrationsFolder: part1Folder() });
    sqlite
      .prepare(
        "INSERT INTO documents (id, original_filename, mime_type, file_size, storage_path, created_at) VALUES ('doc_1', 'a.pdf', 'application/pdf', 1, 'x', 'now')",
      )
      .run();
    sqlite
      .prepare(
        "INSERT INTO pipeline_runs (id, document_id, status, current_stage, created_at, updated_at) VALUES ('run_1', 'doc_1', 'COMPLETED', 'COMPLETED', 'now', 'now')",
      )
      .run();
    sqlite.close();

    const db = createDb(path);
    const [doc] = db.select().from(documents).all();
    expect(doc).toMatchObject({ id: "doc_1", shipmentId: null, docType: null });
    expect(db.$client.prepare("SELECT COUNT(*) AS n FROM pipeline_runs").get()).toEqual({ n: 1 });
    db.$client.close();
  });

  it("exposes email headers without bodies and allows Part 1 documents without an email", () => {
    dir = mkdtempSync(join(tmpdir(), "nova-migrate-"));
    const db = createDb(":memory:");
    const columns = db.$client
      .prepare("SELECT name FROM pragma_table_info('email_log')")
      .all()
      .map((c) => (c as { name: string }).name);
    expect(columns).toEqual([
      "direction",
      "kind",
      "shipment_id",
      "cycle",
      "from_address",
      "to_address",
      "subject",
      "at",
    ]);

    const doc = { originalFilename: "a.pdf", mimeType: "application/pdf", fileSize: 1 };
    db.insert(documents)
      .values([
        { ...doc, id: "d1", storagePath: "x", contentHash: "same" },
        { ...doc, id: "d2", storagePath: "y", contentHash: "same" },
      ])
      .run();
    expect(db.select().from(documents).all()).toHaveLength(2);
    db.$client.close();
  });
});
