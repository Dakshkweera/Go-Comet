import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExtractionResult, ExtractorAgent } from "@nova/contracts";
import { createDb, seedDb, type NovaDb } from "@nova/db";
import { createExtractor, createFakeExtractor, FAKE_EXTRACTION } from "@nova/extraction";
import { LlmError } from "@nova/llm";
import { createRouter } from "@nova/routing";
import { createValidator } from "@nova/validation";
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
  return getRun(db, runId)!;
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

  it("does not guess rules for an unknown customer", async () => {
    const run = await process({ consignee_name: field("Unknown Trading Co.") });
    expect(run.customer?.status).toBe("not_found");
    expect(run.validations).toEqual([]);
    expect(run.decision?.decision).toBe("human_review");
  });

  it("routes the real messy Gemini response to human review for the right reasons", async () => {
    const response = JSON.parse(
      readFileSync(
        new URL(
          "../../extraction/tests/fixtures/gemini-messy-candidates-objects.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const extractor = createExtractor({ llm: { chatJson: async () => response }, model: "m" });
    const { runId } = await createRun(db, uploadDir, {
      buffer: readFileSync(new URL("../../../samples/messy-invoice.pdf", import.meta.url)),
      filename: "messy-invoice.pdf",
      mimeType: "application/pdf",
    });
    await pipelineWith(extractor).run(runId);
    const run = getRun(db, runId)!;

    expect(run.attempts).toHaveLength(1);
    expect(run.extraction?.hs_code.value).toBe("6403.29");
    const status = Object.fromEntries(run.validations.map((v) => [v.field, v.status]));
    expect(status).toMatchObject({
      hs_code: "uncertain",
      gross_weight: "uncertain",
      port_of_discharge: "match",
    });
    expect(run.decision?.decision).toBe("human_review");
    expect(run.decision?.reasoning).toContain("hs code (low extraction confidence");
    expect(run.decision?.reasoning).toContain("conflicting values in the document (900, 1500)");
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
    expect(getRun(db, runId)?.decision?.decision).toBe("auto_approve");
  });
});

describe("normalizeCustomerName", () => {
  it("strips case, punctuation and legal suffixes", () => {
    expect(normalizeCustomerName("BATA INDIA PVT. LTD.")).toBe("bata india");
    expect(normalizeCustomerName("Bata International")).toBe("bata international");
    expect(normalizeCustomerName("Bata India Limited, Kolkata, India")).toBe("bata india");
  });
});
