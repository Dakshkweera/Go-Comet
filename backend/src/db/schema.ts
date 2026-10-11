import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const now = () => new Date().toISOString();
const createdAt = () => text("created_at").notNull().$defaultFn(now);
const updatedAt = () => text("updated_at").notNull().$defaultFn(now);

export const customers = sqliteTable("customers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  normalizedName: text("normalized_name").notNull().unique(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const customerRules = sqliteTable(
  "customer_rules",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id),
    field: text("field").notNull(),
    operator: text("operator").notNull(),
    expectedValue: text("expected_value"),
    minValue: real("min_value"),
    maxValue: real("max_value"),
    unit: text("unit"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("idx_customer_rules_customer").on(t.customerId)],
);

export const documents = sqliteTable(
  "documents",
  {
    id: text("id").primaryKey(),
    originalFilename: text("original_filename").notNull(),
    mimeType: text("mime_type").notNull(),
    fileSize: integer("file_size").notNull(),
    storagePath: text("storage_path").notNull(),
    contentHash: text("content_hash"),
    shipmentId: text("shipment_id"),
    inboundEmailId: text("inbound_email_id"),
    cycle: integer("cycle"),
    docType: text("doc_type"),
    docTypeReason: text("doc_type_reason"),
    unchangedFromDocumentId: text("unchanged_from_document_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("idx_documents_shipment").on(t.shipmentId),
    uniqueIndex("idx_documents_email_hash").on(t.inboundEmailId, t.contentHash),
  ],
);

export const pipelineRuns = sqliteTable(
  "pipeline_runs",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id),
    status: text("status").notNull(),
    currentStage: text("current_stage").notNull(),
    customerId: text("customer_id").references(() => customers.id),
    customerResolutionStatus: text("customer_resolution_status"),
    customerResolutionReason: text("customer_resolution_reason"),
    finalDecision: text("final_decision"),
    finalReasoning: text("final_reasoning"),
    minConfidence: real("min_confidence"),
    attemptCount: integer("attempt_count").notNull().default(0),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    completedAt: text("completed_at"),
  },
  (t) => [
    index("idx_pipeline_runs_status").on(t.status),
    index("idx_pipeline_runs_decision").on(t.finalDecision),
    index("idx_pipeline_runs_created_at").on(t.createdAt),
    index("idx_pipeline_runs_customer").on(t.customerId),
  ],
);

export const extractions = sqliteTable(
  "extractions",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => pipelineRuns.id),
    fieldName: text("field_name").notNull(),
    valueText: text("value_text"),
    valueNumber: real("value_number"),
    unit: text("unit"),
    confidence: real("confidence").notNull(),
    evidence: text("evidence"),
    candidatesJson: text("candidates_json"),
    evidenceStatus: text("evidence_status"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("idx_extractions_run_field").on(t.runId, t.fieldName)],
);

export const validationResults = sqliteTable(
  "validation_results",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => pipelineRuns.id),
    fieldName: text("field_name").notNull(),
    status: text("status").notNull(),
    foundText: text("found_text"),
    foundNumber: real("found_number"),
    expectedText: text("expected_text"),
    expectedNumber: real("expected_number"),
    expectedMin: real("expected_min"),
    expectedMax: real("expected_max"),
    unit: text("unit"),
    confidence: real("confidence"),
    ruleId: text("rule_id").references(() => customerRules.id),
    ruleOperator: text("rule_operator"),
    reason: text("reason").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("idx_validation_run").on(t.runId), index("idx_validation_status").on(t.status)],
);

export const decisions = sqliteTable("decisions", {
  id: text("id").primaryKey(),
  runId: text("run_id")
    .notNull()
    .unique()
    .references(() => pipelineRuns.id),
  decision: text("decision").notNull(),
  reasoning: text("reasoning").notNull(),
  discrepanciesJson: text("discrepancies_json").notNull().default("[]"),
  amendmentDraft: text("amendment_draft"),
  createdAt: createdAt(),
});

export const pipelineStageRuns = sqliteTable(
  "pipeline_stage_runs",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => pipelineRuns.id),
    stage: text("stage").notNull(),
    attempt: integer("attempt").notNull(),
    status: text("status").notNull(),
    startedAt: text("started_at").notNull().$defaultFn(now),
    completedAt: text("completed_at"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    metadataJson: text("metadata_json"),
  },
  (t) => [index("idx_stage_runs_run").on(t.runId)],
);

