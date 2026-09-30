import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  extractionResultSchema,
  REQUIRED_FIELDS,
  type ExtractionField,
  type ExtractionResult,
} from "@nova/contracts";
import { LlmError, parseJsonContent, type ChatMessage, type LlmClient } from "@nova/llm";
import {
  AMBIGUOUS_CONFIDENCE_CAP,
  applyQualityGate,
  CONTRADICTED_CONFIDENCE_CAP,
  createExtractor,
  DocumentReadError,
  FAKE_EXTRACTION,
  normalizeExtraction,
  readPdfText,
  UNVERIFIED_CONFIDENCE_FACTOR,
} from "../src/index.js";

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
const MESSY_OBJECT_CANDIDATES = fixture("gemini-messy-candidates-objects");
const MESSY_NULL_WEIGHT = fixture("gemini-messy-null-weight");
const sample = (name: string) =>
  fileURLToPath(new URL(`../../../samples/${name}-invoice.pdf`, import.meta.url));

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
  "base64",
);

const INVOICE_LINES = [
  "COMMERCIAL INVOICE",
  "INVOICE NO: INV-2026-1042",
  "CONSIGNEE: Bata India Limited, Kolkata, India",
  "PORT OF LOADING: Shanghai",
  "PORT OF DISCHARGE: Mumbai",
  "INCOTERMS: FOB Shanghai",
  "HS CODE: 6403.99",
  "DESCRIPTION OF GOODS: Leather footwear",
  "GROSS WEIGHT: 900 KG",
];

