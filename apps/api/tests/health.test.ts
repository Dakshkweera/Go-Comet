import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { apiErrorSchema, healthResponseSchema } from "@nova/contracts";
import { createDb, type NovaDb } from "@nova/db";
import { buildServer, type ServerDeps } from "../src/server.js";

let db: NovaDb | undefined;
let app: ReturnType<typeof buildServer> | undefined;

function start(deps: Partial<ServerDeps> = {}) {
  db = createDb(":memory:");
  app = buildServer({ db, ...deps });
  return { db, app };
}

afterEach(async () => {
  await app?.close();
  if (db?.$client.open) db.$client.close();
});

describe("GET /api/health", () => {
  it("returns ok when the database responds", async () => {
    const res = await start().app.inject("/api/health");
    expect(res.statusCode).toBe(200);
    expect(healthResponseSchema.parse(res.json())).toEqual({ status: "ok", db: "ok" });
  });

  it("returns 503 when the database is unavailable", async () => {
    const { db, app } = start();
    db.$client.close();
    const res = await app.inject("/api/health");
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: "degraded", db: "error" });
  });

  it("returns a structured 404 for unknown API routes", async () => {
    const res = await start().app.inject("/api/nope");
    expect(res.statusCode).toBe(404);
    expect(apiErrorSchema.parse(res.json()).error.code).toBe("NOT_FOUND");
  });
});

describe("built web UI", () => {
  it("serves index.html for the root and client-side routes, but not for /api", async () => {
    const dist = mkdtempSync(join(tmpdir(), "nova-web-"));
    writeFileSync(join(dist, "index.html"), "<title>Nova</title>");
    try {
      const { app } = start({ webDistDir: dist });
      for (const url of ["/", "/runs/abc"]) {
        const res = await app.inject(url);
        expect(res.statusCode).toBe(200);
        expect(res.body).toContain("<title>Nova</title>");
      }
      expect((await app.inject("/api/nope")).statusCode).toBe(404);
    } finally {
      rmSync(dist, { recursive: true, force: true });
    }
  });
});
