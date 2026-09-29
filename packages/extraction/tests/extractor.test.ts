import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { extractionResultSchema, type ExtractionResult } from "@nova/contracts";
import { LlmError, parseJsonContent, type ChatMessage, type LlmClient } from "@nova/llm";
import {
  AMBIGUOUS_CONFIDENCE_CAP,
  applyQualityGate,
  createExtractor,
  FAKE_EXTRACTION,
  normalizeExtraction,
  UNSUPPORTED_CONFIDENCE_CAP,
} from "../src/index.js";

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
const MESSY_OBJECT_CANDIDATES = fixture("gemini-messy-candidates-objects");
const MESSY_NULL_WEIGHT = fixture("gemini-messy-null-weight");
const MESSY_PDF = fileURLToPath(new URL("../../../samples/messy-invoice.pdf", import.meta.url));

const dir = mkdtempSync(join(tmpdir(), "nova-extract-"));
const fakePdf = join(dir, "doc.pdf");
writeFileSync(fakePdf, "%PDF-1.4 test");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const input = (filePath = fakePdf) => ({
  runId: "run_1",
  documentId: "doc_1",
  filePath,
  mimeType: "application/pdf",
});

function stubLlm(response: unknown) {
  const calls: ChatMessage[][] = [];
  const llm: LlmClient = {
    chatJson: async ({ messages }) => {
      calls.push(messages);
      return response;
    },
  };
  return { llm, calls };
}

describe("extractor", () => {
  it("sends the PDF as a file part and returns schema-valid output", async () => {
    const { llm, calls } = stubLlm(FAKE_EXTRACTION);
    const result = await createExtractor({ llm, model: "m" }).extract(input());
    expect(result).toEqual(FAKE_EXTRACTION);
    const userContent = calls[0]![1]!.content as { type: string }[];
    expect(userContent.map((p) => p.type)).toEqual(["text", "file"]);
  });

  it("rejects a response that is not a JSON object as a retryable error", async () => {
    const { llm } = stubLlm(["not", "an", "object"]);
    const err = await createExtractor({ llm, model: "m" })
      .extract(input())
      .catch((e) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(err).toMatchObject({ code: "MODEL_OUTPUT_INVALID", retryable: true });
  });

  it("extracts the real failing messy response without inventing the HS code", async () => {
    const { llm } = stubLlm(MESSY_OBJECT_CANDIDATES);
    const result = await createExtractor({ llm, model: "m" }).extract(input(MESSY_PDF));
    expect(extractionResultSchema.safeParse(result).success).toBe(true);
    expect(result.hs_code.value).toBe("6403.29");
    expect(result.hs_code.confidence).toBe(UNSUPPORTED_CONFIDENCE_CAP);
    expect(result.gross_weight.candidates).toEqual([900, 1500]);
    expect(result.consignee_name.confidence).toBe(1);
  });
});

describe("normalizeExtraction (Fix 1)", () => {
  it("accepts the exact Gemini response whose candidates are objects", () => {
    const result = normalizeExtraction(MESSY_OBJECT_CANDIDATES);
    expect(result.gross_weight).toEqual({
      value: 900,
      unit: "KG",
      confidence: 1,
      evidence: "GROSS WEIGHT: 900 KG",
      candidates: [900, 1500],
    });
    expect(result.invoice_number.value).toBe("INV-2026-1044");
  });

  it("keeps a null value null when the model only lists conflicting candidates", () => {
    const result = normalizeExtraction(MESSY_NULL_WEIGHT);
    expect(result.gross_weight.value).toBeNull();
    expect(result.gross_weight.candidates).toEqual([900, 1500]);
  });

  it("parses numbers written as text and derives the unit", () => {
    const result = normalizeExtraction({
      ...FAKE_EXTRACTION,
      gross_weight: { value: "1,200 KG", confidence: "0.9", evidence: "1,200 KG" },
    });
    expect(result.gross_weight).toMatchObject({ value: 1200, unit: "KG", confidence: 0.9 });
  });

  it("turns an unreadable field into missing and keeps the rest", () => {
    const result = normalizeExtraction({
      ...FAKE_EXTRACTION,
      hs_code: { value: "640399", confidence: 3 },
      incoterms: "FOB",
      port_of_loading: undefined,
    });
    for (const field of ["hs_code", "incoterms", "port_of_loading"] as const) {
      expect(result[field]).toEqual({
        value: null,
        confidence: 0,
        evidence: null,
        candidates: null,
      });
    }
    expect(result.port_of_discharge.value).toBe("Mumbai");
  });
});

describe("applyQualityGate (Fix 2)", () => {
  const withField = (field: keyof ExtractionResult, value: string, evidence: string | null) =>
    ({
      ...FAKE_EXTRACTION,
      [field]: { value, confidence: 1, evidence, candidates: null },
    }) as ExtractionResult;

  it("downgrades a confident HS code that the document text does not contain", () => {
    const text = "HS CODE: 6403.?9\nGROSS WEIGHT: 900 KG";
    const result = applyQualityGate(withField("hs_code", "6403.29", "6403.29"), text);
    expect(result.hs_code).toMatchObject({ value: "6403.29", evidence: "6403.29" });
    expect(result.hs_code.confidence).toBe(UNSUPPORTED_CONFIDENCE_CAP);
  });

  it("downgrades values with ambiguity marks harder", () => {
    const result = applyQualityGate(withField("hs_code", "6403.?9", "HS CODE: 6403.?9"), null);
    expect(result.hs_code.confidence).toBe(AMBIGUOUS_CONFIDENCE_CAP);
  });

  it("downgrades a value its own evidence does not support", () => {
    const result = applyQualityGate(withField("port_of_discharge", "Mumbai", "Chennai"), null);
    expect(result.port_of_discharge.confidence).toBe(UNSUPPORTED_CONFIDENCE_CAP);
  });

  it("leaves grounded values untouched, ignoring case and number formatting", () => {
    const text =
      "CONSIGNEE: Bata India Limited\nHS CODE: 6403.99\nGROSS WEIGHT: 1,200 KG\nINCOTERMS: FOB Shanghai";
    const extraction = {
      ...withField("hs_code", "640399", "HS CODE: 6403.99"),
      gross_weight: {
        value: 1200,
        unit: "kg",
        confidence: 0.95,
        evidence: "1,200 KG",
        candidates: null,
      },
    };
    const result = applyQualityGate(extraction, text);
    expect(result.hs_code.confidence).toBe(1);
    expect(result.gross_weight.confidence).toBe(0.95);
  });
});

describe("parseJsonContent", () => {
  it("accepts fenced JSON and rejects prose", () => {
    expect(parseJsonContent('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(() => parseJsonContent("Sure! Here is the data")).toThrow(LlmError);
  });
});
