import { describe, expect, it } from "vitest";
import {
  customerResolutionSchema,
  customerRuleSchema,
  extractionResultSchema,
  queryResponseSchema,
  REQUIRED_FIELDS,
  routerDecisionSchema,
  routerInputSchema,
  sqlGenerationResultSchema,
  validationResultSchema,
  type ExtractionResult,
} from "../../src/schemas/index.js";

const text = (value: string | null, confidence = 0.95) => ({
  value,
  confidence,
  evidence: value ? `FIELD: ${value}` : null,
});

const cleanExtraction: ExtractionResult = {
  consignee_name: text("Bata India"),
  hs_code: text("640399"),
  port_of_loading: text("Shanghai"),
  port_of_discharge: text("Mumbai"),
  incoterms: text("FOB"),
  description_of_goods: text("Leather footwear"),
  gross_weight: { value: 900, unit: "kg", confidence: 0.94, evidence: "GROSS WEIGHT: 900 KG" },
  invoice_number: text("INV-2026-1042"),
};

const rule = {
  id: "rule_1",
  customerId: "cust_bata_india",
  field: "gross_weight",
  operator: "MAX",
  expectedValue: null,
  minValue: null,
  maxValue: 1000,
  unit: "kg",
  isActive: true,
};

describe("extractionResultSchema", () => {
  it("accepts a clean extraction and exposes all 8 required fields", () => {
    expect(extractionResultSchema.parse(cleanExtraction)).toEqual(cleanExtraction);
    expect(REQUIRED_FIELDS).toHaveLength(8);
  });

  it("accepts null values and conflicting candidates", () => {
    const messy = {
      ...cleanExtraction,
      hs_code: { value: null, confidence: 0.2, evidence: null },
      gross_weight: { value: 1200, unit: "kg", confidence: 0.6, candidates: [1200, 1500] },
    };
    expect(extractionResultSchema.safeParse(messy).success).toBe(true);
  });

  it.each([
    ["confidence below 0", { ...cleanExtraction, hs_code: text("640399", -0.1) }],
    ["confidence above 1", { ...cleanExtraction, hs_code: text("640399", 1.2) }],
    [
      "non-numeric gross weight",
      { ...cleanExtraction, gross_weight: { value: "900", confidence: 0.9 } },
    ],
    ["missing field", { ...cleanExtraction, invoice_number: undefined }],
  ])("rejects %s", (_label, value) => {
    expect(extractionResultSchema.safeParse(value).success).toBe(false);
  });
});

describe("customerRuleSchema", () => {
  it("accepts a well-formed MAX rule", () => {
    expect(customerRuleSchema.safeParse(rule).success).toBe(true);
  });

  it.each([
    ["EXACT without expected value", { ...rule, operator: "EXACT", maxValue: null }],
    ["MAX without max", { ...rule, maxValue: null }],
    ["MIN without min", { ...rule, operator: "MIN" }],
    ["RANGE with min > max", { ...rule, operator: "RANGE", minValue: 2000 }],
    ["unknown operator", { ...rule, operator: "BETWEEN" }],
    ["unknown field", { ...rule, field: "shoe_size" }],
  ])("rejects %s", (_label, value) => {
    expect(customerRuleSchema.safeParse(value).success).toBe(false);
  });
});

describe("validationResultSchema", () => {
  const mismatch = {
    field: "gross_weight",
    status: "mismatch",
    foundText: null,
    foundNumber: 1200,
    expectedText: null,
    expectedNumber: null,
    expectedMin: null,
    expectedMax: 1000,
    unit: "kg",
    confidence: 0.94,
    ruleId: "rule_1",
    ruleOperator: "MAX",
    reason: "Gross weight exceeds the customer's maximum.",
  };

  it("accepts a mismatch with found, expected and confidence", () => {
    expect(validationResultSchema.safeParse(mismatch).success).toBe(true);
  });

  it("rejects statuses outside match/mismatch/uncertain", () => {
    expect(validationResultSchema.safeParse({ ...mismatch, status: "missing" }).success).toBe(
      false,
    );
  });
});

describe("router contracts", () => {
  it("accepts an amendment decision with discrepancies and a draft", () => {
    const decision = {
      decision: "amendment_request",
      reasoning: "Gross weight mismatched the customer rule.",
      discrepancies: [
        {
          field: "gross_weight",
          found: "1200 kg",
          expected: "<= 1000 kg",
          reason: "Exceeds maximum.",
        },
      ],
      amendmentDraft: "Please correct gross weight.",
    };
    expect(routerDecisionSchema.safeParse(decision).success).toBe(true);
  });

  it("rejects an unknown decision", () => {
    const decision = {
      decision: "reject",
      reasoning: "x",
      discrepancies: [],
      amendmentDraft: null,
    };
    expect(routerDecisionSchema.safeParse(decision).success).toBe(false);
  });

  it("allows a null extraction so extraction failures can be routed", () => {
    const input = {
      runId: "run_1",
      customerResolution: null,
      rulesAvailable: false,
      extraction: null,
      validations: [],
      pipelineErrors: [
        { code: "MODEL_TIMEOUT", message: "Timed out.", retryable: true, attempt: 3 },
      ],
    };
    expect(routerInputSchema.safeParse(input).success).toBe(true);
  });
});

describe("customerResolutionSchema", () => {
  it("rejects an empty reason", () => {
    const value = { status: "not_found", customerId: null, customerName: null, reason: "" };
    expect(customerResolutionSchema.safeParse(value).success).toBe(false);
  });
});

describe("query contracts", () => {
  it("rejects empty SQL", () => {
    expect(sqlGenerationResultSchema.safeParse({ sql: "   " }).success).toBe(false);
  });

  it("accepts a database answer with rows", () => {
    const res = {
      type: "database_query",
      answer: "2 shipments were routed to human review.",
      data: { columns: ["id"], rows: [{ id: "run_1" }, { id: "run_2" }] },
      sql: "SELECT id FROM pipeline_runs",
    };
    expect(queryResponseSchema.safeParse(res).success).toBe(true);
  });
});

describe("evidenceStatus", () => {
  it("accepts the four statuses and rejects anything else", () => {
    const withStatus = (evidenceStatus: string) =>
      extractionResultSchema.safeParse({
        ...cleanExtraction,
        hs_code: { ...cleanExtraction.hs_code, evidenceStatus },
      }).success;
    for (const s of ["supported", "unverified", "ambiguous", "contradicted"]) {
      expect(withStatus(s)).toBe(true);
    }
    expect(withStatus("verified")).toBe(false);
  });
});
