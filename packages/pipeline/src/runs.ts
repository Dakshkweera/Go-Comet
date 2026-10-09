import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import {
  REQUIRED_FIELDS,
  type Discrepancy,
  type ExtractionField,
  type ValidationResult,
} from "../../contracts/src/index.js";
import {
  customers,
  decisions,
  documents,
  extractions,
  pipelineRuns,
  pipelineStageRuns,
  validationResults,
  type NovaDb,
} from "../../db/src/index.js";
import { assessField, type FieldReliability } from "../../validation/src/index.js";
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

export type DeleteRunResult =
  | { status: "deleted"; runId: string; documentId: string; fileDeleted: boolean }
  | { status: "not_found" }
  | { status: "in_progress" };

const isInside = (dir: string, path: string) => {
  const rel = relative(resolve(dir), resolve(path));
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
};

export async function deleteRun(
  db: NovaDb,
  uploadDir: string,
  runId: string,
): Promise<DeleteRunResult> {
  const run = db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId)).get();
  if (!run) return { status: "not_found" };
  if (run.status === "RECEIVED" || run.status === "PROCESSING") return { status: "in_progress" };

  const doc = db.select().from(documents).where(eq(documents.id, run.documentId)).get();
  const sharedDocument = db
    .select({ id: pipelineRuns.id })
    .from(pipelineRuns)
    .where(and(eq(pipelineRuns.documentId, run.documentId), ne(pipelineRuns.id, runId)))
    .get();

  db.transaction((tx) => {
    tx.delete(extractions).where(eq(extractions.runId, runId)).run();
    tx.delete(validationResults).where(eq(validationResults.runId, runId)).run();
    tx.delete(decisions).where(eq(decisions.runId, runId)).run();
    tx.delete(pipelineStageRuns).where(eq(pipelineStageRuns.runId, runId)).run();
    tx.delete(pipelineRuns).where(eq(pipelineRuns.id, runId)).run();
    if (!sharedDocument) tx.delete(documents).where(eq(documents.id, run.documentId)).run();
  });

  let fileDeleted = false;
  if (doc && !sharedDocument && isInside(uploadDir, doc.storagePath)) {
    fileDeleted = await rm(doc.storagePath, { force: true }).then(
      () => true,
      () => false,
    );
  }
  return { status: "deleted", runId, documentId: run.documentId, fileDeleted };
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

export function getRun(db: NovaDb, runId: string, configuredMinConfidence: number) {
  const run = db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId)).get();
  if (!run) return null;
  const doc = db.select().from(documents).where(eq(documents.id, run.documentId)).get()!;
  const customer = run.customerId
    ? db.select().from(customers).where(eq(customers.id, run.customerId)).get()
    : undefined;
  const decision = db.select().from(decisions).where(eq(decisions.runId, runId)).get();
  const extraction = loadExtraction(db, runId);
  const minConfidence = run.minConfidence ?? configuredMinConfidence;

  return {
    id: run.id,
    status: run.status,
    currentStage: run.currentStage,
    createdAt: run.createdAt,
    completedAt: run.completedAt,
    document: { filename: doc.originalFilename, mimeType: doc.mimeType, size: doc.fileSize },
    extraction,
    reliability: extraction
      ? {
          minConfidence,
          fields: Object.fromEntries(
            REQUIRED_FIELDS.map((f) => [f, assessField(f, extraction[f], minConfidence)]),
          ) as Record<ExtractionField, FieldReliability>,
        }
      : null,
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
