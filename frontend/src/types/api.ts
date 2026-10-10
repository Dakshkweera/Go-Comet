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
