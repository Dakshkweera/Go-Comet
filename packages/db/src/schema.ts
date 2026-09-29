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

export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  originalFilename: text("original_filename").notNull(),
  mimeType: text("mime_type").notNull(),
  fileSize: integer("file_size").notNull(),
  storagePath: text("storage_path").notNull(),
  contentHash: text("content_hash"),
  createdAt: createdAt(),
});

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
