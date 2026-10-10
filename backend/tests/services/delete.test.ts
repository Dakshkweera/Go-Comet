import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createDb,
  customerRules,
  customers,
  documents,
  pipelineRuns,
  seedDb,
  type NovaDb,
} from "../../src/db/index.js";
import { createFakeExtractor } from "../../src/services/extraction/index.js";
import { createRouter } from "../../src/services/routing/index.js";
import { createValidator } from "../../src/services/validation/index.js";
import { createPipeline } from "../../src/services/pipeline.service.js";
import { createRun, deleteRun, getRun, listRuns } from "../../src/services/run.service.js";

let db: NovaDb;
let uploadDir: string;
const pdf = Buffer.from("%PDF-1.4 same bytes every time");

beforeEach(() => {
  db = createDb(":memory:");
  seedDb(db);
  uploadDir = mkdtempSync(join(tmpdir(), "nova-delete-"));
});

afterEach(() => {
  db.$client.close();
  rmSync(uploadDir, { recursive: true, force: true });
});

async function processedRun() {
  const created = await createRun(db, uploadDir, {
    buffer: pdf,
    filename: "invoice.pdf",
    mimeType: "application/pdf",
  });
  await createPipeline({
    db,
    extractor: createFakeExtractor(),
    validator: createValidator({ minConfidence: 0.8 }),
    router: createRouter({ minConfidence: 0.8 }),
    minConfidence: 0.8,
    maxAttempts: 3,
    retryDelayMs: 0,
  }).run(created.runId);
  const run = getRun(db, created.runId, 0.8)!;
  const { documentId } = db
    .select({ documentId: pipelineRuns.documentId })
    .from(pipelineRuns)
    .where(eq(pipelineRuns.id, created.runId))
    .get()!;
  const doc = db.select().from(documents).where(eq(documents.id, documentId)).get()!;
  return { ...created, run, doc };
}

const count = (table: string) =>
  (db.$client.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

describe("deleteRun", () => {
  it("removes the run, its document, every child record and the stored file", async () => {
    const { runId, doc } = await processedRun();
    expect(existsSync(doc.storagePath)).toBe(true);
    expect(count("extractions")).toBe(8);
    expect(count("decisions")).toBe(1);

    const result = await deleteRun(db, uploadDir, runId);

    expect(result).toEqual({ status: "deleted", runId, documentId: doc.id, fileDeleted: true });
    for (const table of [
      "pipeline_runs",
      "documents",
      "extractions",
      "validation_results",
      "decisions",
      "pipeline_stage_runs",
    ]) {
      expect(count(table)).toBe(0);
    }
    expect(existsSync(doc.storagePath)).toBe(false);
  });

  it("keeps customer configuration and rules untouched", async () => {
    const before = {
      customers: db.select().from(customers).all(),
      rules: db.select().from(customerRules).all(),
    };
    const { runId } = await processedRun();
    await deleteRun(db, uploadDir, runId);
    expect(db.select().from(customers).all()).toEqual(before.customers);
    expect(db.select().from(customerRules).all()).toEqual(before.rules);
    expect(before.rules).toHaveLength(5);
  });

  it("only affects the deleted run", async () => {
    const keep = await processedRun();
    const remove = await processedRun();
    await deleteRun(db, uploadDir, remove.runId);
    expect(listRuns(db).map((r) => r.id)).toEqual([keep.runId]);
    expect(getRun(db, keep.runId, 0.8)?.decision?.decision).toBe("auto_approve");
    expect(existsSync(keep.doc.storagePath)).toBe(true);
    expect(count("extractions")).toBe(8);
  });

  it("returns not_found for an unknown run", async () => {
    expect(await deleteRun(db, uploadDir, "run_missing")).toEqual({ status: "not_found" });
  });

  it("refuses to delete a run that is still processing", async () => {
    const { runId } = await createRun(db, uploadDir, {
      buffer: pdf,
      filename: "invoice.pdf",
      mimeType: "application/pdf",
    });
    expect(await deleteRun(db, uploadDir, runId)).toEqual({ status: "in_progress" });
    expect(count("pipeline_runs")).toBe(1);
  });

  it("never deletes a file outside the upload directory", async () => {
    const { runId, doc } = await processedRun();
    const outside = join(mkdtempSync(join(tmpdir(), "nova-outside-")), "keep.pdf");
    writeFileSync(outside, "do not delete");
    db.$client.prepare("UPDATE documents SET storage_path = ? WHERE id = ?").run(outside, doc.id);

    const result = await deleteRun(db, uploadDir, runId);

    expect(result).toMatchObject({ status: "deleted", fileDeleted: false });
    expect(existsSync(outside)).toBe(true);
    expect(count("documents")).toBe(0);
    rmSync(outside, { force: true });
  });

  it("lets the same file be uploaded again as a fresh run", async () => {
    const first = await processedRun();
    await deleteRun(db, uploadDir, first.runId);
    const second = await processedRun();
    expect(second.runId).not.toBe(first.runId);
    expect(second.duplicateOfRunId).toBeNull();
    expect(second.run.attempts).toHaveLength(1);
    expect(second.run.decision?.decision).toBe("auto_approve");
  });
});