export const shipments = sqliteTable(
  "shipments",
  {
    id: text("id").primaryKey(),
    reference: text("reference").notNull().unique(),
    subject: text("subject").notNull(),
    supplierName: text("supplier_name"),
    supplierAddress: text("supplier_address").notNull(),
    customerId: text("customer_id").references(() => customers.id),
    customerResolutionStatus: text("customer_resolution_status"),
    customerResolutionReason: text("customer_resolution_reason"),
    status: text("status").notNull(),
    stage: text("stage"),
    decision: text("decision"),
    headline: text("headline"),
    reasoning: text("reasoning"),
    cycle: integer("cycle").notNull().default(1),
    evaluationHash: text("evaluation_hash"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    evaluatedAt: text("evaluated_at"),
  },
  (t) => [
    index("idx_shipments_status").on(t.status),
    index("idx_shipments_customer").on(t.customerId),
    index("idx_shipments_created_at").on(t.createdAt),
  ],
);

export const inboundEmails = sqliteTable(
  "inbound_emails",
  {
    id: text("id").primaryKey(),
    shipmentId: text("shipment_id")
      .notNull()
      .references(() => shipments.id),
    cycle: integer("cycle").notNull(),
    messageId: text("message_id").notNull().unique(),
    fromName: text("from_name"),
    fromAddress: text("from_address").notNull(),
    replyTo: text("reply_to"),
    toAddress: text("to_address"),
    subject: text("subject").notNull(),
    bodyText: text("body_text").notNull().default(""),
    sentAt: text("sent_at"),
    receivedAt: text("received_at").notNull().$defaultFn(now),
    inReplyTo: text("in_reply_to"),
    referencesJson: text("references_json").notNull().default("[]"),
    rawPath: text("raw_path").notNull(),
  },
  (t) => [index("idx_inbound_emails_shipment").on(t.shipmentId)],
);

export const shipmentFields = sqliteTable(
  "shipment_fields",
  {
    id: text("id").primaryKey(),
    shipmentId: text("shipment_id")
      .notNull()
      .references(() => shipments.id),
    fieldName: text("field_name").notNull(),
    state: text("state").notNull(),
    ruleStatus: text("rule_status").notNull(),
    consistency: text("consistency").notNull(),
    ownerDocType: text("owner_doc_type"),
    valueText: text("value_text"),
    valueNumber: real("value_number"),
    unit: text("unit"),
    valueSource: text("value_source"),
    sourceDocumentId: text("source_document_id"),
    ruleId: text("rule_id"),
    expectedLabel: text("expected_label"),
    confidence: real("confidence"),
    reason: text("reason").notNull(),
    observationsJson: text("observations_json").notNull().default("[]"),
  },
  (t) => [uniqueIndex("idx_shipment_fields_field").on(t.shipmentId, t.fieldName)],
);

export const shipmentIssues = sqliteTable(
  "shipment_issues",
  {
    id: text("id").primaryKey(),
    shipmentId: text("shipment_id")
      .notNull()
      .references(() => shipments.id),
    issueKey: text("issue_key").notNull(),
    cycle: integer("cycle").notNull(),
    stage: text("stage").notNull(),
    severity: text("severity").notNull(),
    kind: text("kind").notNull(),
    fieldName: text("field_name"),
    documentIdsJson: text("document_ids_json").notNull().default("[]"),
    found: text("found"),
    expected: text("expected"),
    referenceJson: text("reference_json"),
    message: text("message").notNull(),
    request: text("request").notNull(),
    allowedActionsJson: text("allowed_actions_json").notNull().default("[]"),
  },
  (t) => [
    uniqueIndex("idx_shipment_issues_cycle_key").on(t.shipmentId, t.cycle, t.issueKey),
    index("idx_shipment_issues_kind").on(t.kind),
  ],
);

export const reviewActions = sqliteTable(
  "review_actions",
  {
    id: text("id").primaryKey(),
    shipmentId: text("shipment_id")
      .notNull()
      .references(() => shipments.id),
    cycle: integer("cycle").notNull(),
    issueKey: text("issue_key").notNull(),
    action: text("action").notNull(),
    valueText: text("value_text"),
    note: text("note"),
    actor: text("actor").notNull().default("CG operator"),
    createdAt: createdAt(),
  },
  (t) => [index("idx_review_actions_shipment").on(t.shipmentId)],
);

export const outboundEmails = sqliteTable(
  "outbound_emails",
  {
    id: text("id").primaryKey(),
    shipmentId: text("shipment_id")
      .notNull()
      .references(() => shipments.id),
    cycle: integer("cycle").notNull(),
    stage: text("stage").notNull(),
    kind: text("kind").notNull(),
    version: integer("version").notNull(),
    fromAddress: text("from_address").notNull(),
    toAddress: text("to_address").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    generatedBody: text("generated_body").notNull(),
    status: text("status").notNull(),
    evaluationHash: text("evaluation_hash").notNull(),
    inReplyTo: text("in_reply_to"),
    messageId: text("message_id").unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    sentAt: text("sent_at"),
  },
  (t) => [
    index("idx_outbound_emails_shipment").on(t.shipmentId),
    index("idx_outbound_emails_status").on(t.status),
  ],
);

export const shipmentEvents = sqliteTable(
  "shipment_events",
  {
    id: text("id").primaryKey(),
    shipmentId: text("shipment_id")
      .notNull()
      .references(() => shipments.id),
    type: text("type").notNull(),
    message: text("message").notNull(),
    dataJson: text("data_json"),
    createdAt: createdAt(),
  },
  (t) => [index("idx_shipment_events_shipment").on(t.shipmentId)],
);
