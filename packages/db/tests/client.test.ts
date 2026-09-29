import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDb, pingDb, type NovaDb } from "../src/index.js";

describe("createDb", () => {
  let dir: string | undefined;
  let db: NovaDb | undefined;

  afterEach(() => {
    db?.$client.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
    db = undefined;
    dir = undefined;
  });

  it("creates a file database in a missing directory and answers a ping", () => {
    dir = mkdtempSync(join(tmpdir(), "nova-db-"));
    db = createDb(join(dir, "nested", "test.db"));
    expect(pingDb(db)).toBe(true);
  });

  it("enforces foreign keys", () => {
    db = createDb(":memory:");
    const fk = db.$client.pragma("foreign_keys", { simple: true });
    expect(fk).toBe(1);
  });

  it("reports false when the connection is closed", () => {
    db = createDb(":memory:");
    db.$client.close();
    expect(pingDb(db)).toBe(false);
    db = undefined;
  });
});
