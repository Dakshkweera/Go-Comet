import { and, eq } from "drizzle-orm";
import {
  DOC_TYPE_LABELS,
  FIELD_LABELS,
  type DocType,
  type ExtractionField,
  type IssueKind,
  type ReviewRequest,
} from "../../schemas/index.js";
import {
  documents,
  pipelineRuns,
  reviewActions,
  shipmentIssues,
  shipments,
  type NovaDb,
} from "../../db/index.js";
import { newId } from "../pipeline.service.js";
import { actionRule } from "../routing/index.js";
import { parseVerifiedValue } from "./documents.js";
import { ShipmentError } from "./errors.js";
import { recordEvent } from "./events.js";
import { SENT_STATUSES, type ShipmentService } from "./shipment.service.js";

function reviewableShipment(db: NovaDb, shipmentId: string) {
  const shipment = db.select().from(shipments).where(eq(shipments.id, shipmentId)).get();
  if (!shipment) throw new ShipmentError("SHIPMENT_NOT_FOUND", "Shipment not found.");
  if (SENT_STATUSES.has(shipment.status)) {
    throw new ShipmentError("ALREADY_SENT", "The reply for this cycle was already sent.");
  }
  if (!["NEEDS_REVIEW", "AMENDMENT_READY", "APPROVAL_READY"].includes(shipment.status)) {
    throw new ShipmentError("SHIPMENT_PROCESSING", "The shipment is still being processed.");
  }
  return shipment;
}

export function reviewIssue(
  db: NovaDb,
  service: ShipmentService,
  shipmentId: string,
  request: ReviewRequest,
) {
  const shipment = reviewableShipment(db, shipmentId);
  const issue = db
    .select()
    .from(shipmentIssues)
    .where(
      and(
        eq(shipmentIssues.shipmentId, shipmentId),
        eq(shipmentIssues.cycle, shipment.cycle),
        eq(shipmentIssues.issueKey, request.issueKey),
      ),
    )
    .get();
  if (!issue) throw new ShipmentError("ISSUE_NOT_FOUND", "This item is no longer open.");
  if (!(JSON.parse(issue.allowedActionsJson) as string[]).includes(request.action)) {
    throw new ShipmentError("INVALID_ACTION", `"${request.action}" is not possible for this item.`);
  }

  const rule = actionRule(issue.kind as IssueKind, request.action);
  const field = issue.fieldName as ExtractionField | null;
  if (rule.value === "required" && !request.value) {
    throw new ShipmentError(
      "VALUE_REQUIRED",
      "Enter the value you verified on the original document.",
    );
  }
  if (rule.note === "required" && !request.note) {
    throw new ShipmentError("NOTE_REQUIRED", "Add a short note explaining the decision.");
  }
  const value = rule.value === "none" ? null : (request.value ?? null);
  if (value && field && !parseVerifiedValue(field, value, "kg")) {
    throw new ShipmentError("VALUE_REQUIRED", "Enter the weight with its unit, e.g. 900 kg.");
  }

  db.insert(reviewActions)
    .values({
      id: newId("act"),
      shipmentId,
      cycle: shipment.cycle,
      issueKey: issue.issueKey,
      action: request.action,
      valueText: value,
      note: request.note ?? null,
    })
    .run();
  const subject = field ? FIELD_LABELS[field] : issue.kind.replaceAll("_", " ");
  recordEvent(
    db,
    shipmentId,
    "review_action",
    request.action === "amend"
      ? `CG will ask the supplier about: ${subject}.`
      : `CG clarified ${subject}${value ? ` as ${value}` : ""}${request.note ? ` (${request.note})` : ""}.`,
    { issueKey: issue.issueKey, action: request.action },
  );
  service.evaluate(shipmentId);
}

export function setDocumentType(
  db: NovaDb,
  service: ShipmentService,
  shipmentId: string,
  documentId: string,
  change: { docType: DocType; note?: string },
) {
  const shipment = reviewableShipment(db, shipmentId);
  const doc = db
    .select({ doc: documents, run: pipelineRuns })
    .from(documents)
    .innerJoin(pipelineRuns, eq(pipelineRuns.documentId, documents.id))
    .where(and(eq(documents.id, documentId), eq(documents.shipmentId, shipmentId)))
    .get();
  if (!doc) throw new ShipmentError("DOCUMENT_NOT_FOUND", "Document not found in this shipment.");
  if (doc.run.errorCode) {
    throw new ShipmentError(
      "INVALID_ACTION",
      "This file could not be read, so it has no type to set.",
    );
  }

  db.update(documents)
    .set({
      docType: change.docType,
      docTypeReason: `Set by CG operator${change.note ? `: ${change.note}` : ""}`,
    })
    .where(eq(documents.id, documentId))
    .run();
  db.insert(reviewActions)
    .values({
      id: newId("act"),
      shipmentId,
      cycle: shipment.cycle,
      issueKey: `set_type:-:${documentId}`,
      action: "set_type",
      valueText: change.docType,
      note: change.note ?? null,
    })
    .run();
  recordEvent(
    db,
    shipmentId,
    "document_type_set",
    `CG set ${doc.doc.originalFilename} to ${DOC_TYPE_LABELS[change.docType].toLowerCase()}.`,
  );
  service.evaluate(shipmentId);
}
