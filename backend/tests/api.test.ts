import { existsSync, unlinkSync } from "node:fs";
import request, { type Response } from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { documents } from "../src/db/index.js";
import { apiErrorSchema, healthResponseSchema } from "../src/schemas/index.js";
import { executeReadOnly } from "../src/services/query/index.js";
import { ALLOWED_ORIGIN, createTestApp } from "./helpers/testApp.js";

const cleanups: Array<() => void> = [];

function start(overrides: Parameters<typeof createTestApp>[0] = {}) {
  const ctx = createTestApp(overrides);
  cleanups.push(ctx.cleanup);
  return ctx;
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

type TestApp = ReturnType<typeof start>["app"];

const upload = (app: TestApp, filename: string, contentType: string, content: string | Buffer) =>
  request(app).post("/api/runs").attach("file", Buffer.from(content), { filename, contentType });

const binary = (res: Response, done: (err: Error | null, body: Buffer) => void): void => {
  const chunks: Buffer[] = [];
  res.on("data", (chunk: Buffer) => chunks.push(chunk));
  res.on("end", () => done(null, Buffer.concat(chunks)));
};

async function uploadAndFinish(app: TestApp, content: string | Buffer = "%PDF-1.4 demo invoice") {
  const { runId } = (await upload(app, "invoice.pdf", "application/pdf", content)).body;
  let run = (await request(app).get(`/api/runs/${runId}`)).body;
  for (let i = 0; i < 50 && run.status !== "COMPLETED"; i++) {
    await new Promise((r) => setTimeout(r, 20));
    run = (await request(app).get(`/api/runs/${runId}`)).body;
  }
  return run;
}

describe("GET /api/health", () => {
  it("returns ok when the database responds", async () => {
    const res = await request(start().app).get("/api/health");
    expect(res.status).toBe(200);
    expect(healthResponseSchema.parse(res.body)).toEqual({ status: "ok", db: "ok" });
  });

  it("returns 503 when the database is unavailable", async () => {
    const { app, db } = start();
    db.$client.close();
    expect((await request(app).get("/api/health")).status).toBe(503);
  });

  it("returns a structured 404 for unknown routes", async () => {
    const res = await request(start().app).get("/api/nope");
    expect(res.status).toBe(404);
    expect(apiErrorSchema.parse(res.body).error.code).toBe("NOT_FOUND");
  });
});

describe("CORS", () => {
  it("allows the configured frontend origin and no other", async () => {
    const { app } = start();
    const allowed = await request(app).get("/api/health").set("Origin", ALLOWED_ORIGIN);
    expect(allowed.headers["access-control-allow-origin"]).toBe(ALLOWED_ORIGIN);
    const other = await request(app).get("/api/health").set("Origin", "https://evil.example");
    expect(other.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("answers the preflight for DELETE", async () => {
    const res = await request(start().app)
      .options("/api/runs/run_1")
      .set("Origin", ALLOWED_ORIGIN)
      .set("Access-Control-Request-Method", "DELETE");
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-methods"]).toContain("DELETE");
  });

  it("allows any origin when configured with *", async () => {
    const { app } = start({ corsOrigins: ["*"] });
    const res = await request(app).get("/api/health").set("Origin", "https://anything.example");
    expect(res.headers["access-control-allow-origin"]).toBe("https://anything.example");
  });
});

describe("runs API", () => {
  it("accepts a PDF, processes it and returns the full run", async () => {
    const { app } = start();
    const res = await upload(app, "invoice.pdf", "application/pdf", "%PDF-1.4 test");
    expect(res.status).toBe(202);
    const { runId } = res.body;

    const run = await uploadAndFinishById(app, runId);
    expect(run.decision.decision).toBe("auto_approve");
    expect(run.extraction.hs_code.value).toBe("640399");

    const list = (await request(app).get("/api/runs")).body;
    expect(list[0]).toMatchObject({ id: runId, filename: "invoice.pdf" });
  });

  it.each([
    ["unsupported type", "notes.txt", "text/plain", "hello", "UNSUPPORTED_FILE_TYPE"],
    ["empty file", "empty.pdf", "application/pdf", "", "INVALID_FILE"],
    ["corrupt PDF", "fake.pdf", "application/pdf", "not a pdf", "DOCUMENT_READ_ERROR"],
  ])("rejects %s", async (_label, name, type, content, code) => {
    const res = await upload(start().app, name, type, content);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(code);
  });

  it("rejects a request with no file", async () => {
    const res = await request(start().app).post("/api/runs");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_FILE");
  });

  it("rejects a file above the upload limit with 413", async () => {
    const { app } = start({ maxUploadBytes: 20 });
    const res = await upload(app, "big.pdf", "application/pdf", `%PDF-1.4 ${"x".repeat(200)}`);
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("FILE_TOO_LARGE");
  });

  it("returns 404 for an unknown run", async () => {
    expect((await request(start().app).get("/api/runs/run_missing")).status).toBe(404);
  });
});

async function uploadAndFinishById(app: TestApp, runId: string) {
  let run = (await request(app).get(`/api/runs/${runId}`)).body;
  for (let i = 0; i < 50 && run.status !== "COMPLETED"; i++) {
    await new Promise((r) => setTimeout(r, 20));
    run = (await request(app).get(`/api/runs/${runId}`)).body;
  }
  return run;
}

describe("GET /api/runs/:id/document", () => {
  const pdf = Buffer.from("%PDF-1.4 original bytes");

  it("returns the original uploaded file inline with its MIME type", async () => {
    const { app } = start();
    const { runId } = (await upload(app, "invoice.pdf", "application/pdf", pdf)).body;
    const res = await request(app).get(`/api/runs/${runId}/document`).buffer(true).parse(binary);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toBe('inline; filename="invoice.pdf"');
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect((res.body as Buffer).equals(pdf)).toBe(true);
  });

  it("returns 404 RUN_NOT_FOUND for an unknown run, including path-like ids", async () => {
    const { app } = start();
    for (const id of ["run_missing", "..%2F..%2F.env"]) {
      const res = await request(app).get(`/api/runs/${id}/document`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("RUN_NOT_FOUND");
    }
  });

  it("returns 404 DOCUMENT_MISSING when the stored file was deleted", async () => {
    const { app, db } = start();
    const { runId } = (await upload(app, "invoice.pdf", "application/pdf", pdf)).body;
    unlinkSync(db.select().from(documents).get()!.storagePath);
    const res = await request(app).get(`/api/runs/${runId}/document`);
    expect(res.status).toBe(404);
    expect(apiErrorSchema.parse(res.body).error.code).toBe("DOCUMENT_MISSING");
  });
});

describe("DELETE /api/runs/:id", () => {
  it("deletes a completed run and removes it from every read path", async () => {
    const { app, db } = start();
    const run = await uploadAndFinish(app);
    const { storagePath } = db.select().from(documents).get()!;

    const res = await request(app).delete(`/api/runs/${run.id}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ deleted: true, runId: run.id, fileDeleted: true });
    expect(existsSync(storagePath)).toBe(false);
    expect((await request(app).get("/api/runs")).body).toEqual([]);
    expect((await request(app).get(`/api/runs/${run.id}`)).status).toBe(404);
    expect((await request(app).get(`/api/runs/${run.id}/document`)).status).toBe(404);
    const counts = executeReadOnly(
      db,
      "SELECT (SELECT COUNT(*) FROM pipeline_runs) AS runs, (SELECT COUNT(*) FROM extractions) AS extractions, (SELECT COUNT(*) FROM customers) AS customers, (SELECT COUNT(*) FROM customer_rules) AS rules",
    );
    expect(counts.rows).toEqual([{ runs: 0, extractions: 0, customers: 1, rules: 5 }]);
  });

  it("returns a structured 404 for an unknown run", async () => {
    const res = await request(start().app).delete("/api/runs/run_missing");
    expect(res.status).toBe(404);
    expect(apiErrorSchema.parse(res.body).error.code).toBe("RUN_NOT_FOUND");
  });

  it("returns 409 while the run is still processing", async () => {
    const { app, db } = start();
    const run = await uploadAndFinish(app);
    db.$client.prepare("UPDATE pipeline_runs SET status = 'PROCESSING'").run();
    const res = await request(app).delete(`/api/runs/${run.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("RUN_IN_PROGRESS");
  });

  it("accepts the exact same file again after deletion as a fresh run", async () => {
    const { app } = start();
    const first = await uploadAndFinish(app);
    await request(app).delete(`/api/runs/${first.id}`);

    const second = await uploadAndFinish(app);

    expect(second.id).not.toBe(first.id);
    expect(second.status).toBe("COMPLETED");
    expect(second.attempts).toHaveLength(1);
    expect(second.decision.decision).toBe("auto_approve");
    const ids = (await request(app).get("/api/runs")).body.map((r: { id: string }) => r.id);
    expect(ids).toEqual([second.id]);
  });
});

describe("POST /api/query", () => {
  it("rejects an empty question and reports when no model is configured", async () => {
    const { app } = start();
    const ask = (question: string) => request(app).post("/api/query").send({ question });
    expect((await ask("")).status).toBe(400);
    const res = await ask("How many shipments were flagged?");
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("QUERY_UNAVAILABLE");
  });

  it("returns a structured 400 for malformed JSON", async () => {
    const res = await request(start().app)
      .post("/api/query")
      .set("Content-Type", "application/json")
      .send("{not json");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_JSON");
  });
});
