import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExtractionResult, ExtractorAgent } from "../../contracts/src/index.js";
import { createDb, seedDb, type NovaDb } from "../../db/src/index.js";
import {
  createExtractor,
  createFakeExtractor,
  FAKE_EXTRACTION,
} from "../../extraction/src/index.js";
import { LlmError } from "../../llm/src/index.js";
import { createRouter } from "../../routing/src/index.js";
import { createValidator } from "../../validation/src/index.js";
import { createPipeline, createRun, getRun, normalizeCustomerName } from "../src/index.js";

let db: NovaDb;
let uploadDir: string;

beforeEach(() => {
  db = createDb(":memory:");
  seedDb(db);
  uploadDir = mkdtempSync(join(tmpdir(), "nova-uploads-"));
});

afterEach(() => {
  db.$client.close();
  rmSync(uploadDir, { recursive: true, force: true });
});

function pipelineWith(extractor: ExtractorAgent) {
  return createPipeline({
    db,
    extractor,
    validator: createValidator({ minConfidence: 0.8 }),
    router: createRouter({ minConfidence: 0.8 }),
    minConfidence: 0.8,
    maxAttempts: 3,
    retryDelayMs: 0,
  });
}

async function process(extraction: Partial<ExtractionResult> | ExtractorAgent) {
  const extractor =
    "extract" in extraction
      ? (extraction as ExtractorAgent)
      : createFakeExtractor({ ...FAKE_EXTRACTION, ...extraction });
  const { runId } = await createRun(db, uploadDir, {
    buffer: Buffer.from("%PDF-1.4 test"),
    filename: "invoice.pdf",
    mimeType: "application/pdf",
  });
  await pipelineWith(extractor).run(runId);
  return getRun(db, runId, 0.8)!;
}

const field = (value: string | null, confidence = 0.95) => ({
  value,
  confidence,
  evidence: value,
});

