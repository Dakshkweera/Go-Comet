import { readFile } from "node:fs/promises";
import {
  REQUIRED_FIELDS,
  type EvidenceStatus,
  type ExtractedNumberField,
  type ExtractedTextField,
  type ExtractionField,
  type ExtractionResult,
} from "@nova/contracts";
import { extractText, getDocumentProxy } from "unpdf";

// Operational heuristics, not calibrated probabilities.
export const UNVERIFIED_CONFIDENCE_FACTOR = 0.9;
export const AMBIGUOUS_CONFIDENCE_CAP = 0.3;
export const CONTRADICTED_CONFIDENCE_CAP = 0.5;

const MIN_TEXT_CHARS = 20;
const MIN_UNLABELLED_MATCH_CHARS = 4;

const LABELS: Record<ExtractionField, string> = {
  consignee_name: "consignee|buyer|importer",
  hs_code: "h\\.?s\\.?(?:\\s*(?:code|no\\.?|number))?|hsn(?:\\s*code)?|tariff\\s*(?:code|no\\.?)",
  port_of_loading: "port\\s*of\\s*loading|loading\\s*port|pol",
  port_of_discharge: "port\\s*of\\s*discharge|discharge\\s*port|destination\\s*port|pod",
  incoterms: "incoterms?(?:\\s*20\\d\\d)?|delivery\\s*terms|terms\\s*of\\s*delivery",
  description_of_goods: "description(?:\\s*of\\s*goods)?|goods\\s*description",
  gross_weight: "gross\\s*(?:weight|wt\\.?)|g\\.?\\s*w\\.?",
  invoice_number: "invoice\\s*(?:no\\.?|number|#)|inv\\.?\\s*no\\.?",
};

// Free-text fields are often paraphrased, so a non-matching line is not treated as a contradiction.
const FREE_TEXT = new Set<ExtractionField>(["consignee_name", "description_of_goods"]);

const AMBIGUOUS = /[?�□]|illegible|unreadable/i;
const squash = (s: string) => s.toLowerCase().replace(/[\s,.\-'"]/g, "");
const words = (s: string) => s.toLowerCase().match(/[a-z0-9]{2,}/g) ?? [];

export class DocumentReadError extends Error {
  readonly code = "DOCUMENT_READ_ERROR";
  readonly retryable = false;
}

export async function readPdfText(filePath: string): Promise<string | null> {
  let text: string;
  try {
    const pdf = await getDocumentProxy(new Uint8Array(await readFile(filePath)));
    ({ text } = await extractText(pdf, { mergePages: true }));
  } catch {
    throw new DocumentReadError("The PDF could not be parsed.");
  }
  return text.replace(/\s/g, "").length >= MIN_TEXT_CHARS ? text : null;
}

function labelledLines(text: string, field: ExtractionField): string[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const label = new RegExp(`^(?:${LABELS[field]})(?=[\\s:#.\\-]|$)[\\s:#.\\-]*(.*)$`, "i");
  return lines.flatMap((line, i) => {
    const match = line.match(label);
    if (!match) return [];
    const rest = match[1]!.trim() || lines.slice(i + 1).find(Boolean) || "";
    return rest ? [rest] : [];
  });
}

function supports(field: ExtractionField, value: string | number, line: string): boolean {
  if (typeof value === "number") {
    const numbers = line.replace(/,/g, "").match(/\d+(?:\.\d+)?/g) ?? [];
    return numbers.some((n) => Number(n) === value);
  }
  if (squash(line).includes(squash(value))) return true;
  if (!FREE_TEXT.has(field)) return false;
  const expected = words(value);
  const found = new Set(words(line));
  return (
    expected.length > 0 && expected.filter((w) => found.has(w)).length / expected.length >= 0.6
  );
}

function documentEvidence(
  field: ExtractionField,
  value: string | number,
  text: string | null,
): EvidenceStatus {
  if (!text) return "unverified";
  const lines = labelledLines(text, field);
  if (lines.length === 0) {
    const v = squash(String(value));
    return v.length >= MIN_UNLABELLED_MATCH_CHARS && squash(text).includes(v)
      ? "supported"
      : "unverified";
  }
  if (lines.some((line) => supports(field, value, line))) return "supported";
  if (lines.some((line) => AMBIGUOUS.test(line))) return "ambiguous";
  return FREE_TEXT.has(field) ? "unverified" : "contradicted";
}

export function evidenceStatus(
  field: ExtractionField,
  f: ExtractedTextField | ExtractedNumberField,
  documentText: string | null,
): EvidenceStatus {
  const value = String(f.value);
  if (AMBIGUOUS.test(value) || (f.evidence && AMBIGUOUS.test(f.evidence))) return "ambiguous";
  const status = documentEvidence(field, f.value!, documentText);
  if (status !== "unverified") return status;
  return f.evidence && !squash(f.evidence).includes(squash(value)) ? "contradicted" : status;
}

function adjust(confidence: number, status: EvidenceStatus): number {
  switch (status) {
    case "supported":
      return confidence;
    case "unverified":
      return Math.round(confidence * UNVERIFIED_CONFIDENCE_FACTOR * 1000) / 1000;
    case "ambiguous":
      return Math.min(confidence, AMBIGUOUS_CONFIDENCE_CAP);
    case "contradicted":
      return Math.min(confidence, CONTRADICTED_CONFIDENCE_CAP);
  }
}

export function applyQualityGate(
  extraction: ExtractionResult,
  documentText: string | null,
): ExtractionResult {
  return Object.fromEntries(
    REQUIRED_FIELDS.map((field) => {
      const f = extraction[field];
      if (f.value === null) return [field, f];
      const status = evidenceStatus(field, f, documentText);
      return [field, { ...f, confidence: adjust(f.confidence, status), evidenceStatus: status }];
    }),
  ) as ExtractionResult;
}
