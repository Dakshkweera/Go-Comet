import { existsSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiErrorSchema, healthResponseSchema } from "../../../packages/contracts/src/index.js";
import { documents, type NovaDb } from "../../../packages/db/src/index.js";
import { executeReadOnly } from "../../../packages/query/src/index.js";
import type { buildServer } from "../src/server.js";

const tempDirs: string[] = [];
let db: NovaDb | undefined;
let app: ReturnType<typeof buildServer> | undefined;

const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "nova-api-"));
  tempDirs.push(dir);
  return dir;
};

async function start(env: Record<string, string> = {}) {
  Object.assign(process.env, {
    DATABASE_PATH: join(tempDir(), "nova.db"),
    UPLOAD_DIR: tempDir(),
    WEB_DIST_DIR: tempDir(),
    LLM_PROVIDER: "fake",
    LOG_LEVEL: "silent",
    ...env,
  });
  vi.resetModules();
  const container = await import("../src/container.js");
  const { buildServer } = await import("../src/server.js");
  db = container.db;
  app = buildServer();
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
    const res = await (await start()).app.inject("/api/health");
    expect(res.statusCode).toBe(200);
    expect(healthResponseSchema.parse(res.json())).toEqual({ status: "ok", db: "ok" });
  });

  it("returns 503 when the database is unavailable", async () => {
    const { db, app } = await start();
    db.$client.close();
    const res = await app.inject("/api/health");
    expect(res.statusCode).toBe(503);
  });

  it("returns a structured 404 for unknown API routes", async () => {
    const res = await (await start()).app.inject("/api/nope");
    expect(res.statusCode).toBe(404);
    expect(apiErrorSchema.parse(res.json()).error.code).toBe("NOT_FOUND");
  });
});

describe("runs API", () => {
  it("accepts a PDF, processes it and returns the full run", async () => {
    await start();
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
    await start();
    const res = await upload(name, type, content);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe(code);
  });

  it("returns 404 for an unknown run", async () => {
    const res = await (await start()).app.inject("/api/runs/run_missing");
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /api/runs/:id/document", () => {
  const pdf = Buffer.from("%PDF-1.4 original bytes");

  it("returns the original uploaded file inline with its MIME type", async () => {
    await start();
    const { runId } = (await upload("invoice.pdf", "application/pdf", pdf)).json();
    const res = await app!.inject(`/api/runs/${runId}/document`);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toBe('inline; filename="invoice.pdf"');
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.rawPayload.equals(pdf)).toBe(true);
  });

  it("returns 404 RUN_NOT_FOUND for an unknown run, including path-like ids", async () => {
    const { app } = await start();
    for (const id of ["run_missing", "..%2F..%2F.env"]) {
      const res = await app.inject(`/api/runs/${id}/document`);
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("RUN_NOT_FOUND");
    }
  });

  it("returns 404 DOCUMENT_MISSING when the stored file was deleted", async () => {
    const { db } = await start();
    const { runId } = (await upload("invoice.pdf", "application/pdf", pdf)).json();
    unlinkSync(db.select().from(documents).get()!.storagePath);
    const res = await app!.inject(`/api/runs/${runId}/document`);
    expect(res.statusCode).toBe(404);
    expect(apiErrorSchema.parse(res.json()).error.code).toBe("DOCUMENT_MISSING");
  });
});

describe("DELETE /api/runs/:id", () => {
  const pdf = Buffer.from("%PDF-1.4 demo invoice");

  async function uploadAndFinish() {
    const { runId } = (await upload("invoice.pdf", "application/pdf", pdf)).json();
    let run = (await app!.inject(`/api/runs/${runId}`)).json();
    for (let i = 0; i < 50 && run.status !== "COMPLETED"; i++) {
      await new Promise((r) => setTimeout(r, 20));
      run = (await app!.inject(`/api/runs/${runId}`)).json();
    }
    return run;
  }

  it("deletes a completed run and removes it from every read path", async () => {
    const { db } = await start();
    const run = await uploadAndFinish();
    const { storagePath } = db.select().from(documents).get()!;

    const res = await app!.inject({ method: "DELETE", url: `/api/runs/${run.id}` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ deleted: true, runId: run.id, fileDeleted: true });
    expect(existsSync(storagePath)).toBe(false);
    expect((await app!.inject("/api/runs")).json()).toEqual([]);
    expect((await app!.inject(`/api/runs/${run.id}`)).statusCode).toBe(404);
    expect((await app!.inject(`/api/runs/${run.id}/document`)).statusCode).toBe(404);
    const counts = executeReadOnly(
      db,
      "SELECT (SELECT COUNT(*) FROM pipeline_runs) AS runs, (SELECT COUNT(*) FROM extractions) AS extractions, (SELECT COUNT(*) FROM customers) AS customers, (SELECT COUNT(*) FROM customer_rules) AS rules",
    );
    expect(counts.rows).toEqual([{ runs: 0, extractions: 0, customers: 1, rules: 5 }]);
  });

  it("returns a structured 404 for an unknown run", async () => {
    const { app } = await start();
    const res = await app.inject({ method: "DELETE", url: "/api/runs/run_missing" });
    expect(res.statusCode).toBe(404);
    expect(apiErrorSchema.parse(res.json()).error.code).toBe("RUN_NOT_FOUND");
  });

  it("returns 409 while the run is still processing", async () => {
    const { db, app } = await start();
    const run = await uploadAndFinish();
    db.$client.prepare("UPDATE pipeline_runs SET status = 'PROCESSING'").run();
    const res = await app.inject({ method: "DELETE", url: `/api/runs/${run.id}` });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("RUN_IN_PROGRESS");
  });

  it("accepts the exact same file again after deletion as a fresh run", async () => {
    await start();
    const first = await uploadAndFinish();
    await app!.inject({ method: "DELETE", url: `/api/runs/${first.id}` });

    const second = await uploadAndFinish();

    expect(second.id).not.toBe(first.id);
    expect(second.status).toBe("COMPLETED");
    expect(second.attempts).toHaveLength(1);
    expect(second.decision.decision).toBe("auto_approve");
    expect((await app!.inject("/api/runs")).json().map((r: { id: string }) => r.id)).toEqual([
      second.id,
    ]);
  });
});

describe("POST /api/query", () => {
  it("rejects an empty question and reports when no model is configured", async () => {
    const { app } = await start();
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
    const { app } = await start({ WEB_DIST_DIR: dist });
    for (const url of ["/", "/runs/abc"]) {
      const res = await app.inject(url);
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain("<title>Nova</title>");
    }
    expect((await app.inject("/api/nope")).statusCode).toBe(404);
  });
});
