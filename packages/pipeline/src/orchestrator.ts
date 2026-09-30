import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  REQUIRED_FIELDS,
  type ExtractionResult,
  type ExtractorAgent,
  type PipelineError,
  type Router,
  type Validator,
} from "@nova/contracts";
import {
  decisions,
  documents,
  extractions,
  pipelineRuns,
  pipelineStageRuns,
  validationResults,
  type NovaDb,
} from "@nova/db";
import { LlmError } from "@nova/llm";
import { loadRules, resolveCustomer } from "./customers.js";

export const newId = (prefix: string) => `${prefix}_${randomUUID()}`;
const now = () => new Date().toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type PipelineDeps = {
  db: NovaDb;
  extractor: ExtractorAgent;
  validator: Validator;
  router: Router;
  minConfidence: number;
  maxAttempts: number;
  retryDelayMs?: number;
};

export function loadExtraction(db: NovaDb, runId: string): ExtractionResult | null {
  const rows = db.select().from(extractions).where(eq(extractions.runId, runId)).all();
  if (rows.length < REQUIRED_FIELDS.length) return null;
  const byField = Object.fromEntries(rows.map((r) => [r.fieldName, r]));
  return Object.fromEntries(
    REQUIRED_FIELDS.map((field) => {
      const r = byField[field]!;
      return [
        field,
        {
          value: field === "gross_weight" ? r.valueNumber : r.valueText,
          confidence: r.confidence,
          evidence: r.evidence,
          candidates: r.candidatesJson ? JSON.parse(r.candidatesJson) : null,
          ...(r.evidenceStatus ? { evidenceStatus: r.evidenceStatus } : {}),
          ...(field === "gross_weight" ? { unit: r.unit } : {}),
        },
      ];
    }),
  ) as ExtractionResult;
}

