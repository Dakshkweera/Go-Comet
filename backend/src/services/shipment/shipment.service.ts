import { createHash } from "node:crypto";
import { and, desc, eq, inArray, max, sql } from "drizzle-orm";
import {
  DOC_TYPE_LABELS,
  type IssueResolution,
  type ReviewAction,
  type Validator,
} from "../../schemas/index.js";
import {
  inboundEmails,
  outboundEmails,
  reviewActions,
  shipmentFields,
  shipmentIssues,
  shipments,
  type NovaDb,
} from "../../db/index.js";
import type { Logger } from "../../utils/logger.js";
import { loadRules, resolveCustomer } from "../customer.service.js";
import { newId, type Pipeline } from "../pipeline.service.js";
import { buildReplyDraft } from "../routing/index.js";
import { assessShipment } from "./assess.js";
import { loadShipmentDocuments, selectCurrent } from "./documents.js";
import { recordEvent } from "./events.js";

export type ShipmentServiceDeps = {
  db: NovaDb;
  pipeline: Pipeline;
  validator: Validator;
  minConfidence: number;
  cg: { mailbox: string; signature: string };
  logger: Logger;
};

export const SENT_STATUSES = new Set(["AMENDMENT_SENT", "APPROVAL_SENT"]);
const now = () => new Date().toISOString();
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function latestActions(db: NovaDb, shipmentId: string, cycle: number) {
  const actions = new Map<string, IssueResolution>();
  const rows = db
    .select()
    .from(reviewActions)
    .where(
      and(
        eq(reviewActions.shipmentId, shipmentId),
        eq(reviewActions.cycle, cycle),
        inArray(reviewActions.action, ["clarify", "amend"]),
      ),
    )
    .orderBy(sql`rowid`)
    .all();
  for (const row of rows) {
    actions.set(row.issueKey, {
      action: row.action as ReviewAction,
      value: row.valueText,
      note: row.note,
      at: row.createdAt,
    });
  }
  return actions;
}

