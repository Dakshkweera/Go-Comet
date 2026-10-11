import { and, desc, eq } from "drizzle-orm";
import type { DraftUpdate } from "../../schemas/index.js";
import { outboundEmails, shipments, type NovaDb } from "../../db/index.js";
import { ShipmentError } from "./errors.js";
import { recordEvent } from "./events.js";
import { SENT_STATUSES } from "./shipment.service.js";

type Outbound = typeof outboundEmails.$inferSelect;
const now = () => new Date().toISOString();

const currentDraft = (db: Pick<NovaDb, "select">, shipmentId: string) =>
  db
    .select()
    .from(outboundEmails)
    .where(and(eq(outboundEmails.shipmentId, shipmentId), eq(outboundEmails.status, "draft")))
    .get();

export const sentEmailView = (email: Outbound, reference: string) => ({
  id: email.id,
  shipmentId: email.shipmentId,
  reference,
  kind: email.kind,
  cycle: email.cycle,
  from: email.fromAddress,
  to: email.toAddress,
  subject: email.subject,
  body: email.body,
  messageId: email.messageId,
  edited: email.body !== email.generatedBody,
  sentAt: email.sentAt,
  status: "sent (simulated)",
});

/** Saving edits keeps the version; only a regeneration by the agent changes it. */
export function saveDraft(db: NovaDb, shipmentId: string, update: DraftUpdate) {
  const shipment = db.select().from(shipments).where(eq(shipments.id, shipmentId)).get();
  if (!shipment) throw new ShipmentError("SHIPMENT_NOT_FOUND", "Shipment not found.");
  const draft = currentDraft(db, shipmentId);
  if (!draft)
    throw new ShipmentError("DRAFT_NOT_FOUND", "There is no open draft for this shipment.");
  if (draft.version !== update.version) {
    throw new ShipmentError(
      "DRAFT_OUTDATED",
      "The draft changed since you opened it. Please check it again.",
    );
  }
  const changed =
    draft.body !== update.body ||
    draft.subject !== update.subject ||
    (update.to !== undefined && update.to !== draft.toAddress);
  db.update(outboundEmails)
    .set({
      toAddress: update.to ?? draft.toAddress,
      subject: update.subject,
      body: update.body,
      updatedAt: now(),
    })
    .where(eq(outboundEmails.id, draft.id))
    .run();
  if (changed)
    recordEvent(db, shipmentId, "draft_edited", `CG edited draft version ${draft.version}.`);
  return currentDraft(db, shipmentId)!;
}

/** The only path to a sent message: an explicit CG action on the current draft version. */
export function sendDraft(db: NovaDb, mailbox: string, shipmentId: string, version: number) {
  return db.transaction((tx) => {
    const shipment = tx.select().from(shipments).where(eq(shipments.id, shipmentId)).get();
    if (!shipment) throw new ShipmentError("SHIPMENT_NOT_FOUND", "Shipment not found.");
    if (SENT_STATUSES.has(shipment.status)) {
      throw new ShipmentError("ALREADY_SENT", "The reply for this cycle was already sent.");
    }
    if (shipment.status === "NEEDS_REVIEW") {
      throw new ShipmentError(
        "REVIEW_INCOMPLETE",
        "Some items still need your decision before sending.",
      );
    }
    if (shipment.status !== "AMENDMENT_READY" && shipment.status !== "APPROVAL_READY") {
      throw new ShipmentError("SHIPMENT_PROCESSING", "The shipment is still being processed.");
    }
    const draft = currentDraft(tx, shipmentId);
    if (!draft)
      throw new ShipmentError("DRAFT_NOT_FOUND", "There is no open draft for this shipment.");
    if (draft.version !== version) {
      throw new ShipmentError(
        "DRAFT_OUTDATED",
        "The draft changed since you opened it. Please check it again.",
      );
    }

    const sentAt = now();
    const messageId = `<${draft.id}@${mailbox.split("@")[1] ?? "nova.local"}>`;
    tx.update(outboundEmails)
      .set({ status: "sent", messageId, sentAt, updatedAt: sentAt })
      .where(eq(outboundEmails.id, draft.id))
      .run();
    const approval = draft.kind === "approval";
    const status = approval ? "APPROVAL_SENT" : "AMENDMENT_SENT";
    tx.update(shipments)
      .set({
        status,
        headline: approval
          ? "Approved and sent to the supplier"
          : "Amendment sent: waiting for the supplier",
        updatedAt: sentAt,
      })
      .where(eq(shipments.id, shipmentId))
      .run();
    recordEvent(
      tx,
      shipmentId,
      "sent",
      `CG sent the ${draft.kind} to ${draft.toAddress} (simulated; no real email).`,
      { messageId, version },
    );
    const sent = tx.select().from(outboundEmails).where(eq(outboundEmails.id, draft.id)).get()!;
    return { sentEmail: sentEmailView(sent, shipment.reference), status };
  });
}

export function listSentEmails(db: NovaDb) {
  return db
    .select({ email: outboundEmails, reference: shipments.reference })
    .from(outboundEmails)
    .innerJoin(shipments, eq(shipments.id, outboundEmails.shipmentId))
    .where(eq(outboundEmails.status, "sent"))
    .orderBy(desc(outboundEmails.sentAt))
    .all()
    .map(({ email, reference }) => sentEmailView(email, reference));
}
