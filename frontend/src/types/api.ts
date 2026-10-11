// Shapes returned by the backend API. The frontend deploys separately, so these are maintained here
// rather than imported from the backend.

export const REQUIRED_FIELDS = [
  "consignee_name",
  "hs_code",
  "port_of_loading",
  "port_of_discharge",
  "incoterms",
  "description_of_goods",
  "gross_weight",
  "invoice_number",
] as const;

export type ExtractionField = (typeof REQUIRED_FIELDS)[number];
export type EvidenceStatus = "supported" | "unverified" | "ambiguous" | "contradicted";
export type ValidationStatus = "match" | "mismatch" | "uncertain";
export type RuleOperator = "EXACT" | "MIN" | "MAX" | "RANGE";
export type Decision = "auto_approve" | "human_review" | "amendment_request";
export type PipelineStage =
  | "RECEIVED"
  | "EXTRACTING"
  | "EXTRACTED"
  | "CUSTOMER_RESOLVING"
  | "CUSTOMER_RESOLVED"
  | "VALIDATING"
  | "VALIDATED"
  | "ROUTING"
  | "ROUTED"
  | "COMPLETED";

export type ExtractedTextField = {
  value: string | null;
  confidence: number;
  evidence?: string | null;
  candidates?: string[] | null;
  evidenceStatus?: EvidenceStatus;
};

export type ExtractedNumberField = {
  value: number | null;
  confidence: number;
  unit?: string | null;
  evidence?: string | null;
  candidates?: number[] | null;
  evidenceStatus?: EvidenceStatus;
};

export type ExtractionResult = {
  consignee_name: ExtractedTextField;
  hs_code: ExtractedTextField;
  port_of_loading: ExtractedTextField;
  port_of_discharge: ExtractedTextField;
  incoterms: ExtractedTextField;
  description_of_goods: ExtractedTextField;
  gross_weight: ExtractedNumberField;
  invoice_number: ExtractedTextField;
};

export type ValidationResult = {
  field: ExtractionField;
  status: ValidationStatus;
  foundText: string | null;
  foundNumber: number | null;
  expectedText: string | null;
  expectedNumber: number | null;
  expectedMin: number | null;
  expectedMax: number | null;
  unit: string | null;
  confidence: number | null;
  ruleId: string | null;
  ruleOperator: RuleOperator | null;
  reason: string;
};

export type CustomerRule = {
  id: string;
  customerId: string;
  field: ExtractionField;
  operator: RuleOperator;
  expectedValue: string | number | null;
  minValue: number | null;
  maxValue: number | null;
  unit: string | null;
  isActive: boolean;
};

export type Discrepancy = {
  field: ExtractionField;
  found: string;
  expected: string;
  reason: string;
};

export type FieldReliability = { reliable: boolean; reasons: string[] };

export type RunView = {
  id: string;
  status: string;
  currentStage: string;
  createdAt: string;
  completedAt: string | null;
  document: { filename: string; mimeType: string; size: number };
  extraction: ExtractionResult | null;
  reliability: {
    minConfidence: number;
    fields: Record<ExtractionField, FieldReliability>;
  } | null;
  customer: { status: string; name: string | null; reason: string | null } | null;
  rules: CustomerRule[];
  validations: ValidationResult[];
  decision: {
    decision: string;
    reasoning: string;
    discrepancies: Discrepancy[];
    amendmentDraft: string | null;
  } | null;
  error: { code: string; message: string | null } | null;
  attempts: {
    stage: string;
    attempt: number;
    status: string;
    errorMessage: string | null;
  }[];
};

export type HealthResponse = { status: "ok" | "degraded"; db: "ok" | "error" };

export type QueryExecutionResult = { columns: string[]; rows: Record<string, unknown>[] };

export type QueryResponse = {
  type: "general_question" | "database_query";
  answer: string;
  data: QueryExecutionResult | null;
  sql: string | null;
};

// ---------------------------------------------------------------------------------------------
// Part 2: supplier emails and shipments (backend docs/PART2_DESIGN.md §11).

export type ShipmentStatus =
  | "RECEIVED"
  | "PROCESSING"
  | "NEEDS_REVIEW"
  | "AMENDMENT_READY"
  | "APPROVAL_READY"
  | "AMENDMENT_SENT"
  | "APPROVAL_SENT"
  | "FAILED";

export type ShipmentStage = "intake" | "validation";
export type DocType =
  "COMMERCIAL_INVOICE" | "BOL" | "PACKING_LIST" | "CERTIFICATE_OF_ORIGIN" | "OTHER";
// §11 describes reading / read / failed; the backend also reports "processing" mid-read.
export type DocumentStatus = "pending" | "processing" | "extracted" | "failed";
export type ConfidenceLevel = "low" | "medium" | "high";
export type FieldState = "ok" | "amendment" | "review";
// §11 lists four rule statuses; before validation runs the backend also sends "not_checked".
export type RuleStatus = "match" | "mismatch" | "uncertain" | "no_rule" | "not_checked";
export type Consistency = "consistent" | "inconsistent" | "single_source" | "not_checked";
export type IssueSeverity = "review" | "amendment";
export type ReviewActionName = "clarify" | "amend";
export type InputRequirement = "none" | "optional" | "required";
export type ActionRule = { value: InputRequirement; note: InputRequirement };
export type OutboundKind = "approval" | "amendment";

