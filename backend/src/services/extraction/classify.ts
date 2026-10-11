import {
  DOC_TYPE_LABELS,
  docTypeSchema,
  type DocType,
  type DocumentTypeHint,
  type TypedDocType,
} from "../../schemas/index.js";

export const CLASSIFICATION_MIN_CONFIDENCE = 0.8;
const TITLE_LINES = 15;

const TITLES: [TypedDocType, RegExp][] = [
  ["BOL", /\bbill\s+of\s+lading\b|\bsea\s*waybill\b/i],
  ["PACKING_LIST", /\bpacking\s+(?:list|slip)\b/i],
  ["CERTIFICATE_OF_ORIGIN", /\bcertificate\s+of\s+origin\b/i],
  ["COMMERCIAL_INVOICE", /\b(?:commercial|tax)\s+invoice\b|^\s*invoice\s*$/i],
];
const PROFORMA = /\bpro\s*-?\s*forma\b/i;

type Title = { line: string; types: TypedDocType[]; proforma: boolean };

/** The first heading-like line near the top that names a document type, if any. */
export function findTitle(text: string | null): Title | null {
  if (!text) return null;
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, TITLE_LINES);
  for (const line of lines) {
    const types = TITLES.filter(([, pattern]) => pattern.test(line)).map(([type]) => type);
    const proforma = PROFORMA.test(line) && /invoice/i.test(line);
    if (types.length > 0 || proforma) return { line, types, proforma };
  }
  return null;
}

export function classifyDocument(
  text: string | null,
  hint: DocumentTypeHint | null | undefined,
): { docType: DocType; reason: string } {
  const parsed = hint ? docTypeSchema.safeParse(hint.value.trim().toUpperCase()) : null;
  const model =
    hint && parsed?.success && hint.confidence >= CLASSIFICATION_MIN_CONFIDENCE
      ? parsed.data
      : null;
  const title = findTitle(text);

  if (title && title.types.length === 1 && !title.proforma) {
    const type = title.types[0]!;
    if (model && model !== type) {
      return {
        docType: "OTHER",
        reason: `Title says ${DOC_TYPE_LABELS[type]}, model says ${DOC_TYPE_LABELS[model]}`,
      };
    }
    return {
      docType: type,
      reason: `Title reads "${title.line}"${model === type ? "; model agrees" : ""}`,
    };
  }
  if (title) {
    return {
      docType: "OTHER",
      reason: `Title "${title.line}" is not a single supported document type`,
    };
  }
  if (model && model !== "OTHER") {
    return { docType: model, reason: "Model classification; no title in the text to confirm it" };
  }
  return { docType: "OTHER", reason: "Document type unclear" };
}
