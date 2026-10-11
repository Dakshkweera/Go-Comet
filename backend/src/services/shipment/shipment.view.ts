import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import {
  DOC_TYPE_LABELS,
  FIELD_LABELS,
  type ExtractionField,
  type FieldObservation,
  type IssueKind,
  type IssueReference,
  type ReviewAction,
  type ShipmentIssue,
} from "../../schemas/index.js";
import {
  customers,
  inboundEmails,
  outboundEmails,
  shipmentEvents,
  shipmentFields,
  shipmentIssues,
  shipments,
  type NovaDb,
} from "../../db/index.js";
import { applyResolutions, isOpen, toSend, type ResolvedIssue } from "../routing/index.js";
import { loadShipmentDocuments, selectCurrent } from "./documents.js";
import { latestActions } from "./shipment.service.js";

type ShipmentRow = typeof shipments.$inferSelect;

// Ids are random, so rows keep the order the agent wrote them in.
const insertionOrder = sql`rowid`;

function loadIssues(db: NovaDb, shipment: ShipmentRow): ResolvedIssue[] {
  const rows = db
    .select()
    .from(shipmentIssues)
    .where(
      and(eq(shipmentIssues.shipmentId, shipment.id), eq(shipmentIssues.cycle, shipment.cycle)),
    )
    .orderBy(insertionOrder)
    .all();
  const issues: ShipmentIssue[] = rows.map((r) => ({
    key: r.issueKey,
    stage: r.stage as ShipmentIssue["stage"],
    severity: r.severity as ShipmentIssue["severity"],
    kind: r.kind as IssueKind,
    field: r.fieldName as ExtractionField | null,
    documentIds: JSON.parse(r.documentIdsJson) as string[],
    found: r.found,
    expected: r.expected,
    reference: r.referenceJson ? (JSON.parse(r.referenceJson) as IssueReference) : null,
    message: r.message,
    request: r.request,
    allowedActions: JSON.parse(r.allowedActionsJson) as ReviewAction[],
  }));
  return applyResolutions(issues, latestActions(db, shipment.id, shipment.cycle));
}

function summary(db: NovaDb, shipment: ShipmentRow) {
  const customer = shipment.customerId
    ? db.select().from(customers).where(eq(customers.id, shipment.customerId)).get()
    : undefined;
  const first = db
    .select({ at: inboundEmails.receivedAt })
    .from(inboundEmails)
    .where(eq(inboundEmails.shipmentId, shipment.id))
    .orderBy(asc(inboundEmails.receivedAt))
    .get();
  const issues = loadIssues(db, shipment);
  const docs = loadShipmentDocuments(db, shipment.id);
  return {
    id: shipment.id,
    reference: shipment.reference,
    subject: shipment.subject,
    supplier: { name: shipment.supplierName, address: shipment.supplierAddress },
    customer: customer ? { id: customer.id, name: customer.name } : null,
    status: shipment.status,
    stage: shipment.stage,
    decision: shipment.decision,
    headline: shipment.headline,
    cycle: shipment.cycle,
    attachments: docs.filter((d) => d.cycle === shipment.cycle).length,
    openReviewItems: issues.filter(isOpen).length,
    amendmentItems: issues.filter(toSend).length,
    receivedAt: first?.at ?? shipment.createdAt,
    updatedAt: shipment.updatedAt,
  };
}

export function listShipments(db: NovaDb, filter: { status?: string; customerId?: string } = {}) {
  const conditions: SQL[] = [];
  if (filter.status) conditions.push(eq(shipments.status, filter.status));
  if (filter.customerId) conditions.push(eq(shipments.customerId, filter.customerId));
  return db
    .select()
    .from(shipments)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(shipments.updatedAt))
    .limit(100)
    .all()
    .map((s) => summary(db, s));
}

const confidenceLevel = (o: FieldObservation) =>
  !o.reliable ? "low" : o.confidence >= 0.9 ? "high" : "medium";

