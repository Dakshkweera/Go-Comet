import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { apiErrorSchema, healthResponseSchema } from "@nova/contracts";
import { createDb, seedDb, type NovaDb } from "@nova/db";
import { createFakeExtractor } from "@nova/extraction";
import { createPipeline } from "@nova/pipeline";
import { createRouter } from "@nova/routing";
import { createValidator } from "@nova/validation";
import { buildServer, type ServerDeps } from "../src/server.js";

const tempDirs: string[] = [];
let db: NovaDb | undefined;
let app: ReturnType<typeof buildServer> | undefined;

const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "nova-api-"));
  tempDirs.push(dir);
  return dir;
};

function start(overrides: Partial<ServerDeps> = {}) {
  db = createDb(":memory:");
  seedDb(db);
  const pipeline = createPipeline({
    db,
    extractor: createFakeExtractor(),
    validator: createValidator({ minConfidence: 0.8 }),
    router: createRouter({ minConfidence: 0.8 }),
    maxAttempts: 3,
    retryDelayMs: 0,
  });
  app = buildServer({
    db,
    pipeline,
    uploadDir: tempDir(),
    maxUploadBytes: 1024 * 1024,
    ...overrides,
  });
  return { db, app };
}

function upload(filename: string, contentType: string, content: string | Buffer) {
  const boundary = "----nova-test";
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
    ),
    Buffer.from(content),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return app!.inject({
    method: "POST",
    url: "/api/runs",
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload,
  });
}

afterEach(async () => {
  await app?.close();
  if (db?.$client.open) db.$client.close();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
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
  });

  it("returns a structured 404 for unknown API routes", async () => {
    const res = await start().app.inject("/api/nope");
    expect(res.statusCode).toBe(404);
    expect(apiErrorSchema.parse(res.json()).error.code).toBe("NOT_FOUND");
  });
});

describe("runs API", () => {
  it("accepts a PDF, processes it and returns the full run", async () => {
    start();
    const res = await upload("invoice.pdf", "application/pdf", "%PDF-1.4 test");
    expect(res.statusCode).toBe(202);
    const { runId } = res.json();

    let run = (await app!.inject(`/api/runs/${runId}`)).json();
    for (let i = 0; i < 50 && run.status !== "COMPLETED"; i++) {
      await new Promise((r) => setTimeout(r, 20));
      run = (await app!.inject(`/api/runs/${runId}`)).json();
    }
    expect(run.decision.decision).toBe("auto_approve");
    expect(run.extraction.hs_code.value).toBe("640399");

    const list = (await app!.inject("/api/runs")).json();
    expect(list[0]).toMatchObject({ id: runId, filename: "invoice.pdf" });
  });

  it.each([
    ["unsupported type", "notes.txt", "text/plain", "hello", "UNSUPPORTED_FILE_TYPE"],
    ["empty file", "empty.pdf", "application/pdf", "", "INVALID_FILE"],
    ["corrupt PDF", "fake.pdf", "application/pdf", "not a pdf", "DOCUMENT_READ_ERROR"],
  ])("rejects %s", async (_label, name, type, content, code) => {
    start();
    const res = await upload(name, type, content);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe(code);
  });

  it("returns 404 for an unknown run", async () => {
    const res = await start().app.inject("/api/runs/run_missing");
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /api/query", () => {
  it("rejects an empty question and reports when no model is configured", async () => {
    const { app } = start();
    const post = (question: string) =>
      app.inject({ method: "POST", url: "/api/query", payload: { question } });
    expect((await post("")).statusCode).toBe(400);
    const res = await post("How many shipments were flagged?");
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("QUERY_UNAVAILABLE");
  });
});

describe("built web UI", () => {
  it("serves index.html for client routes but not for /api", async () => {
    const dist = tempDir();
    writeFileSync(join(dist, "index.html"), "<title>Nova</title>");
    const { app } = start({ webDistDir: dist });
    for (const url of ["/", "/runs/abc"]) {
      const res = await app.inject(url);
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain("<title>Nova</title>");
    }
    expect((await app.inject("/api/nope")).statusCode).toBe(404);
  });
});
