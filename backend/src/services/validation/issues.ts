import {
  DOC_TYPE_LABELS,
  FIELD_LABELS,
  type ExtractionField,
  type IssueKind,
  type ShipmentDocument,
  type ShipmentIssue,
} from "../../schemas/index.js";

/** Deterministic, so CG decisions stay attached to an item across re-evaluations. */
export const issueKey = (kind: IssueKind, field: ExtractionField | null, documentIds: string[]) =>
  `${kind}:${field ?? "-"}:${[...documentIds].sort().join("+") || "-"}`;

export function parseIssueKey(key: string) {
  const [kind, field, ids] = key.split(":");
  return {
    kind: kind as IssueKind,
    field: field && field !== "-" ? (field as ExtractionField) : null,
    documentIds: ids && ids !== "-" ? ids.split("+") : [],
  };
}

export function makeIssue(
  issue: Omit<ShipmentIssue, "key" | "found" | "expected" | "reference"> &
    Partial<Pick<ShipmentIssue, "found" | "expected" | "reference">>,
): ShipmentIssue {
  return {
    key: issueKey(issue.kind, issue.field, issue.documentIds),
    found: null,
    expected: null,
    reference: null,
    ...issue,
  };
}

export const typeLabel = (doc: ShipmentDocument) =>
  doc.docType ? DOC_TYPE_LABELS[doc.docType] : "Unreadable file";

/** "Packing list (PL-2042.pdf)", or just the filename when the type is unknown. */
export const describeDoc = (doc: ShipmentDocument) =>
  doc.docType && doc.docType !== "OTHER" ? `${typeLabel(doc)} (${doc.filename})` : doc.filename;

export const fieldLabel = (field: ExtractionField) => FIELD_LABELS[field];
/** Lower-cases a label for mid-sentence use, keeping acronyms such as "HS code". */
export const lower = (text: string) =>
  /^[A-Z]{2}/.test(text) ? text : text.charAt(0).toLowerCase() + text.slice(1);
export const names = (docs: ShipmentDocument[]) => docs.map((d) => d.filename).join(", ");