describe("pipeline end to end", () => {
  it("auto-approves a clean compliant document and persists everything", async () => {
    const run = await process({});
    expect(run.status).toBe("COMPLETED");
    expect(run.customer).toMatchObject({ status: "resolved", name: "Bata India" });
    expect(run.validations).toHaveLength(5);
    expect(run.validations.every((v) => v.status === "match")).toBe(true);
    expect(run.decision?.decision).toBe("auto_approve");
  });

  it("requests an amendment for a confident mismatch", async () => {
    const run = await process({
      gross_weight: { value: 1200, unit: "kg", confidence: 0.95, evidence: "1200 KG" },
    });
    expect(run.decision?.decision).toBe("amendment_request");
    expect(run.decision?.discrepancies[0]).toMatchObject({
      field: "gross_weight",
      found: "1200 kg",
      expected: "<= 1000 kg",
    });
  });

  it("sends low-confidence extraction to human review", async () => {
    const run = await process({ hs_code: field("6403?9", 0.42) });
    expect(run.decision?.decision).toBe("human_review");
    expect(run.validations.find((v) => v.field === "hs_code")?.status).toBe("uncertain");
  });

  it("persists known mismatches on a human review caused by uncertainty", async () => {
    const run = await process({
      hs_code: field("6403?9", 0.42),
      port_of_discharge: field("Chennai"),
    });
    expect(run.decision?.decision).toBe("human_review");
    expect(run.decision?.discrepancies).toEqual([
      {
        field: "port_of_discharge",
        found: "Chennai",
        expected: "Mumbai",
        reason: 'Found "Chennai", expected "Mumbai".',
      },
    ]);
    expect(run.decision?.amendmentDraft).toBeNull();
  });

  it("reports reliability with the threshold snapshotted at decision time", async () => {
    const run = await process({ invoice_number: field("INV-2026-1042", 0.85) });
    expect(run.decision?.decision).toBe("auto_approve");

    const later = getRun(db, run.id, 0.9)!;
    expect(later.reliability?.minConfidence).toBe(0.8);
    expect(later.reliability?.fields.invoice_number.reliable).toBe(true);
  });

  it("does not guess rules for an unknown customer", async () => {
    const run = await process({ consignee_name: field("Unknown Trading Co.") });
    expect(run.customer?.status).toBe("not_found");
    expect(run.validations).toEqual([]);
    expect(run.decision?.decision).toBe("human_review");
  });

  it("stops after bounded retries and routes to human review", async () => {
    let calls = 0;
    const run = await process({
      extract: async () => {
        calls++;
        throw new LlmError("MODEL_TIMEOUT", "Model request timed out.", true);
      },
    });
    expect(calls).toBe(3);
    expect(run.attempts.map((a) => a.status)).toEqual(["failed", "failed", "failed"]);
    expect(run.error?.code).toBe("MODEL_TIMEOUT");
    expect(run.decision?.decision).toBe("human_review");
  });

  it("does not retry non-retryable errors", async () => {
    let calls = 0;
    await process({
      extract: async () => {
        calls++;
        throw new LlmError("MODEL_HTTP_401", "Unauthorized.", false);
      },
    });
    expect(calls).toBe(1);
  });

  it("resumes after a crash without repeating extraction", async () => {
    let calls = 0;
    const counting: ExtractorAgent = {
      extract: async () => {
        calls++;
        return FAKE_EXTRACTION;
      },
    };
    const { runId } = await createRun(db, uploadDir, {
      buffer: Buffer.from("%PDF-1.4 test"),
      filename: "invoice.pdf",
      mimeType: "application/pdf",
    });
    await pipelineWith(counting).run(runId);
    db.$client.prepare("DELETE FROM decisions").run();
    db.$client
      .prepare("UPDATE pipeline_runs SET status = 'PROCESSING', current_stage = 'EXTRACTED'")
      .run();

    const restarted = pipelineWith(counting);
    expect(restarted.pendingRunIds()).toEqual([runId]);
    await restarted.run(runId);
    expect(calls).toBe(1);
    expect(getRun(db, runId, 0.8)?.decision?.decision).toBe("auto_approve");
  });

  it("closes an attempt interrupted by a crash before retrying", async () => {
    const { runId } = await createRun(db, uploadDir, {
      buffer: Buffer.from("%PDF-1.4 test"),
      filename: "invoice.pdf",
      mimeType: "application/pdf",
    });
    db.$client
      .prepare(
        "INSERT INTO pipeline_stage_runs (id, run_id, stage, attempt, status, started_at) VALUES ('stage_x', ?, 'EXTRACTING', 1, 'running', ?)",
      )
      .run(runId, new Date().toISOString());
    db.$client
      .prepare(
        "UPDATE pipeline_runs SET status = 'PROCESSING', current_stage = 'EXTRACTING', attempt_count = 1",
      )
      .run();

    await pipelineWith(createFakeExtractor()).run(runId);
    const run = getRun(db, runId, 0.8)!;
    expect(run.attempts.map((a) => [a.attempt, a.status])).toEqual([
      [1, "failed"],
      [2, "succeeded"],
    ]);
    expect(run.attempts[0]?.errorMessage).toMatch(/stopped before this attempt finished/);
    expect(run.decision?.decision).toBe("auto_approve");
  });

  it("marks the run FAILED with a structured error when no decision can be persisted", async () => {
    const { runId } = await createRun(db, uploadDir, {
      buffer: Buffer.from("%PDF-1.4 test"),
      filename: "invoice.pdf",
      mimeType: "application/pdf",
    });
    const pipeline = createPipeline({
      db,
      extractor: createFakeExtractor(),
      validator: createValidator({ minConfidence: 0.8 }),
      router: {
        decide: () => {
          throw new Error("router crashed");
        },
      },
      minConfidence: 0.8,
      maxAttempts: 3,
    });
    await expect(pipeline.run(runId)).rejects.toThrow("router crashed");
    const run = getRun(db, runId, 0.8)!;
    expect(run).toMatchObject({
      status: "FAILED",
      decision: null,
      error: { code: "PIPELINE_ERROR", message: "router crashed" },
    });
    expect(run.extraction).not.toBeNull();
    expect(pipeline.pendingRunIds()).toEqual([]);
  });

  it("exposes the per-field reliability behind the decision, including fields without a rule", async () => {
    const run = await process({ invoice_number: field("INV-2026-1042", 0.6) });
    expect(run.decision?.decision).toBe("human_review");
    expect(run.validations.some((v) => v.field === "invoice_number")).toBe(false);
    expect(run.reliability?.minConfidence).toBe(0.8);
    expect(run.reliability?.fields.invoice_number).toEqual({
      reliable: false,
      reasons: ["low extraction confidence (0.60 < 0.8)"],
    });
    expect(run.reliability?.fields.hs_code.reliable).toBe(true);
  });
});

describe("normalizeCustomerName", () => {
  it("strips case, punctuation and legal suffixes", () => {
    expect(normalizeCustomerName("BATA INDIA PVT. LTD.")).toBe("bata india");
    expect(normalizeCustomerName("Bata International")).toBe("bata international");
    expect(normalizeCustomerName("Bata India Limited, Kolkata, India")).toBe("bata india");
  });
});

const recorded = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`../../extraction/tests/fixtures/${name}.json`, import.meta.url), "utf8"),
  );
const samplePdf = (name: string) =>
  readFileSync(new URL(`../../../samples/${name}-invoice.pdf`, import.meta.url));

