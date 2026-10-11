import { rm } from "node:fs/promises";
import { eq, inArray } from "drizzle-orm";
import {
  decisions,
  documents,
  extractions,
  inboundEmails,
  outboundEmails,
  pipelineRuns,
  pipelineStageRuns,
  reviewActions,
  shipmentEvents,
  shipmentFields,
  shipmentIssues,
  shipments,
  validationResults,
  type NovaDb,
} from "../../db/index.js";
import { isInside } from "../run.service.js";
import { ShipmentError } from "./errors.js";

export type StorageDirs = { uploadDir: string; emailDir: string };

/** Removes a shipment with its emails, attachments, runs and stored files, so it can be received again. */
export async function deleteShipment(db: NovaDb, dirs: StorageDirs, shipmentId: string) {
  const shipment = db.select().from(shipments).where(eq(shipments.id, shipmentId)).get();
  if (!shipment) throw new ShipmentError("SHIPMENT_NOT_FOUND", "Shipment not found.");
  if (shipment.status === "RECEIVED" || shipment.status === "PROCESSING") {
    throw new ShipmentError(
      "SHIPMENT_PROCESSING",
      "The shipment is still being processed; try again when it finishes.",
    );
  }

  const docs = db.select().from(documents).where(eq(documents.shipmentId, shipmentId)).all();
  const emails = db
    .select({ rawPath: inboundEmails.rawPath })
    .from(inboundEmails)
    .where(eq(inboundEmails.shipmentId, shipmentId))
    .all();
  const documentIds = docs.map((d) => d.id);
  const runIds = documentIds.length
    ? db
        .select({ id: pipelineRuns.id })
        .from(pipelineRuns)
        .where(inArray(pipelineRuns.documentId, documentIds))
        .all()
        .map((r) => r.id)
    : [];

  db.transaction((tx) => {
    if (runIds.length) {
      tx.delete(extractions).where(inArray(extractions.runId, runIds)).run();
      tx.delete(validationResults).where(inArray(validationResults.runId, runIds)).run();
      tx.delete(decisions).where(inArray(decisions.runId, runIds)).run();
      tx.delete(pipelineStageRuns).where(inArray(pipelineStageRuns.runId, runIds)).run();
      tx.delete(pipelineRuns).where(inArray(pipelineRuns.id, runIds)).run();
    }
    tx.delete(documents).where(eq(documents.shipmentId, shipmentId)).run();
    tx.delete(shipmentEvents).where(eq(shipmentEvents.shipmentId, shipmentId)).run();
    tx.delete(shipmentFields).where(eq(shipmentFields.shipmentId, shipmentId)).run();
    tx.delete(shipmentIssues).where(eq(shipmentIssues.shipmentId, shipmentId)).run();
    tx.delete(reviewActions).where(eq(reviewActions.shipmentId, shipmentId)).run();
    tx.delete(outboundEmails).where(eq(outboundEmails.shipmentId, shipmentId)).run();
    tx.delete(inboundEmails).where(eq(inboundEmails.shipmentId, shipmentId)).run();
    tx.delete(shipments).where(eq(shipments.id, shipmentId)).run();
  });

  const stored = [
    ...docs.filter((d) => isInside(dirs.uploadDir, d.storagePath)).map((d) => d.storagePath),
    ...emails.filter((e) => isInside(dirs.emailDir, e.rawPath)).map((e) => e.rawPath),
  ];
  const removed = await Promise.all(
    stored.map((path) =>
      rm(path, { force: true }).then(
        () => true,
        () => false,
      ),
    ),
  );

  return {
    deleted: true,
    shipmentId,
    reference: shipment.reference,
    filesDeleted: removed.filter(Boolean).length,
  };
}