export function createShipmentService(deps: ShipmentServiceDeps) {
  const { db } = deps;
  const running = new Map<string, Promise<void>>();

  const update = (shipmentId: string, values: Partial<typeof shipments.$inferInsert>) =>
    db
      .update(shipments)
      .set({ ...values, updatedAt: now() })
      .where(eq(shipments.id, shipmentId))
      .run();

  async function readAttachments(shipmentId: string) {
    // Loop: a supplier reply can add files while earlier ones are still being read.
    for (;;) {
      const shipment = db.select().from(shipments).where(eq(shipments.id, shipmentId)).get();
      if (!shipment) return;
      const cycleDocs = loadShipmentDocuments(db, shipmentId).filter(
        (d) => d.cycle === shipment.cycle,
      );
      const pending = cycleDocs.filter((d) => d.status === "pending");
      if (pending.length === 0) return;

      let done = cycleDocs.length - pending.length;
      const progress = () =>
        update(shipmentId, {
          status: "PROCESSING",
          headline: `Processing ${done} of ${cycleDocs.length} attachments`,
          evaluationHash: null,
        });
      progress();
      await Promise.allSettled(
        pending.map(async (doc) => {
          await deps.pipeline
            .run(doc.runId)
            .catch((err) =>
              deps.logger.error({ err, runId: doc.runId }, "attachment extraction failed"),
            );
          done++;
          progress();
          const read = loadShipmentDocuments(db, shipmentId).find((d) => d.id === doc.id);
          if (read?.status === "extracted") {
            const type = DOC_TYPE_LABELS[read.docType ?? "OTHER"];
            recordEvent(
              db,
              shipmentId,
              "attachment_read",
              `${read.filename} read as ${type.toLowerCase()}.`,
            );
          } else if (read?.status === "failed") {
            recordEvent(
              db,
              shipmentId,
              "attachment_failed",
              `${read.filename}: ${read.error?.message}`,
            );
          }
        }),
      );
    }
  }

  function evaluate(shipmentId: string) {
    const shipment = db.select().from(shipments).where(eq(shipments.id, shipmentId)).get();
    if (!shipment || SENT_STATUSES.has(shipment.status)) return;
    const all = loadShipmentDocuments(db, shipmentId);
    if (all.some((d) => d.cycle === shipment.cycle && d.status === "pending")) return;

    const documents = selectCurrent(all, shipment.cycle);
    const { customer, checked, route, issues, fields } = assessShipment({
      documents,
      actions: latestActions(db, shipmentId, shipment.cycle),
      resolveCustomer: (name) => resolveCustomer(db, name),
      loadRules: (customerId) => loadRules(db, customerId),
      validator: deps.validator,
      minConfidence: deps.minConfidence,
    });

    const email = db
      .select()
      .from(inboundEmails)
      .where(eq(inboundEmails.shipmentId, shipmentId))
      .orderBy(desc(inboundEmails.cycle))
      .get()!;
    const invoice =
      checked.find((d) => d.docType === "COMMERCIAL_INVOICE") ?? checked.find((d) => d.extraction);
    const draft = route.draftKind
      ? buildReplyDraft({
          kind: route.draftKind,
          stage: route.stage,
          reference: shipment.reference,
          subject: shipment.subject,
          supplierName: shipment.supplierName,
          invoiceNumber: invoice?.extraction?.invoice_number.value ?? null,
          customerName: customer.customerName,
          documents,
          items: route.draftItems,
          signature: deps.cg.signature,
        })
      : null;

    const evaluationHash = hash({
      cycle: shipment.cycle,
      route: [route.status, route.stage, route.headline],
      customer: customer.customerId,
      issues: issues.map((i) => [i.key, i.resolution]),
      documents: documents.map((d) => [d.id, d.docType]),
      draft,
    });
    if (evaluationHash === shipment.evaluationHash) return;

    db.transaction((tx) => {
      tx.delete(shipmentFields).where(eq(shipmentFields.shipmentId, shipmentId)).run();
      // Earlier cycles' findings stay as history; only this cycle is re-evaluated.
      tx.delete(shipmentIssues)
        .where(
          and(eq(shipmentIssues.shipmentId, shipmentId), eq(shipmentIssues.cycle, shipment.cycle)),
        )
        .run();
      for (const f of fields) {
        tx.insert(shipmentFields)
          .values({
            id: newId("fld"),
            shipmentId,
            fieldName: f.field,
            state: f.state,
            ruleStatus: f.ruleStatus,
            consistency: f.consistency,
            ownerDocType: f.ownerDocType,
            valueText: typeof f.value === "string" ? f.value : null,
            valueNumber: typeof f.value === "number" ? f.value : null,
            unit: f.unit,
            valueSource: f.valueSource,
            sourceDocumentId: f.sourceDocumentId,
            ruleId: f.ruleId,
            expectedLabel: f.expected,
            confidence: f.confidence,
            reason: f.reason,
            observationsJson: JSON.stringify(f.observations),
          })
          .run();
      }
      for (const i of issues) {
        tx.insert(shipmentIssues)
          .values({
            id: newId("iss"),
            shipmentId,
            issueKey: i.key,
            cycle: shipment.cycle,
            stage: i.stage,
            severity: i.severity,
            kind: i.kind,
            fieldName: i.field,
            documentIdsJson: JSON.stringify(i.documentIds),
            found: i.found,
            expected: i.expected,
            referenceJson: i.reference ? JSON.stringify(i.reference) : null,
            message: i.message,
            request: i.request,
            allowedActionsJson: JSON.stringify(i.allowedActions),
          })
          .run();
      }
      tx.update(shipments)
        .set({
          status: route.status,
          stage: route.stage,
          decision: route.decision,
          headline: route.headline,
          reasoning: route.reasoning,
          customerId: customer.customerId,
          customerResolutionStatus: customer.status,
          customerResolutionReason: customer.reason,
          evaluationHash,
          evaluatedAt: now(),
          updatedAt: now(),
        })
        .where(eq(shipments.id, shipmentId))
        .run();

      const current = tx
        .select()
        .from(outboundEmails)
        .where(and(eq(outboundEmails.shipmentId, shipmentId), eq(outboundEmails.status, "draft")))
        .get();
      const unchangedDraft =
        current &&
        draft &&
        current.kind === route.draftKind &&
        current.generatedBody === draft.body;
      if (current && !unchangedDraft) {
        tx.update(outboundEmails)
          .set({ status: "superseded", updatedAt: now() })
          .where(eq(outboundEmails.id, current.id))
          .run();
      }
      if (draft && !unchangedDraft) {
        const version =
          (tx
            .select({ v: max(outboundEmails.version) })
            .from(outboundEmails)
            .where(eq(outboundEmails.shipmentId, shipmentId))
            .get()?.v ?? 0) + 1;
        tx.insert(outboundEmails)
          .values({
            id: newId("out"),
            shipmentId,
            cycle: shipment.cycle,
            stage: route.stage,
            kind: route.draftKind!,
            version,
            fromAddress: deps.cg.mailbox,
            toAddress: email.replyTo ?? email.fromAddress,
            subject: draft.subject,
            body: draft.body,
            generatedBody: draft.body,
            status: "draft",
            evaluationHash,
            inReplyTo: email.messageId,
          })
          .run();
      }
      recordEvent(tx, shipmentId, "evaluated", route.headline, {
        status: route.status,
        stage: route.stage,
      });
    });
  }

  /** Runs are queued per shipment, so a reply arriving mid-processing is always picked up. */
  function processCycle(shipmentId: string): Promise<void> {
    const task = (running.get(shipmentId) ?? Promise.resolve())
      .then(() => readAttachments(shipmentId))
      .then(() => evaluate(shipmentId))
      .catch((err) => {
        deps.logger.error({ err, shipmentId }, "shipment processing failed");
        update(shipmentId, {
          status: "FAILED",
          headline: "Processing failed; see the timeline for details",
        });
        recordEvent(db, shipmentId, "failed", err instanceof Error ? err.message : String(err));
      });
    running.set(shipmentId, task);
    void task.finally(() => {
      if (running.get(shipmentId) === task) running.delete(shipmentId);
    });
    return task;
  }

  return {
    processCycle,
    evaluate,

    resume() {
      const open = db
        .select({ id: shipments.id })
        .from(shipments)
        .where(inArray(shipments.status, ["RECEIVED", "PROCESSING"]))
        .all();
      return Promise.all(open.map((s) => processCycle(s.id)));
    },
  };
}

export type ShipmentService = ReturnType<typeof createShipmentService>;
