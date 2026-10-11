import { asc, eq, sql } from "drizzle-orm";
import {
  docTypeSchema,
  type DocType,
  type ExtractionField,
  type ExtractionResult,
  type IssueResolution,
  type ShipmentDocument,
} from "../../schemas/index.js";
import { documents, pipelineRuns, type NovaDb } from "../../db/index.js";
import { loadExtraction } from "../pipeline.service.js";
import { isTyped, parseIssueKey } from "../validation/index.js";

export type LoadedDocument = ShipmentDocument & {
  runId: string;
  runStatus: string;
  mimeType: string;
  size: number;
  docTypeReason: string | null;
  inboundEmailId: string | null;
  unchangedFromDocumentId: string | null;
  createdAt: string;
};

export function loadShipmentDocuments(db: NovaDb, shipmentId: string): LoadedDocument[] {
  return db
    .select({ doc: documents, run: pipelineRuns })
    .from(documents)
    .innerJoin(pipelineRuns, eq(pipelineRuns.documentId, documents.id))
    .where(eq(documents.shipmentId, shipmentId))
    .orderBy(asc(documents.cycle), sql`${documents}.rowid`)
    .all()
    .map(({ doc, run }) => {
      const done = run.status === "COMPLETED" || run.status === "FAILED";
      const extraction = done && !run.errorCode ? loadExtraction(db, run.id) : null;
      const failed = done && !extraction;
      const type = docTypeSchema.safeParse(doc.docType);
      return {
        id: doc.id,
        filename: doc.originalFilename,
        docType: type.success ? type.data : extraction ? "OTHER" : null,
        cycle: doc.cycle ?? 1,
        status: failed ? "failed" : extraction ? "extracted" : "pending",
        error: failed
          ? {
              code: run.errorCode ?? "EXTRACTION_FAILED",
              message: run.errorMessage ?? "The document could not be read.",
            }
          : null,
        extraction,
        unchanged: Boolean(doc.unchangedFromDocumentId),
        runId: run.id,
        runStatus: run.status,
        mimeType: doc.mimeType,
        size: doc.fileSize,
        docTypeReason: doc.docTypeReason,
        inboundEmailId: doc.inboundEmailId,
        unchangedFromDocumentId: doc.unchangedFromDocumentId,
        createdAt: doc.createdAt,
      };
    });
}

/** Latest version of each typed document, every unclassified file, failures from this cycle only. */
export function selectCurrent<T extends ShipmentDocument>(docs: T[], cycle: number): T[] {
  const latest = new Map<DocType, number>();
  for (const d of docs) {
    if (d.status === "extracted" && isTyped(d.docType)) {
      latest.set(d.docType, Math.max(latest.get(d.docType) ?? 0, d.cycle));
    }
  }
  return docs.filter((d) => {
    if (d.status === "failed" || d.status === "pending") return d.cycle === cycle;
    if (!isTyped(d.docType)) return true;
    return d.cycle === latest.get(d.docType);
  });
}

const VERIFIABLE = new Set(["missing_field", "unreliable_value", "duplicate_type_conflict"]);

export function parseVerifiedValue(
  field: ExtractionField,
  value: string,
  fallbackUnit: string | null,
) {
  if (field !== "gross_weight") return { value: value.trim(), unit: null };
  const match = value.trim().match(/^(\d[\d,]*(?:\.\d+)?)\s*([a-z]+)?$/i);
  if (!match) return null;
  return { value: Number(match[1]!.replace(/,/g, "")), unit: match[2] ?? fallbackUnit ?? "kg" };
}

/** CG-verified readings replace the extracted ones for checking; the stored extraction is untouched. */
export function applyVerifiedValues<T extends ShipmentDocument>(
  docs: T[],
  actions: Map<string, IssueResolution>,
) {
  const verified = new Set<string>();
  const overrides = new Map<string, Partial<ExtractionResult>>();
  for (const [key, resolution] of actions) {
    const { kind, field, documentIds } = parseIssueKey(key);
    if (resolution.action !== "clarify" || !VERIFIABLE.has(kind) || !field) continue;
    for (const id of documentIds) {
      const doc = docs.find((d) => d.id === id);
      const current = doc?.extraction?.[field];
      if (!doc || !current) continue;
      const unit = "unit" in current ? (current.unit ?? null) : null;
      const parsed = resolution.value
        ? parseVerifiedValue(field, resolution.value, unit)
        : current.value === null
          ? null
          : { value: current.value, unit };
      if (!parsed) continue;
      const evidence = `Verified by CG operator${resolution.note ? `: ${resolution.note}` : ""}`;
      const entry = {
        value: parsed.value,
        confidence: 1,
        evidence,
        candidates: null,
        evidenceStatus: "supported" as const,
        ...(field === "gross_weight" ? { unit: parsed.unit } : {}),
      };
      overrides.set(id, { ...overrides.get(id), [field]: entry });
      verified.add(`${id}:${field}`);
    }
  }
  const documents = docs.map((d) =>
    overrides.has(d.id) && d.extraction
      ? { ...d, extraction: { ...d.extraction, ...overrides.get(d.id) } as ExtractionResult }
      : d,
  );
  return { documents, verified };
}
