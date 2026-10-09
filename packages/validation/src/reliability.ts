import type {
  ExtractedNumberField,
  ExtractedTextField,
  ExtractionField,
} from "../../contracts/src/index.js";

export type FieldReliability = { reliable: boolean; reasons: string[] };

export const normalizeHsCode = (value: string) => value.replace(/[.\s-]/g, "");

export function assessField(
  field: ExtractionField,
  extracted: ExtractedTextField | ExtractedNumberField,
  minConfidence: number,
): FieldReliability {
  const reasons: string[] = [];
  const { value, confidence, evidence, candidates } = extracted;

  const conflicting = candidates && new Set(candidates.map(String)).size > 1;
  if (value === null || value === "") {
    return {
      reliable: false,
      reasons: [
        conflicting
          ? `conflicting values in the document (${candidates.join(", ")})`
          : "not found in the document",
      ],
    };
  }
  if (confidence < minConfidence) {
    reasons.push(`low extraction confidence (${confidence.toFixed(2)} < ${minConfidence})`);
  }
  if (!evidence) {
    reasons.push("no supporting evidence from the document");
  }
  if (extracted.evidenceStatus === "contradicted") {
    reasons.push("the document text contradicts the extracted value");
  }
  if (extracted.evidenceStatus === "ambiguous") {
    reasons.push("the document text for this field is ambiguous");
  }
  if (conflicting) {
    reasons.push(`conflicting values in the document (${candidates.join(", ")})`);
  }
  if (
    field === "hs_code" &&
    typeof value === "string" &&
    !/^\d{6,10}$/.test(normalizeHsCode(value))
  ) {
    reasons.push(`"${value}" is not a valid HS code`);
  }
  if (field === "gross_weight" && typeof value === "number" && value <= 0) {
    reasons.push("gross weight must be positive");
  }
  return { reliable: reasons.length === 0, reasons };
}
