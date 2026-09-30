import { describe, expect, it } from "vitest";
import type { CustomerRule, ExtractionResult } from "@nova/contracts";
import { assessField, createValidator } from "../src/index.js";

const validator = createValidator({ minConfidence: 0.8 });

const text = (value: string | null, confidence = 0.95) => ({
  value,
  confidence,
  evidence: value ? `FIELD: ${value}` : null,
});

const extraction = (overrides: Partial<ExtractionResult> = {}): ExtractionResult => ({
  consignee_name: text("Bata India"),
  hs_code: text("640399"),
  port_of_loading: text("Shanghai"),
  port_of_discharge: text("Mumbai"),
  incoterms: text("FOB"),
  description_of_goods: text("Leather footwear"),
  gross_weight: { value: 900, unit: "kg", confidence: 0.94, evidence: "GROSS WEIGHT: 900 KG" },
  invoice_number: text("INV-2026-1042"),
  ...overrides,
});

const rule = (overrides: Partial<CustomerRule>): CustomerRule => ({
  id: "rule_1",
  customerId: "cust_bata_india",
  field: "incoterms",
  operator: "EXACT",
  expectedValue: "FOB",
  minValue: null,
  maxValue: null,
  unit: null,
  isActive: true,
  ...overrides,
});

const weight = (value: number, unit = "kg") => ({
  gross_weight: { value, unit, confidence: 0.95, evidence: `GROSS WEIGHT: ${value} ${unit}` },
});

function run(r: CustomerRule, e = extraction()) {
  const [result] = validator.validate({
    runId: "run_1",
    extraction: e,
    customer: { id: "cust_bata_india", name: "Bata India" },
    rules: [r],
  });
  return result!;
}

describe("validator rule matrix", () => {
  it.each([
    ["EXACT match", rule({}), extraction(), "match"],
    ["EXACT mismatch", rule({}), extraction({ incoterms: text("CIF") }), "mismatch"],
    [
      "EXACT ignores case/whitespace",
      rule({ field: "port_of_discharge", expectedValue: "Mumbai" }),
      extraction({ port_of_discharge: text("  MUMBAI ") }),
      "match",
    ],
    [
      "HS code ignores dots",
      rule({ field: "hs_code", expectedValue: "640399" }),
      extraction({ hs_code: text("6403.99") }),
      "match",
    ],
    [
      "MAX match",
      rule({
        field: "gross_weight",
        operator: "MAX",
        expectedValue: null,
        maxValue: 1200,
        unit: "kg",
      }),
      extraction(weight(1000)),
      "match",
    ],
    [
      "MAX mismatch",
      rule({
        field: "gross_weight",
        operator: "MAX",
        expectedValue: null,
        maxValue: 1200,
        unit: "kg",
      }),
      extraction(weight(1400)),
      "mismatch",
    ],
    [
      "MIN match",
      rule({
        field: "gross_weight",
        operator: "MIN",
        expectedValue: null,
        minValue: 800,
        unit: "kg",
      }),
      extraction(weight(1000)),
      "match",
    ],
    [
      "MIN mismatch",
      rule({
        field: "gross_weight",
        operator: "MIN",
        expectedValue: null,
        minValue: 800,
        unit: "kg",
      }),
      extraction(weight(700)),
      "mismatch",
    ],
    [
      "RANGE match",
      rule({
        field: "gross_weight",
        operator: "RANGE",
        expectedValue: null,
        minValue: 800,
        maxValue: 1200,
        unit: "kg",
      }),
      extraction(weight(1000)),
      "match",
    ],
    [
      "RANGE mismatch",
      rule({
        field: "gross_weight",
        operator: "RANGE",
        expectedValue: null,
        minValue: 800,
        maxValue: 1200,
        unit: "kg",
      }),
      extraction(weight(1400)),
      "mismatch",
    ],
    [
      "unit conversion (1.1 t <= 1200 kg)",
      rule({
        field: "gross_weight",
        operator: "MAX",
        expectedValue: null,
        maxValue: 1200,
        unit: "kg",
      }),
      extraction(weight(1.1, "t")),
      "match",
    ],
    [
      "unknown unit",
      rule({
        field: "gross_weight",
        operator: "MAX",
        expectedValue: null,
        maxValue: 1200,
        unit: "kg",
      }),
      extraction(weight(1000, "bags")),
      "uncertain",
    ],
    ["missing value", rule({}), extraction({ incoterms: text(null, 0.1) }), "uncertain"],
    ["low confidence", rule({}), extraction({ incoterms: text("FOB", 0.5) }), "uncertain"],
    [
      "conflicting candidates",
      rule({}),
      extraction({ incoterms: { ...text("FOB"), candidates: ["FOB", "CIF"] } }),
      "uncertain",
    ],
    ["misconfigured rule", rule({ expectedValue: null }), extraction(), "uncertain"],
  ] as const)("%s → %s", (_label, r, e, expected) => {
    expect(run(r, e).status).toBe(expected);
  });

  it("reports found vs expected on a mismatch", () => {
    const result = run(rule({}), extraction({ incoterms: text("CIF") }));
    expect(result).toMatchObject({
      foundText: "CIF",
      expectedText: "FOB",
      confidence: 0.95,
      ruleOperator: "EXACT",
    });
  });

  it("skips inactive rules", () => {
    const results = validator.validate({
      runId: "run_1",
      extraction: extraction(),
      customer: { id: "c", name: "C" },
      rules: [rule({ isActive: false })],
    });
    expect(results).toEqual([]);
  });
});

describe("assessField", () => {
  it("flags missing evidence and invalid HS codes", () => {
    expect(
      assessField("hs_code", { value: "6403?9", confidence: 0.9, evidence: "HS 6403?9" }, 0.8)
        .reliable,
    ).toBe(false);
    expect(
      assessField("incoterms", { value: "FOB", confidence: 0.9, evidence: null }, 0.8).reliable,
    ).toBe(false);
    expect(assessField("incoterms", text("FOB"), 0.8)).toEqual({ reliable: true, reasons: [] });
  });
});

describe("field-aware normalization", () => {
  it.each([
    ["incoterms", "FOB", "FOB Shanghai", "match"],
    ["incoterms", "FOB", "CIF Chennai", "mismatch"],
    ["port_of_discharge", "Mumbai", "Mumbai, India", "match"],
    ["port_of_discharge", "Mumbai", "Chennai, India", "mismatch"],
  ] as const)("%s: expected %s, found %s → %s", (field, expectedValue, found, status) => {
    const result = run(rule({ field, expectedValue }), extraction({ [field]: text(found) }));
    expect(result.status).toBe(status);
  });
});

describe("evidence status", () => {
  it("contradicted or ambiguous evidence is unreliable regardless of the confidence threshold", () => {
    const contradicted = { ...text("640329", 0.95), evidenceStatus: "contradicted" as const };
    const ambiguous = { ...text("640329", 0.95), evidenceStatus: "ambiguous" as const };
    expect(assessField("hs_code", contradicted, 0.1)).toEqual({
      reliable: false,
      reasons: ["the document text contradicts the extracted value"],
    });
    expect(assessField("hs_code", ambiguous, 0.1).reliable).toBe(false);
  });

  it("unverified evidence alone does not make a field unreliable", () => {
    const unverified = { ...text("640399", 0.9), evidenceStatus: "unverified" as const };
    expect(assessField("hs_code", unverified, 0.8)).toEqual({ reliable: true, reasons: [] });
  });
});