const dir = mkdtempSync(join(tmpdir(), "nova-extract-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function makePdf(name: string, lines: string[], withImage = false) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([595, 842]);
  lines.forEach((text, i) => page.drawText(text, { x: 40, y: 800 - i * 24, size: 11, font }));
  if (withImage) {
    const image = await pdf.embedPng(ONE_PIXEL_PNG);
    page.drawImage(image, { x: 40, y: 200, width: 400, height: 300 });
  }
  const path = join(dir, name);
  writeFileSync(path, await pdf.save());
  return path;
}

const PDF: Record<string, string> = {};
beforeAll(async () => {
  PDF.text = await makePdf("text.pdf", INVOICE_LINES);
  PDF.scanned = await makePdf("scanned.pdf", [], true);
  PDF.hybrid = await makePdf(
    "hybrid.pdf",
    INVOICE_LINES.filter((l) => !l.startsWith("HS CODE")),
    true,
  );
  PDF.shortFooter = await makePdf("short-footer.pdf", ["Scanned 09/2026"], true);
  PDF.longFooter = await makePdf(
    "long-footer.pdf",
    ["Scanned by OfficeScan 09/2026 page 1 of 1"],
    true,
  );
  PDF.corrupt = join(dir, "corrupt.pdf");
  writeFileSync(PDF.corrupt, "%PDF-1.4 this is not a real pdf");
});

const input = (filePath: string, mimeType = "application/pdf") => ({
  runId: "run_1",
  documentId: "doc_1",
  filePath,
  mimeType,
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

const extract = (response: unknown, filePath: string, mimeType?: string) =>
  createExtractor({ llm: stubLlm(response).llm, model: "m" }).extract(input(filePath, mimeType));

const withValue = (field: ExtractionField, value: string | number, confidence = 1) =>
  ({
    ...FAKE_EXTRACTION,
    [field]: { ...FAKE_EXTRACTION[field], value, confidence, evidence: String(value) },
  }) as ExtractionResult;

const statuses = (result: ExtractionResult) =>
  Object.fromEntries(REQUIRED_FIELDS.map((f) => [f, result[f].evidenceStatus]));

describe("extractor", () => {
  it("sends the PDF as a file part and returns schema-valid output", async () => {
    const { llm, calls } = stubLlm(FAKE_EXTRACTION);
    const result = await createExtractor({ llm, model: "m" }).extract(input(PDF.text!));
    expect(extractionResultSchema.safeParse(result).success).toBe(true);
    const userContent = calls[0]![1]!.content as { type: string }[];
    expect(userContent.map((p) => p.type)).toEqual(["text", "file"]);
  });

  it("rejects a response that is not a JSON object as a retryable error", async () => {
    const err = await extract(["not", "an", "object"], PDF.text!).catch((e) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(err).toMatchObject({ code: "MODEL_OUTPUT_INVALID", retryable: true });
  });

  it("fails a corrupt PDF before calling the model, without retrying", async () => {
    const { llm, calls } = stubLlm(FAKE_EXTRACTION);
    const err = await createExtractor({ llm, model: "m" })
      .extract(input(PDF.corrupt!))
      .catch((e) => e);
    expect(err).toBeInstanceOf(DocumentReadError);
    expect(err).toMatchObject({ code: "DOCUMENT_READ_ERROR", retryable: false });
    expect(calls).toHaveLength(0);
  });

  it("treats image uploads as unverified because there is no text layer to check", async () => {
    const png = join(dir, "doc.png");
    writeFileSync(png, ONE_PIXEL_PNG);
    const result = await extract(FAKE_EXTRACTION, png, "image/png");
    expect(new Set(Object.values(statuses(result)))).toEqual(new Set(["unverified"]));
  });
});

describe("readPdfText", () => {
  it("returns the text layer of a text PDF", async () => {
    expect(await readPdfText(sample("clean"))).toContain("INV-2026-1042");
  });

  it("returns null for an image-only PDF and for tiny text layers", async () => {
    expect(await readPdfText(PDF.scanned!)).toBeNull();
    expect(await readPdfText(PDF.shortFooter!)).toBeNull();
    expect(await readPdfText(PDF.longFooter!)).toContain("OfficeScan");
  });

  it("throws DocumentReadError for an unparseable PDF", async () => {
    await expect(readPdfText(PDF.corrupt!)).rejects.toBeInstanceOf(DocumentReadError);
  });
});

describe("normalizeExtraction", () => {
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

  it("never lets the model declare its own evidence status", () => {
    const result = normalizeExtraction({
      ...FAKE_EXTRACTION,
      hs_code: { ...FAKE_EXTRACTION.hs_code, evidenceStatus: "supported" },
    });
    expect(result.hs_code.evidenceStatus).toBeUndefined();
  });
});

describe("evidence quality gate", () => {
  it("1. SUPPORTED: labelled PDF text matches every field; confidence unchanged", async () => {
    const text = await readPdfText(PDF.text!);
    const result = applyQualityGate({ ...FAKE_EXTRACTION }, text);
    expect(new Set(Object.values(statuses(result)))).toEqual(new Set(["supported"]));
    for (const f of REQUIRED_FIELDS)
      expect(result[f].confidence).toBe(FAKE_EXTRACTION[f].confidence);
  });

  it("2. CONTRADICTED: model says 6403.29, the HS CODE line says 6403.99", async () => {
    const text = await readPdfText(PDF.text!);
    const result = applyQualityGate(withValue("hs_code", "6403.29"), text);
    expect(result.hs_code.evidenceStatus).toBe("contradicted");
    expect(result.hs_code.confidence).toBeLessThanOrEqual(CONTRADICTED_CONFIDENCE_CAP);
    expect(result.hs_code.value).toBe("6403.29");
  });

  it("2b. CONTRADICTED: a numeric weight that differs from the labelled line", async () => {
    const text = await readPdfText(PDF.text!);
    const result = applyQualityGate(withValue("gross_weight", 1200), text);
    expect(result.gross_weight.evidenceStatus).toBe("contradicted");
  });

  it("3. AMBIGUOUS: the real messy PDF shows 6403.?9 and the model says 6403.29", async () => {
    const result = await extract(MESSY_OBJECT_CANDIDATES, sample("messy"));
    expect(result.hs_code.evidenceStatus).toBe("ambiguous");
    expect(result.hs_code.confidence).toBeLessThanOrEqual(AMBIGUOUS_CONFIDENCE_CAP);
    expect(result.hs_code.value).toBe("6403.29");
    expect(result.gross_weight.candidates).toEqual([900, 1500]);
  });

  it("3b. AMBIGUOUS: ambiguity marks in the model's own value or evidence", () => {
    const result = applyQualityGate(withValue("hs_code", "6403.?9"), null);
    expect(result.hs_code.evidenceStatus).toBe("ambiguous");
    expect(result.hs_code.confidence).toBe(AMBIGUOUS_CONFIDENCE_CAP);
  });

  it("4. UNVERIFIED: a fully scanned PDF has no text; confidence x0.90, no crash", async () => {
    const response = { ...FAKE_EXTRACTION, hs_code: { ...FAKE_EXTRACTION.hs_code, confidence: 1 } };
    const result = await extract(response, PDF.scanned!);
    expect(new Set(Object.values(statuses(result)))).toEqual(new Set(["unverified"]));
    expect(result.hs_code.confidence).toBe(UNVERIFIED_CONFIDENCE_FACTOR);
    expect(result.consignee_name.confidence).toBe(0.873);
  });

  it("5. hybrid: text fields stay SUPPORTED, the image-only HS code is UNVERIFIED", async () => {
    const text = await readPdfText(PDF.hybrid!);
    const result = applyQualityGate({ ...FAKE_EXTRACTION }, text);
    expect(result.hs_code.evidenceStatus).toBe("unverified");
    expect(result.hs_code.confidence).toBe(0.873);
    for (const f of REQUIRED_FIELDS.filter((f) => f !== "hs_code")) {
      expect(result[f].evidenceStatus).toBe("supported");
    }
  });

  it("7. no threshold cliff: a 15-char and a 40-char scanner footer give the same result", async () => {
    const short = applyQualityGate({ ...FAKE_EXTRACTION }, await readPdfText(PDF.shortFooter!));
    const long = applyQualityGate({ ...FAKE_EXTRACTION }, await readPdfText(PDF.longFooter!));
    expect(long).toEqual(short);
    expect(new Set(Object.values(statuses(long)))).toEqual(new Set(["unverified"]));
  });

  it("8. a wrong value on a scanned PDF is UNVERIFIED, never SUPPORTED (limitation: no OCR)", async () => {
    const result = await extract(withValue("hs_code", "6403.29"), PDF.scanned!);
    expect(result.hs_code.evidenceStatus).toBe("unverified");
    expect(result.hs_code.confidence).toBe(UNVERIFIED_CONFIDENCE_FACTOR);
  });

  it("value elsewhere: a labelled line decides, stray mentions elsewhere do not", () => {
    const text = "HS CODE: 6403.99\nBroker note: previously classified as 6403.29";
    const result = applyQualityGate(withValue("hs_code", "6403.29"), text);
    expect(result.hs_code.evidenceStatus).toBe("contradicted");
  });

  it("value elsewhere without a label is weak support for long values only", () => {
    const text = "Customs note: classified under 6403.99. Terms agreed FOB.";
    const hs = applyQualityGate(withValue("hs_code", "6403.99"), text);
    const incoterms = applyQualityGate(withValue("incoterms", "FOB"), text);
    expect(hs.hs_code.evidenceStatus).toBe("supported");
    expect(incoterms.incoterms.evidenceStatus).toBe("unverified");
  });

  it("reads a value on the line after its label", () => {
    const result = applyQualityGate(withValue("hs_code", "6403.99"), "HS CODE:\n6403.99\nOther");
    expect(result.hs_code.evidenceStatus).toBe("supported");
  });

  it("does not treat a paraphrased free-text field as a contradiction", () => {
    const text = "CONSIGNEE: Bata India Ltd\nDESCRIPTION OF GOODS: Mens formal leather shoes";
    const consignee = applyQualityGate(withValue("consignee_name", "Bata India Limited"), text);
    const goods = applyQualityGate(withValue("description_of_goods", "Footwear"), text);
    expect(consignee.consignee_name.evidenceStatus).toBe("supported");
    expect(goods.description_of_goods.evidenceStatus).toBe("unverified");
  });

  it("marks a value its own evidence does not support as contradicted when the PDF cannot decide", () => {
    const extraction = {
      ...FAKE_EXTRACTION,
      port_of_discharge: { value: "Mumbai", confidence: 1, evidence: "Chennai", candidates: null },
    };
    const result = applyQualityGate(extraction, null);
    expect(result.port_of_discharge.evidenceStatus).toBe("contradicted");
  });

  it("leaves missing values untouched", () => {
    const extraction = {
      ...FAKE_EXTRACTION,
      hs_code: { value: null, confidence: 0.1, evidence: null, candidates: null },
    };
    const result = applyQualityGate(extraction, null);
    expect(result.hs_code).toEqual(extraction.hs_code);
  });
});

describe("parseJsonContent", () => {
  it("accepts fenced JSON and rejects prose", () => {
    expect(parseJsonContent('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(() => parseJsonContent("Sure! Here is the data")).toThrow(LlmError);
  });
});
