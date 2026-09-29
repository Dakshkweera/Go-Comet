import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { asc, desc, eq } from "drizzle-orm";
import type { Discrepancy, ValidationResult } from "@nova/contracts";
import {
  customers,
  decisions,
  documents,
  pipelineRuns,
  pipelineStageRuns,
  validationResults,
  type NovaDb,
} from "@nova/db";
import { loadRules } from "./customers.js";
import { loadExtraction, newId } from "./orchestrator.js";

export const SUPPORTED_MIME_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export async function createRun(
  db: NovaDb,
  uploadDir: string,
  file: { buffer: Buffer; filename: string; mimeType: string },
) {
  const documentId = newId("doc");
  const runId = newId("run");
  const storagePath = join(uploadDir, `${documentId}.${SUPPORTED_MIME_TYPES[file.mimeType]}`);
  await mkdir(uploadDir, { recursive: true });
  await writeFile(storagePath, file.buffer);

  const contentHash = createHash("sha256").update(file.buffer).digest("hex");
  const duplicate = db
    .select({ id: pipelineRuns.id })
    .from(documents)
    .innerJoin(pipelineRuns, eq(pipelineRuns.documentId, documents.id))
    .where(eq(documents.contentHash, contentHash))
    .get();

  db.transaction((tx) => {
    tx.insert(documents)
      .values({
        id: documentId,
        originalFilename: file.filename.replace(/[^\w.\- ]/g, "_").slice(0, 200),
        mimeType: file.mimeType,
        fileSize: file.buffer.length,
        storagePath,
        contentHash,
      })
      .run();
    tx.insert(pipelineRuns)
      .values({ id: runId, documentId, status: "RECEIVED", currentStage: "RECEIVED" })
      .run();
  });
  return { runId, duplicateOfRunId: duplicate?.id ?? null };
}

export function listRuns(db: NovaDb) {
  return db
    .select({
      id: pipelineRuns.id,
      filename: documents.originalFilename,
      status: pipelineRuns.status,
      decision: pipelineRuns.finalDecision,
      createdAt: pipelineRuns.createdAt,
    })
    .from(pipelineRuns)
    .innerJoin(documents, eq(documents.id, pipelineRuns.documentId))
    .orderBy(desc(pipelineRuns.createdAt))
    .limit(50)
    .all();
}

export function getRun(db: NovaDb, runId: string) {
  const run = db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId)).get();
  if (!run) return null;
  const doc = db.select().from(documents).where(eq(documents.id, run.documentId)).get()!;
  const customer = run.customerId
    ? db.select().from(customers).where(eq(customers.id, run.customerId)).get()
    : undefined;
  const decision = db.select().from(decisions).where(eq(decisions.runId, runId)).get();

  return {
    id: run.id,
    status: run.status,
    currentStage: run.currentStage,
    createdAt: run.createdAt,
    completedAt: run.completedAt,
    document: { filename: doc.originalFilename, mimeType: doc.mimeType, size: doc.fileSize },
    extraction: loadExtraction(db, runId),
    customer: run.customerResolutionStatus
      ? {
          status: run.customerResolutionStatus,
          name: customer?.name ?? null,
          reason: run.customerResolutionReason,
        }
      : null,
    rules: run.customerId ? loadRules(db, run.customerId) : [],
    validations: db
      .select()
      .from(validationResults)
      .where(eq(validationResults.runId, runId))
      .all()
      .map(({ fieldName, id: _id, runId: _runId, createdAt: _c, ...v }) => ({
        field: fieldName,
        ...v,
      })) as ValidationResult[],
    decision: decision
      ? {
          decision: decision.decision,
          reasoning: decision.reasoning,
          discrepancies: JSON.parse(decision.discrepanciesJson) as Discrepancy[],
          amendmentDraft: decision.amendmentDraft,
        }
      : null,
    error: run.errorCode ? { code: run.errorCode, message: run.errorMessage } : null,
    attempts: db
      .select({
        stage: pipelineStageRuns.stage,
        attempt: pipelineStageRuns.attempt,
        status: pipelineStageRuns.status,
        errorMessage: pipelineStageRuns.errorMessage,
      })
      .from(pipelineStageRuns)
      .where(eq(pipelineStageRuns.runId, runId))
      .orderBy(asc(pipelineStageRuns.startedAt))
      .all(),
  };
}

export type RunView = NonNullable<ReturnType<typeof getRun>>;
