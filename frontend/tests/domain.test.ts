import { describe, expect, it } from "vitest";
import type { RunView } from "../src/api.js";
import { issueSummary, pipelineSteps, runIssues, timeAgo, toRecord } from "../src/domain.js";
import { matchPath } from "../src/router.js";

const field = (value: string, extra: Record<string, unknown> = {}) => ({
  value,
  confidence: 1,
  evidence: value,
  candidates: null,
  evidenceStatus: "supported" as const,
  ...extra,
});

const validation = (fieldName: string, status: "match" | "mismatch" | "uncertain") => ({
  field: fieldName,
  status,
  foundText: "x",
  foundNumber: null,
  expectedText: "x",
  expectedNumber: null,
  expectedMin: null,
  expectedMax: null,
  unit: null,
  confidence: 1,
  ruleId: `rule_${fieldName}`,
  ruleOperator: "EXACT",
  reason: status === "match" ? "Extracted value matches the customer rule." : `${status} reason`,
});

const RELIABLE = { reliable: true, reasons: [] };

function makeRun(overrides: Partial<RunView> = {}): RunView {
  return {
    id: "run_1",
    status: "COMPLETED",
    currentStage: "COMPLETED",
    createdAt: "2026-09-29T21:44:55.668Z",
    completedAt: "2026-09-29T21:45:09.576Z",
    document: { filename: "messy-invoice.pdf", mimeType: "application/pdf", size: 18904 },
    extraction: {
      consignee_name: field("Bata India Limited"),
      hs_code: field("6403.29", { confidence: 0.3, evidenceStatus: "ambiguous" }),
      port_of_loading: field("Shanghai"),
      port_of_discharge: field("Mumbai"),
      incoterms: field("FOB"),
      description_of_goods: field("Leather footwear"),
      gross_weight: {
        value: 900,
        unit: "KG",
        confidence: 0.5,
        evidence: "GROSS WEIGHT: 900 KG",
        candidates: [900, 1500],
        evidenceStatus: "supported",
      },
      invoice_number: field("INV-2026-1044"),
    },
    reliability: {
      minConfidence: 0.8,
      fields: {
        consignee_name: RELIABLE,
        hs_code: {
          reliable: false,
          reasons: [
            "low extraction confidence (0.30 < 0.8)",
            "the document text for this field is ambiguous",
          ],
        },
        port_of_loading: RELIABLE,
        port_of_discharge: RELIABLE,
        incoterms: RELIABLE,
        description_of_goods: RELIABLE,
        gross_weight: {
          reliable: false,
          reasons: [
            "low extraction confidence (0.50 < 0.8)",
            "conflicting values in the document (900, 1500)",
          ],
        },
        invoice_number: RELIABLE,
      },
    },
    customer: { status: "resolved", name: "Bata India", reason: "matched" },
    rules: [],
    validations: [
      validation("hs_code", "uncertain"),
      validation("port_of_loading", "match"),
      validation("port_of_discharge", "match"),
      validation("incoterms", "match"),
      validation("gross_weight", "uncertain"),
    ],
    decision: {
      decision: "human_review",
      reasoning: "Automatic compliance could not be established.",
      discrepancies: [],
      amendmentDraft: null,
    },
    error: null,
    attempts: [{ stage: "EXTRACTING", attempt: 1, status: "succeeded", errorMessage: null }],
    ...overrides,
  } as RunView;
}

