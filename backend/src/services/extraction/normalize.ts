import {
  extractedNumberFieldSchema,
  extractedTextFieldSchema,
  REQUIRED_FIELDS,
  type DocumentTypeHint,
  type ExtractionResult,
} from "../../schemas/index.js";
import { LlmError } from "../llm/index.js";

type Raw = Record<string, unknown>;

const isObject = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);

const missing = () => ({ value: null, confidence: 0, evidence: null, candidates: null });

function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const match = v.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function toText(v: unknown): string | null {
  if (typeof v === "number") return String(v);
  if (typeof v !== "string") return null;
  return v.trim() || null;
}

function unitOf(v: unknown): string | null {
  return typeof v === "string" ? (v.match(/\d\s*([a-z]+)\s*$/i)?.[1] ?? null) : null;
}

function candidates(raw: unknown, parse: (v: unknown) => string | number | null) {
  if (!Array.isArray(raw)) return null;
  const values = raw
    .map((c) => parse(isObject(c) && "value" in c ? c.value : c))
    .filter((c) => c !== null);
  return values.length > 0 ? values : null;
}

function normalizeField(field: (typeof REQUIRED_FIELDS)[number], raw: unknown) {
  if (!isObject(raw)) return missing();
  const numeric = field === "gross_weight";
  const confidence = typeof raw.confidence === "string" ? Number(raw.confidence) : raw.confidence;
  const base = {
    confidence,
    evidence: toText(raw.evidence),
    candidates: candidates(raw.candidates, numeric ? toNumber : toText),
  };
  const parsed = numeric
    ? extractedNumberFieldSchema.safeParse({
        ...base,
        value: toNumber(raw.value),
        unit: toText(raw.unit) ?? unitOf(raw.value),
      })
    : extractedTextFieldSchema.safeParse({ ...base, value: toText(raw.value) });
  return parsed.success ? parsed.data : missing();
}

/** Reads the model's document type answer; anything malformed counts as no answer. */
export function readDocumentTypeHint(raw: unknown): DocumentTypeHint | null {
  if (!isObject(raw)) return null;
  const hint = raw.document_type;
  if (typeof hint === "string") return { value: hint, confidence: 0 };
  if (!isObject(hint) || typeof hint.value !== "string") return null;
  const confidence =
    typeof hint.confidence === "string" ? Number(hint.confidence) : hint.confidence;
  return {
    value: hint.value,
    confidence:
      typeof confidence === "number" && confidence >= 0 && confidence <= 1 ? confidence : 0,
  };
}

/**
 * Maps harmless formatting variations in model output onto the extraction contract.
 * A field that still cannot be read becomes missing; values are never invented.
 */
export function normalizeExtraction(raw: unknown): ExtractionResult {
  if (!isObject(raw)) {
    throw new LlmError("MODEL_OUTPUT_INVALID", "Model output was not a JSON object.", true);
  }
  return Object.fromEntries(
    REQUIRED_FIELDS.map((field) => [field, normalizeField(field, raw[field])]),
  ) as ExtractionResult;
}