export type ShipmentParty = { name: string; address: string };

export type ShipmentSummary = {
  id: string;
  reference: string;
  subject: string;
  supplier: ShipmentParty;
  customer: { id?: string; name: string } | null;
  status: ShipmentStatus;
  stage: ShipmentStage;
  decision: Decision | null;
  headline: string;
  cycle: number;
  attachments: number;
  openReviewItems: number;
  amendmentItems: number;
  receivedAt: string;
  updatedAt: string;
};

export type ShipmentEmail = {
  id: string;
  cycle: number;
  from: string;
  subject: string;
  receivedAt: string;
  bodyText: string;
  documentIds: string[];
};

export type ShipmentDocument = {
  id: string;
  runId: string;
  filename: string;
  mimeType: string;
  size: number;
  cycle: number;
  current: boolean;
  unchangedFromCycle: number | null;
  // Null for an attachment that could not be read, although §11 shows strings.
  docType: DocType | null;
  docTypeLabel: string | null;
  docTypeReason: string | null;
  status: DocumentStatus;
  error: { code: string; message: string } | null;
  fileUrl: string;
};

export type FieldObservation = {
  documentId: string;
  filename: string;
  docType: DocType | null;
  value: string | number | null;
  unit: string | null;
  confidence: number;
  confidenceLevel: ConfidenceLevel;
  reliable: boolean;
  reasons: string[];
  evidence: string | null;
  evidenceStatus: EvidenceStatus | null;
  isOwner: boolean;
  agrees: boolean | null;
  verifiedByCg?: boolean;
};

export type ShipmentField = {
  field: ExtractionField;
  label: string;
  state: FieldState;
  ruleStatus: RuleStatus;
  consistency: Consistency;
  ownerDocType: DocType | null;
  value: string | number | null;
  unit: string | null;
  expected: string | null;
  reason: string | null;
  observations: FieldObservation[];
};

export type IssueReference =
  { source: "rule"; ruleId: string } | { source: "document"; documentId: string };

export type IssueResolution = {
  action: ReviewActionName;
  value: string | null;
  note: string | null;
  at: string;
};

export type ShipmentIssue = {
  key: string;
  stage: ShipmentStage;
  severity: IssueSeverity;
  kind: string;
  field: ExtractionField | null;
  fieldLabel: string | null;
  documents: { id: string; filename: string; docType: DocType | null }[];
  found: string | null;
  expected: string | null;
  reference: IssueReference | null;
  message: string;
  request: string;
  allowedActions: ReviewActionName[];
  actionRules: Partial<Record<ReviewActionName, ActionRule>>;
  resolution: IssueResolution | null;
};

export type Draft = {
  id: string;
  kind: OutboundKind;
  version: number;
  to: string;
  subject: string;
  body: string;
  generatedBody: string;
  edited: boolean;
  status: string;
  previousVersionEdited: boolean;
  canSend: boolean;
  sendBlockedReason: string | null;
};

export type SentReference = {
  id: string;
  kind: OutboundKind;
  to: string;
  subject: string;
  sentAt: string;
};

export type ShipmentEvent = { type: string; message: string; at: string };

export type ShipmentView = ShipmentSummary & {
  reasoning: string | null;
  customerResolution: { status: string; name: string | null; reason: string | null } | null;
  emails: ShipmentEmail[];
  progress: { total: number; done: number; failed: number };
  documents: ShipmentDocument[];
  fields: ShipmentField[];
  issues: ShipmentIssue[];
  // Null while only review items are open, and also after the reply was sent.
  draft: Draft | null;
  sent: SentReference[];
  events: ShipmentEvent[];
};

export type SentEmail = {
  id: string;
  shipmentId: string;
  reference: string;
  kind: OutboundKind;
  cycle: number;
  from: string;
  to: string;
  subject: string;
  body: string;
  edited: boolean;
  sentAt: string;
};

export type ReviewRequest = {
  issueKey: string;
  action: ReviewActionName;
  value?: string;
  note?: string;
};

export type SampleEmail = {
  name: string;
  subject: string;
  from: string;
  inReplyTo?: string | null;
  attachments: string[];
};

export type EmailUploadResult = {
  shipmentId: string;
  emailId: string;
  cycle: number;
  duplicate: boolean;
};

export type DeleteShipmentResult = {
  deleted: true;
  shipmentId: string;
  reference: string;
  filesDeleted: number;
};

export type Metrics = {
  northStar: { name: string; value: number | null };
  shipments: number;
  byStatus: Partial<Record<ShipmentStatus, number>>;
  needsReview: number;
  replies: { sent: number; unedited: number; edited: number };
  averageCycles: number | null;
};