describe("runIssues", () => {
  it("explains a human review with the router's reliability reasons", () => {
    const issues = runIssues(makeRun());
    expect(issues.map((i) => i.field)).toEqual(["hs_code", "gross_weight"]);
    expect(issues[0]!.reasons).toContain("the document text for this field is ambiguous");
    expect(issues[1]!.reasons.join(" ")).toContain(
      "conflicting values in the document (900, 1500)",
    );
    expect(issueSummary(makeRun(), "human_review")).toBe("2 fields uncertain");
  });

  it("lists discrepancies for an amendment request", () => {
    const run = makeRun({
      decision: {
        decision: "amendment_request",
        reasoning: "",
        discrepancies: [
          { field: "incoterms", found: "CIF", expected: "FOB", reason: "Found CIF, expected FOB." },
        ],
        amendmentDraft: "Invoice requires amendment.",
      },
    });
    expect(runIssues(run)).toMatchObject([
      { kind: "mismatch", field: "incoterms", found: "CIF", expected: "FOB" },
    ]);
    expect(issueSummary(run, "amendment_request")).toBe("1 rule mismatched");
  });

  it("reports an unresolved customer before field issues", () => {
    const run = makeRun({
      customer: { status: "not_found", name: null, reason: 'No configured customer matches "X".' },
      validations: [],
    });
    expect(runIssues(run)).toMatchObject([{ kind: "customer", title: "Customer not identified" }]);
  });

  it("reports extraction failures", () => {
    const run = makeRun({
      extraction: null,
      customer: null,
      validations: [],
      error: { code: "EXTRACTION_FAILED", message: "Model timed out" },
    });
    expect(runIssues(run)).toMatchObject([{ kind: "error", reasons: ["Model timed out"] }]);
  });

  it("has no issues for an auto-approved run", () => {
    const run = makeRun({
      decision: {
        decision: "auto_approve",
        reasoning: "",
        discrepancies: [],
        amendmentDraft: null,
      },
    });
    expect(runIssues(run)).toEqual([]);
  });
});

describe("pipelineSteps", () => {
  it("summarises a completed human review run", () => {
    expect(pipelineSteps(makeRun()).map((s) => [s.key, s.state, s.detail])).toEqual([
      ["extract", "done", "8 of 8 fields"],
      ["customer", "done", "Bata India"],
      ["validate", "warning", "2 uncertain"],
      ["decide", "warning", "Human review"],
    ]);
  });

  it("follows the persisted stage while processing", () => {
    const extracting = makeRun({
      status: "PROCESSING",
      currentStage: "EXTRACTING",
      decision: null,
    });
    expect(pipelineSteps(extracting).map((s) => s.state)).toEqual([
      "active",
      "pending",
      "pending",
      "pending",
    ]);
    const extracted = makeRun({ status: "PROCESSING", currentStage: "EXTRACTED", decision: null });
    expect(pipelineSteps(extracted).map((s) => s.state)).toEqual([
      "done",
      "active",
      "pending",
      "pending",
    ]);
  });

  it("marks skipped validation when the customer is unknown", () => {
    const run = makeRun({
      customer: { status: "not_found", name: null, reason: "none" },
      validations: [],
    });
    const [, customer, validate] = pipelineSteps(run);
    expect(customer).toMatchObject({ state: "warning", detail: "Not found" });
    expect(validate).toMatchObject({ state: "skipped", detail: "No rules applied" });
  });
});

describe("toRecord", () => {
  it("derives table columns from the run detail", () => {
    const summary = {
      id: "run_1",
      filename: "messy-invoice.pdf",
      status: "COMPLETED",
      decision: "human_review",
      createdAt: "2026-09-29T21:44:55.668Z",
    };
    expect(toRecord(summary, makeRun())).toMatchObject({
      customer: "Bata India",
      invoice: "INV-2026-1044",
      origin: "Shanghai",
      destination: "Mumbai",
    });
    expect(toRecord(summary, null)).toMatchObject({ customer: null, invoice: null });
  });
});

describe("timeAgo", () => {
  const now = Date.parse("2026-09-30T12:00:00.000Z");
  it("formats relative times", () => {
    expect(timeAgo("2026-09-30T11:59:50.000Z", now)).toBe("just now");
    expect(timeAgo("2026-09-30T11:58:00.000Z", now)).toBe("2 min ago");
    expect(timeAgo("2026-09-30T09:00:00.000Z", now)).toBe("3 h ago");
    expect(timeAgo(null, now)).toBe("—");
  });
});

describe("matchPath", () => {
  it("extracts route params", () => {
    expect(matchPath("/documents/:id", "/documents/run_abc")).toEqual({ id: "run_abc" });
    expect(matchPath("/documents/:id", "/documents")).toBeNull();
    expect(matchPath("/documents", "/exceptions")).toBeNull();
  });
});
