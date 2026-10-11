import { describe, expect, it } from "vitest";
import {
  classifyDocument,
  FAKE_EXTRACTION,
  limitExtractor,
  readDocumentTypeHint,
} from "../../../src/services/extraction/index.js";

const hint = (value: string, confidence = 0.95) => ({ value, confidence });

describe("classifyDocument", () => {
  it.each([
    ["COMMERCIAL INVOICE\nInvoice No: INV-1", null, "COMMERCIAL_INVOICE", /Title reads/],
    ["BILL OF LADING\nB/L No: X", hint("BOL"), "BOL", /model agrees/],
    ["PACKING LIST\nInvoice No: INV-1", hint("PACKING_LIST"), "PACKING_LIST", /model agrees/],
    ["Certificate of Origin\nIssued by", null, "CERTIFICATE_OF_ORIGIN", /Title reads/],
    [
      "BILL OF LADING",
      hint("COMMERCIAL_INVOICE"),
      "OTHER",
      /Title says Bill of lading, model says/,
    ],
    ["BILL OF LADING", hint("COMMERCIAL_INVOICE", 0.5), "BOL", /Title reads/],
    ["PROFORMA INVOICE\nNo: 1", hint("COMMERCIAL_INVOICE"), "OTHER", /not a single supported/],
    ["COMMERCIAL INVOICE CUM PACKING LIST", null, "OTHER", /not a single supported/],
    [null, hint("PACKING_LIST"), "PACKING_LIST", /no title/],
    ["Some text without a heading", hint("BOL", 0.85), "BOL", /no title/],
    [null, hint("PACKING_LIST", 0.6), "OTHER", /unclear/],
    [null, hint("OTHER"), "OTHER", /unclear/],
    [null, hint("not a type"), "OTHER", /unclear/],
    ["FUMIGATION CERTIFICATE\nTreatment: methyl bromide", null, "OTHER", /unclear/],
  ])("%j with %j → %s", (text, h, expected, reason) => {
    const result = classifyDocument(text, h);
    expect(result.docType).toBe(expected);
    expect(result.reason).toMatch(reason);
  });

  it("ignores a document name mentioned far below the title area", () => {
    const body = Array.from({ length: 20 }, (_, i) => `Line ${i}`).join("\n");
    expect(classifyDocument(`${body}\nPACKING LIST`, null).docType).toBe("OTHER");
  });
});

describe("readDocumentTypeHint", () => {
  it("reads the model's answer and treats malformed output as no answer", () => {
    expect(readDocumentTypeHint({ document_type: { value: "BOL", confidence: 0.9 } })).toEqual(
      hint("BOL", 0.9),
    );
    expect(readDocumentTypeHint({ document_type: { value: "BOL", confidence: "0.8" } })).toEqual(
      hint("BOL", 0.8),
    );
    expect(readDocumentTypeHint({ document_type: "BOL" })).toEqual(hint("BOL", 0));
    expect(readDocumentTypeHint({ document_type: { confidence: 1 } })).toBeNull();
    expect(readDocumentTypeHint({})).toBeNull();
  });
});

describe("limitExtractor", () => {
  it("never runs more extractions at once than allowed", async () => {
    let active = 0;
    let peak = 0;
    const limited = limitExtractor(
      {
        extract: async () => {
          peak = Math.max(peak, ++active);
          await new Promise((r) => setTimeout(r, 5));
          active--;
          return FAKE_EXTRACTION;
        },
      },
      2,
    );
    const input = { runId: "r", documentId: "d", filePath: "f", mimeType: "application/pdf" };
    await Promise.all(Array.from({ length: 6 }, () => limited.extract(input)));
    expect(peak).toBe(2);
  });

  it("frees the slot when an extraction fails", async () => {
    const limited = limitExtractor({ extract: async () => Promise.reject(new Error("x")) }, 1);
    const input = { runId: "r", documentId: "d", filePath: "f", mimeType: "application/pdf" };
    await expect(limited.extract(input)).rejects.toThrow("x");
    await expect(limited.extract(input)).rejects.toThrow("x");
  });
});