async function runDocument(buffer: Uint8Array, response: unknown) {
  let modelCalls = 0;
  const extractor = createExtractor({
    llm: {
      chatJson: async () => {
        modelCalls++;
        return response;
      },
    },
    model: "m",
  });
  const { runId } = await createRun(db, uploadDir, {
    buffer: Buffer.from(buffer),
    filename: "doc.pdf",
    mimeType: "application/pdf",
  });
  await pipelineWith(extractor).run(runId);
  const run = getRun(db, runId, 0.8)!;
  const validation = Object.fromEntries(run.validations.map((v) => [v.field, v.status]));
  return { run, validation, modelCalls };
}

async function imageOnlyPdf() {
  const pdf = await PDFDocument.create();
  pdf.addPage([595, 842]);
  return pdf.save();
}

describe("sample regressions with recorded Gemini output", () => {
  it("9. clean invoice is still auto-approved, every field SUPPORTED", async () => {
    const { run } = await runDocument(samplePdf("clean"), recorded("gemini-clean"));
    expect(run.decision?.decision).toBe("auto_approve");
    const statuses = Object.values(run.extraction!).map((f) => f.evidenceStatus);
    expect(new Set(statuses)).toEqual(new Set(["supported"]));
    expect(run.decision?.reasoning).not.toContain("Not independently verified");
  });

  it("10. mismatch invoice still requests one amendment listing all 3 discrepancies", async () => {
    const { run } = await runDocument(samplePdf("mismatch"), recorded("gemini-mismatch"));
    expect(run.decision?.decision).toBe("amendment_request");
    expect(run.decision?.discrepancies.map((d) => d.field)).toEqual([
      "port_of_discharge",
      "incoterms",
      "gross_weight",
    ]);
    expect(run.decision?.amendmentDraft).toContain("Expected: <= 1000 kg");
  });

  it("11. messy invoice goes to human review because of real evidence problems", async () => {
    const { run, validation, modelCalls } = await runDocument(
      samplePdf("messy"),
      recorded("gemini-messy-candidates-objects"),
    );
    expect(modelCalls).toBe(1);
    expect(run.error).toBeNull();
    expect(run.extraction?.hs_code).toMatchObject({
      value: "6403.29",
      evidenceStatus: "ambiguous",
    });
    expect(validation).toMatchObject({ hs_code: "uncertain", gross_weight: "uncertain" });
    expect(run.decision?.decision).toBe("human_review");
    expect(run.decision?.reasoning).toContain("the document text for this field is ambiguous");
    expect(run.decision?.reasoning).toContain("conflicting values in the document (900, 1500)");
  });

  it("2. a contradicted HS code is never silently auto-approved", async () => {
    const response = recorded("gemini-clean");
    response.hs_code = { ...response.hs_code, value: "6403.29", evidence: "6403.29" };
    const { run, validation } = await runDocument(samplePdf("clean"), response);
    expect(run.extraction?.hs_code.evidenceStatus).toBe("contradicted");
    expect(validation.hs_code).toBe("uncertain");
    expect(run.decision?.decision).toBe("human_review");
    expect(run.decision?.reasoning).toContain("the document text contradicts the extracted value");
  });

  it("6. a corrupt PDF skips the model call and goes to human review", async () => {
    const { run, modelCalls } = await runDocument(
      Buffer.from("%PDF-1.4 broken"),
      recorded("gemini-clean"),
    );
    expect(modelCalls).toBe(0);
    expect(run.attempts).toHaveLength(1);
    expect(run.error?.code).toBe("DOCUMENT_READ_ERROR");
    expect(run.decision?.decision).toBe("human_review");
  });

  it("4/8. scanned PDF: values stay UNVERIFIED and the reasoning says so (limitation: no OCR)", async () => {
    const correct = await runDocument(await imageOnlyPdf(), recorded("gemini-clean"));
    expect(correct.run.decision?.decision).toBe("auto_approve");
    expect(correct.run.extraction?.hs_code).toMatchObject({
      evidenceStatus: "unverified",
      confidence: 0.891,
    });
    expect(correct.run.decision?.reasoning).toContain(
      "No field could be independently verified against the document text",
    );

    const wrong = recorded("gemini-clean");
    wrong.hs_code = { ...wrong.hs_code, value: "6403.29", evidence: "HS CODE: 6403.29" };
    const misread = await runDocument(await imageOnlyPdf(), wrong);
    expect(misread.run.extraction?.hs_code.evidenceStatus).toBe("unverified");
    expect(misread.run.decision?.decision).toBe("amendment_request");
    expect(misread.run.decision?.reasoning).toContain("No field could be independently verified");
  });
});