export function createPipeline(deps: PipelineDeps) {
  const { db } = deps;
  const active = new Set<string>();

  const updateRun = (runId: string, values: Partial<typeof pipelineRuns.$inferInsert>) =>
    db
      .update(pipelineRuns)
      .set({ ...values, updatedAt: now() })
      .where(eq(pipelineRuns.id, runId))
      .run();

  async function extractWithRetry(runId: string): Promise<ExtractionResult | PipelineError> {
    const run = db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId)).get()!;
    const doc = db.select().from(documents).where(eq(documents.id, run.documentId)).get()!;
    let lastError: PipelineError | null = null;
    db.update(pipelineStageRuns)
      .set({
        status: "failed",
        completedAt: now(),
        errorCode: "INTERRUPTED",
        errorMessage: "The process stopped before this attempt finished.",
      })
      .where(and(eq(pipelineStageRuns.runId, runId), eq(pipelineStageRuns.status, "running")))
      .run();

    for (let attempt = run.attemptCount + 1; attempt <= deps.maxAttempts; attempt++) {
      const stageId = newId("stage");
      const started = Date.now();
      db.insert(pipelineStageRuns)
        .values({ id: stageId, runId, stage: "EXTRACTING", attempt, status: "running" })
        .run();
      updateRun(runId, { status: "PROCESSING", currentStage: "EXTRACTING", attemptCount: attempt });

      try {
        const result = await deps.extractor.extract({
          runId,
          documentId: doc.id,
          filePath: doc.storagePath,
          mimeType: doc.mimeType,
        });
        db.transaction((tx) => {
          for (const field of REQUIRED_FIELDS) {
            const f = result[field];
            tx.insert(extractions)
              .values({
                id: newId("ext"),
                runId,
                fieldName: field,
                valueText: typeof f.value === "string" ? f.value : null,
                valueNumber: typeof f.value === "number" ? f.value : null,
                unit: "unit" in f ? (f.unit ?? null) : null,
                confidence: f.confidence,
                evidence: f.evidence ?? null,
                candidatesJson: f.candidates ? JSON.stringify(f.candidates) : null,
                evidenceStatus: f.evidenceStatus ?? null,
              })
              .run();
          }
          tx.update(pipelineStageRuns)
            .set({
              status: "succeeded",
              completedAt: now(),
              metadataJson: JSON.stringify({ latencyMs: Date.now() - started }),
            })
            .where(eq(pipelineStageRuns.id, stageId))
            .run();
          tx.update(pipelineRuns)
            .set({ currentStage: "EXTRACTED", updatedAt: now() })
            .where(eq(pipelineRuns.id, runId))
            .run();
        });
        return result;
      } catch (err) {
        const retryable = err instanceof LlmError ? err.retryable : false;
        const code =
          err instanceof Error && "code" in err && typeof err.code === "string"
            ? err.code
            : "EXTRACTION_FAILED";
        const message = err instanceof Error ? err.message : String(err);
        lastError = { code, message, stage: "EXTRACTING", retryable, attempt };
        db.update(pipelineStageRuns)
          .set({ status: "failed", completedAt: now(), errorCode: code, errorMessage: message })
          .where(eq(pipelineStageRuns.id, stageId))
          .run();
        if (!retryable) break;
        if (attempt < deps.maxAttempts)
          await sleep((deps.retryDelayMs ?? 1000) * 2 ** (attempt - 1));
      }
    }
    return (
      lastError ?? {
        code: "RETRIES_EXHAUSTED",
        message: "Extraction attempts were exhausted.",
        stage: "EXTRACTING",
        retryable: false,
      }
    );
  }

  async function process(runId: string) {
    const run = db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId)).get();
    if (!run || run.status === "COMPLETED") return;

    let extraction = loadExtraction(db, runId);
    const errors: PipelineError[] = [];
    if (!extraction) {
      const outcome = await extractWithRetry(runId);
      if ("code" in outcome) errors.push(outcome);
      else extraction = outcome;
    }

    const resolution = extraction ? resolveCustomer(db, extraction.consignee_name.value) : null;
    const rules =
      resolution?.status === "resolved" && resolution.customerId
        ? loadRules(db, resolution.customerId)
        : [];
    const validations =
      extraction && resolution?.customerId && rules.length > 0
        ? deps.validator.validate({
            runId,
            extraction,
            customer: { id: resolution.customerId, name: resolution.customerName! },
            rules,
          })
        : [];
    const decision = deps.router.decide({
      runId,
      customerResolution: resolution,
      rulesAvailable: rules.length > 0,
      extraction,
      validations,
      pipelineErrors: errors,
    });

    db.transaction((tx) => {
      tx.delete(validationResults).where(eq(validationResults.runId, runId)).run();
      tx.delete(decisions).where(eq(decisions.runId, runId)).run();
      for (const { field, ...v } of validations) {
        tx.insert(validationResults)
          .values({ id: newId("val"), runId, fieldName: field, ...v })
          .run();
      }
      tx.insert(decisions)
        .values({
          id: newId("decision"),
          runId,
          decision: decision.decision,
          reasoning: decision.reasoning,
          discrepanciesJson: JSON.stringify(decision.discrepancies),
          amendmentDraft: decision.amendmentDraft,
        })
        .run();
      tx.update(pipelineRuns)
        .set({
          status: "COMPLETED",
          currentStage: "COMPLETED",
          customerId: resolution?.customerId ?? null,
          customerResolutionStatus: resolution?.status ?? null,
          customerResolutionReason: resolution?.reason ?? null,
          finalDecision: decision.decision,
          finalReasoning: decision.reasoning,
          minConfidence: deps.minConfidence,
          errorCode: errors[0]?.code ?? null,
          errorMessage: errors[0]?.message ?? null,
          updatedAt: now(),
          completedAt: now(),
        })
        .where(eq(pipelineRuns.id, runId))
        .run();
    });
  }

  return {
    async run(runId: string) {
      if (active.has(runId)) return;
      active.add(runId);
      try {
        await process(runId);
      } catch (err) {
        updateRun(runId, {
          status: "FAILED",
          errorCode: "PIPELINE_ERROR",
          errorMessage: err instanceof Error ? err.message : String(err),
        });
        throw err;
      } finally {
        active.delete(runId);
      }
    },

    pendingRunIds(): string[] {
      return db
        .select({ id: pipelineRuns.id })
        .from(pipelineRuns)
        .where(inArray(pipelineRuns.status, ["RECEIVED", "PROCESSING"]))
        .all()
        .map((r) => r.id);
    },
  };
}

export type Pipeline = ReturnType<typeof createPipeline>;
