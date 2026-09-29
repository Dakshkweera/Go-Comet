import { describe, expect, it } from "vitest";
import type { ExtractionResult, RouterInput, ValidationResult } from "@nova/contracts";
import { createRouter } from "../src/index.js";

const router = createRouter({ minConfidence: 0.8 });

const text = (value: string | null, confidence = 0.95) => ({
  value,
  confidence,
  evidence: value ? `FIELD: ${value}` : null,
});

const extraction: ExtractionResult = {
  consignee_name: text("Bata India"),
  hs_code: text("640399"),
  port_of_loading: text("Shanghai"),
  port_of_discharge: text("Chennai"),
  incoterms: text("FOB"),
  description_of_goods: text("Leather footwear"),
  gross_weight: { value: 1200, unit: "kg", confidence: 0.94, evidence: "GROSS WEIGHT: 1200 KG" },
  invoice_number: text("INV-2026-1042"),
};

const v = (
  field: ValidationResult["field"],
  status: ValidationResult["status"],
): ValidationResult => ({
  field,
  status,
  foundText: field === "gross_weight" ? null : "Chennai",
  foundNumber: field === "gross_weight" ? 1200 : null,
  expectedText: field === "gross_weight" ? null : "Mumbai",
  expectedNumber: null,
  expectedMin: null,
  expectedMax: field === "gross_weight" ? 1000 : null,
  unit: field === "gross_weight" ? "kg" : null,
  confidence: 0.95,
  ruleId: `rule_${field}`,
  ruleOperator: field === "gross_weight" ? "MAX" : "EXACT",
  reason: `${field} ${status}`,
});

const input = (overrides: Partial<RouterInput> = {}): RouterInput => ({
  runId: "run_1",
  customerResolution: {
    status: "resolved",
    customerId: "cust_bata_india",
    customerName: "Bata India",
    reason: "Unique match.",
  },
  rulesAvailable: true,
  extraction,
  validations: [v("hs_code", "match"), v("incoterms", "match")],
  pipelineErrors: [],
  ...overrides,
});

describe("router decision matrix", () => {
  it.each([
    ["all rules match", input(), "auto_approve"],
    [
      "one confident mismatch",
      input({ validations: [v("hs_code", "match"), v("port_of_discharge", "mismatch")] }),
      "amendment_request",
    ],
    ["uncertain validation", input({ validations: [v("hs_code", "uncertain")] }), "human_review"],
    [
      "mismatch + uncertainty",
      input({ validations: [v("port_of_discharge", "mismatch"), v("gross_weight", "uncertain")] }),
      "human_review",
    ],
    [
      "customer not found",
      input({
        customerResolution: {
          status: "not_found",
          customerId: null,
          customerName: null,
          reason: "No match.",
        },
      }),
      "human_review",
    ],
    [
      "ambiguous customer",
      input({
        customerResolution: {
          status: "ambiguous",
          customerId: null,
          customerName: null,
          reason: "Two matches.",
        },
      }),
      "human_review",
    ],
    ["no rules configured", input({ rulesAvailable: false, validations: [] }), "human_review"],
    [
      "required field without a rule is missing",
      input({ extraction: { ...extraction, invoice_number: text(null, 0.1) } }),
      "human_review",
    ],
    [
      "extraction failed after retries",
      input({
        extraction: null,
        pipelineErrors: [
          { code: "MODEL_TIMEOUT", message: "Model timed out.", retryable: true, attempt: 3 },
        ],
      }),
      "human_review",
    ],
  ] as const)("%s → %s", (_label, i, expected) => {
    expect(router.decide(i).decision).toBe(expected);
  });

  it("consolidates multiple mismatches into one amendment with found vs expected", () => {
    const decision = router.decide(
      input({ validations: [v("port_of_discharge", "mismatch"), v("gross_weight", "mismatch")] }),
    );
    expect(decision.discrepancies).toEqual([
      {
        field: "port_of_discharge",
        found: "Chennai",
        expected: "Mumbai",
        reason: "port_of_discharge mismatch",
      },
      {
        field: "gross_weight",
        found: "1200 kg",
        expected: "<= 1000 kg",
        reason: "gross_weight mismatch",
      },
    ]);
    expect(decision.amendmentDraft).toContain("Invoice INV-2026-1042 requires amendment");
    expect(decision.amendmentDraft).toContain("Expected: <= 1000 kg");
  });

  it("lists fields that had no rule in the approval reasoning", () => {
    expect(router.decide(input()).reasoning).toContain(
      "Not validated (no customer rule): consignee name",
    );
  });

  it("explains which fields blocked approval", () => {
    const decision = router.decide(
      input({ extraction: { ...extraction, hs_code: text("640399", 0.4) } }),
    );
    expect(decision.reasoning).toContain("hs code (low extraction confidence");
  });
});