export function getShipmentView(db: NovaDb, shipmentId: string) {
  const shipment = db.select().from(shipments).where(eq(shipments.id, shipmentId)).get();
  if (!shipment) return null;

  const docs = loadShipmentDocuments(db, shipmentId);
  const current = new Set(selectCurrent(docs, shipment.cycle).map((d) => d.id));
  const byId = new Map(docs.map((d) => [d.id, d]));
  const cycleDocs = docs.filter((d) => d.cycle === shipment.cycle);
  const issues = loadIssues(db, shipment);
  const outbound = db
    .select()
    .from(outboundEmails)
    .where(eq(outboundEmails.shipmentId, shipmentId))
    .orderBy(asc(outboundEmails.version))
    .all();
  const draft = outbound.find((o) => o.status === "draft") ?? null;
  const previous = draft && outbound.find((o) => o.version === draft.version - 1);
  const open = issues.filter(isOpen).length;
  const ready = shipment.status === "AMENDMENT_READY" || shipment.status === "APPROVAL_READY";
  const base = summary(db, shipment);

  return {
    ...base,
    reasoning: shipment.reasoning,
    customerResolution: shipment.customerResolutionStatus
      ? {
          status: shipment.customerResolutionStatus,
          name: base.customer?.name ?? null,
          reason: shipment.customerResolutionReason,
        }
      : null,
    emails: db
      .select()
      .from(inboundEmails)
      .where(eq(inboundEmails.shipmentId, shipmentId))
      .orderBy(asc(inboundEmails.cycle))
      .all()
      .map((e) => ({
        id: e.id,
        cycle: e.cycle,
        messageId: e.messageId,
        from: e.fromName ? `${e.fromName} <${e.fromAddress}>` : e.fromAddress,
        subject: e.subject,
        receivedAt: e.receivedAt,
        bodyText: e.bodyText,
        documentIds: docs.filter((d) => d.inboundEmailId === e.id).map((d) => d.id),
      })),
    progress: {
      total: cycleDocs.length,
      done: cycleDocs.filter((d) => d.status !== "pending").length,
      failed: cycleDocs.filter((d) => d.status === "failed").length,
    },
    documents: docs.map((d) => ({
      id: d.id,
      runId: d.runId,
      filename: d.filename,
      mimeType: d.mimeType,
      size: d.size,
      cycle: d.cycle,
      current: current.has(d.id),
      unchangedFromCycle: d.unchangedFromDocumentId
        ? (byId.get(d.unchangedFromDocumentId)?.cycle ?? null)
        : null,
      docType: d.docType,
      docTypeLabel: d.docType ? DOC_TYPE_LABELS[d.docType] : null,
      docTypeReason: d.docTypeReason,
      status: d.status === "pending" && d.runStatus === "PROCESSING" ? "processing" : d.status,
      error: d.error,
      fileUrl: `/api/runs/${d.runId}/document`,
    })),
    fields: db
      .select()
      .from(shipmentFields)
      .where(eq(shipmentFields.shipmentId, shipmentId))
      .orderBy(insertionOrder)
      .all()
      .map((f) => ({
        field: f.fieldName,
        label: FIELD_LABELS[f.fieldName as ExtractionField],
        state: f.state,
        ruleStatus: f.ruleStatus,
        consistency: f.consistency,
        ownerDocType: f.ownerDocType,
        value: f.valueText ?? f.valueNumber,
        unit: f.unit,
        valueSource: f.valueSource,
        sourceDocumentId: f.sourceDocumentId,
        expected: f.expectedLabel,
        ruleId: f.ruleId,
        confidence: f.confidence,
        reason: f.reason,
        observations: (JSON.parse(f.observationsJson) as FieldObservation[]).map((o) => ({
          ...o,
          confidenceLevel: confidenceLevel(o),
        })),
      })),
    issues: issues.map((i) => ({
      key: i.key,
      stage: i.stage,
      severity: i.severity,
      kind: i.kind,
      field: i.field,
      fieldLabel: i.field ? FIELD_LABELS[i.field] : null,
      documents: i.documentIds.flatMap((id) => {
        const d = byId.get(id);
        return d ? [{ id: d.id, filename: d.filename, docType: d.docType }] : [];
      }),
      found: i.found,
      expected: i.expected,
      reference: i.reference,
      message: i.message,
      request: i.request,
      allowedActions: i.allowedActions,
      actionRules: i.actionRules,
      resolution: i.resolution,
    })),
    draft: draft
      ? {
          id: draft.id,
          kind: draft.kind,
          version: draft.version,
          to: draft.toAddress,
          subject: draft.subject,
          body: draft.body,
          generatedBody: draft.generatedBody,
          edited: draft.body !== draft.generatedBody,
          status: draft.status,
          previousVersionEdited: Boolean(previous && previous.body !== previous.generatedBody),
          canSend: ready,
          sendBlockedReason: ready
            ? null
            : shipment.status === "NEEDS_REVIEW"
              ? `${open} item${open === 1 ? "" : "s"} still need${open === 1 ? "s" : ""} your decision`
              : "Still processing the attachments",
        }
      : null,
    sent: outbound
      .filter((o) => o.status === "sent")
      .map((o) => ({
        id: o.id,
        kind: o.kind,
        to: o.toAddress,
        subject: o.subject,
        sentAt: o.sentAt,
      })),
    events: db
      .select()
      .from(shipmentEvents)
      .where(eq(shipmentEvents.shipmentId, shipmentId))
      .orderBy(insertionOrder)
      .all()
      .map((e) => ({ type: e.type, message: e.message, at: e.createdAt })),
  };
}

export function getMetrics(db: NovaDb) {
  const all = db.select().from(shipments).all();
  const byStatus: Record<string, number> = {};
  for (const s of all) byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;

  const sent = db.select().from(outboundEmails).where(eq(outboundEmails.status, "sent")).all();
  const received = db.select().from(inboundEmails).all();
  const minutes = sent
    .map((o) => {
      const email = received.find((e) => e.shipmentId === o.shipmentId && e.cycle === o.cycle);
      return email && o.sentAt
        ? (Date.parse(o.sentAt) - Date.parse(email.receivedAt)) / 60_000
        : null;
    })
    .filter((m): m is number => m !== null)
    .sort((a, b) => a - b);
  const median =
    minutes.length === 0
      ? null
      : minutes.length % 2
        ? minutes[(minutes.length - 1) / 2]!
        : (minutes[minutes.length / 2 - 1]! + minutes[minutes.length / 2]!) / 2;
  const unedited = sent.filter((o) => o.body === o.generatedBody).length;

  return {
    northStar: {
      name: "Median minutes from SU email to CG reply sent",
      value: median === null ? null : Math.round(median * 10) / 10,
    },
    shipments: all.length,
    byStatus,
    needsReview: byStatus.NEEDS_REVIEW ?? 0,
    replies: { sent: sent.length, unedited, edited: sent.length - unedited },
    averageCycles:
      all.length === 0
        ? null
        : Math.round((all.reduce((sum, s) => sum + s.cycle, 0) / all.length) * 10) / 10,
  };
}
