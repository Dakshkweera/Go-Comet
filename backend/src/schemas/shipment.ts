import { z } from "zod";
import type { ExtractionField, ExtractionResult } from "./extraction.js";

export const docTypeSchema = z.enum([
  "COMMERCIAL_INVOICE",
  "BOL",
  "PACKING_LIST",
  "CERTIFICATE_OF_ORIGIN",
  "OTHER",
]);
export type DocType = z.infer<typeof docTypeSchema>;
export type TypedDocType = Exclude<DocType, "OTHER">;

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  COMMERCIAL_INVOICE: "Commercial invoice",
  BOL: "Bill of lading",
  PACKING_LIST: "Packing list",
  CERTIFICATE_OF_ORIGIN: "Certificate of origin",
  OTHER: "Other / unclassified",
};

export const FIELD_LABELS: Record<ExtractionField, string> = {
  consignee_name: "Consignee",
  hs_code: "HS code",
  port_of_loading: "Port of loading",
  port_of_discharge: "Port of discharge",
  incoterms: "Incoterms",
  description_of_goods: "Description of goods",
  gross_weight: "Gross weight",
  invoice_number: "Invoice number",
};

export const shipmentStatusSchema = z.enum([
  "RECEIVED",
  "PROCESSING",
  "NEEDS_REVIEW",
  "AMENDMENT_READY",
  "APPROVAL_READY",
  "AMENDMENT_SENT",
  "APPROVAL_SENT",
  "FAILED",
]);
export type ShipmentStatus = z.infer<typeof shipmentStatusSchema>;

export const shipmentStageSchema = z.enum(["intake", "validation"]);
export type ShipmentStage = z.infer<typeof shipmentStageSchema>;

export const issueSeveritySchema = z.enum(["review", "amendment"]);
export type IssueSeverity = z.infer<typeof issueSeveritySchema>;

export const issueKindSchema = z.enum([
  "no_attachments",
  "attachment_failed",
  "missing_document",
  "missing_field",
  "unreliable_value",
  "duplicate_type_conflict",
  "customer_unresolved",
  "no_rules",
  "rule_mismatch",
  "document_mismatch",
  "inconsistent",
  "cannot_verify",
  "other_document_mismatch",
]);
export type IssueKind = z.infer<typeof issueKindSchema>;

export const reviewActionSchema = z.enum(["clarify", "amend"]);
export type ReviewAction = z.infer<typeof reviewActionSchema>;

export type ActionRule = { value: "required" | "optional" | "none"; note: "required" | "optional" };

export type IssueReference =
  | { source: "rule"; ruleId: string }
  | { source: "document"; documentId: string }
  | { source: "cg" };

export type ShipmentIssue = {
  key: string;
  stage: ShipmentStage;
  severity: IssueSeverity;
  kind: IssueKind;
  field: ExtractionField | null;
  documentIds: string[];
  found: string | null;
  expected: string | null;
  reference: IssueReference | null;
  /** Why the agent flagged it, for the CG operator. */
  message: string;
  /** The sentence that goes into the reply to SU if this item is sent. */
  request: string;
  allowedActions: ReviewAction[];
};

export type ShipmentDocument = {
  id: string;
  filename: string;
  docType: DocType | null;
  cycle: number;
  status: "pending" | "extracted" | "failed";
  error: { code: string; message: string } | null;
  extraction: ExtractionResult | null;
  unchanged: boolean;
};

export type IssueResolution = {
  action: ReviewAction;
  value: string | null;
  note: string | null;
  at: string;
};

export type FieldObservation = {
  documentId: string;
  filename: string;
  docType: DocType;
  value: string | number | null;
  unit: string | null;
  confidence: number;
  reliable: boolean;
  reasons: string[];
  evidence: string | null;
  evidenceStatus: string | null;
  isOwner: boolean;
  agrees: boolean | null;
  verifiedByCg: boolean;
};

export type FieldResult = {
  field: ExtractionField;
  state: "ok" | "amendment" | "review";
  ruleStatus: "match" | "mismatch" | "uncertain" | "no_rule" | "not_checked";
  consistency: "consistent" | "inconsistent" | "single_source" | "not_checked" | "no_values";
  ownerDocType: DocType | null;
  value: string | number | null;
  unit: string | null;
  valueSource: "document" | "cg" | null;
  sourceDocumentId: string | null;
  ruleId: string | null;
  expected: string | null;
  confidence: number | null;
  reason: string;
  observations: FieldObservation[];
};

export const reviewRequestSchema = z.object({
  issueKey: z.string().min(1).max(500),
  action: reviewActionSchema,
  value: z.string().trim().min(1).max(500).optional(),
  note: z.string().trim().min(1).max(1000).optional(),
});
export type ReviewRequest = z.infer<typeof reviewRequestSchema>;

export const setDocTypeRequestSchema = z.object({
  docType: docTypeSchema,
  note: z.string().trim().min(1).max(1000).optional(),
});

export const draftUpdateSchema = z.object({
  version: z.number().int().positive(),
  to: z.string().trim().email().optional(),
  subject: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(20_000),
});
export type DraftUpdate = z.infer<typeof draftUpdateSchema>;

export const draftSendSchema = z.object({ version: z.number().int().positive() });
