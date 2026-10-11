import type { IconName } from "./components/Icon.js";
import type { Tone } from "./domain.js";
import type {
  ConfidenceLevel,
  DocType,
  DocumentStatus,
  Draft,
  FieldObservation,
  FieldState,
  OutboundKind,
  ShipmentDocument,
  ShipmentEmail,
  ShipmentField,
  ShipmentIssue,
  ShipmentStatus,
  ShipmentSummary,
  ShipmentView,
} from "./types/api.js";

type Meta = { label: string; tone: Tone };

export const SHIPMENT_STATUS: Record<ShipmentStatus, Meta> = {
  RECEIVED: { label: "Received", tone: "neutral" },
  PROCESSING: { label: "Processing", tone: "info" },
  NEEDS_REVIEW: { label: "Needs your review", tone: "warning" },
  AMENDMENT_READY: { label: "Amendment ready", tone: "danger" },
  APPROVAL_READY: { label: "Ready to approve", tone: "success" },
  AMENDMENT_SENT: { label: "Waiting for supplier", tone: "neutral" },
  APPROVAL_SENT: { label: "Approved and sent", tone: "success" },
  FAILED: { label: "Failed", tone: "danger" },
};

export const shipmentStatusMeta = (status: string): Meta =>
  SHIPMENT_STATUS[status as ShipmentStatus] ?? { label: "Status unavailable", tone: "neutral" };

export const isProcessing = (status: string) => status === "RECEIVED" || status === "PROCESSING";

const STAGE_LABEL: Record<string, string> = { intake: "Intake", validation: "Validation" };

export const stageLabel = (stage: string) => STAGE_LABEL[stage] ?? "In progress";

// ---- shipment lists ---------------------------------------------------------------------------

type WithStatus = { status: ShipmentStatus };

export type FilterKey = "all" | "review" | "amendment" | "approval" | "waiting" | "done";
export type ShipmentFilter = {
  key: FilterKey;
  label: string;
  statuses: ShipmentStatus[] | null;
  hint?: string;
};

export const SHIPMENT_FILTERS: ShipmentFilter[] = [
  { key: "all", label: "All", statuses: null },
  { key: "review", label: "Needs review", statuses: ["NEEDS_REVIEW"] },
  { key: "amendment", label: "Amendment ready", statuses: ["AMENDMENT_READY"] },
  { key: "approval", label: "Ready to approve", statuses: ["APPROVAL_READY"] },
  { key: "waiting", label: "Waiting for supplier", statuses: ["AMENDMENT_SENT"] },
  { key: "done", label: "Done", statuses: ["APPROVAL_SENT"] },
];

export const EXCEPTION_FILTERS: ShipmentFilter[] = [
  {
    key: "all",
    label: "All",
    statuses: ["NEEDS_REVIEW", "AMENDMENT_READY"],
    hint: "Shipments where a person has to step in: a value to confirm, or a problem the supplier must fix.",
  },
  {
    key: "review",
    label: "Needs review",
    statuses: ["NEEDS_REVIEW"],
    hint: "Nova could not settle these on its own. Open one, check the flagged items and decide.",
  },
  {
    key: "amendment",
    label: "Amendment ready",
    statuses: ["AMENDMENT_READY"],
    hint: "The supplier has to fix these. The reply is already drafted for you to check and send.",
  },
];

export const parseFilter = (filters: ShipmentFilter[], value: string | null) =>
  filters.find((f) => f.key === value) ?? filters[0]!;

export const applyFilter = <T extends WithStatus>(shipments: T[], filter: ShipmentFilter) =>
  filter.statuses ? shipments.filter((s) => filter.statuses!.includes(s.status)) : shipments;

export const filterCounts = (shipments: WithStatus[], filters: ShipmentFilter[]) =>
  Object.fromEntries(filters.map((f) => [f.key, applyFilter(shipments, f).length])) as Record<
    FilterKey,
    number
  >;

export const exceptionCount = (shipments: WithStatus[]) =>
  applyFilter(shipments, EXCEPTION_FILTERS[0]!).length;

export function matchesShipmentQuery(
  shipment: Pick<ShipmentSummary, "reference" | "subject" | "supplier" | "customer" | "headline">,
  query: string,
) {
  const text = [
    shipment.reference,
    shipment.subject,
    shipment.supplier.name,
    shipment.supplier.address,
    shipment.customer?.name,
    shipment.headline,
  ]
    .join(" ")
    .toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => text.includes(term));
}

// ---- pipeline overview ------------------------------------------------------------------------

export type PipelineKey = "processing" | "review" | "amendment" | "approval" | "waiting" | "done";

export const PIPELINE_STATUSES: Record<PipelineKey, ShipmentStatus[]> = {
  processing: ["RECEIVED", "PROCESSING"],
  review: ["NEEDS_REVIEW"],
  amendment: ["AMENDMENT_READY"],
  approval: ["APPROVAL_READY"],
  waiting: ["AMENDMENT_SENT"],
  done: ["APPROVAL_SENT"],
};

export const pipelineCounts = (shipments: WithStatus[]) =>
  Object.fromEntries(
    Object.entries(PIPELINE_STATUSES).map(([key, statuses]) => [
      key,
      shipments.filter((s) => statuses.includes(s.status)).length,
    ]),
  ) as Record<PipelineKey, number>;

const NEEDS_CG: ShipmentStatus[] = ["NEEDS_REVIEW", "AMENDMENT_READY", "APPROVAL_READY"];
const byUpdated = (a: { updatedAt: string }, b: { updatedAt: string }) =>
  a.updatedAt.localeCompare(b.updatedAt);

// Longest-waiting first, so nothing sits at the bottom of the list unnoticed.
export const longestWaitingFirst = <T extends { updatedAt: string }>(shipments: T[]) =>
  [...shipments].sort(byUpdated);

export const attentionShipments = <T extends WithStatus & { updatedAt: string }>(
  shipments: T[],
  limit: number,
) => longestWaitingFirst(shipments.filter((s) => NEEDS_CG.includes(s.status))).slice(0, limit);

export const recentShipments = <T extends { updatedAt: string }>(shipments: T[], limit: number) =>
  [...shipments].sort((a, b) => byUpdated(b, a)).slice(0, limit);

export const processingShipments = <T extends WithStatus & { receivedAt: string }>(
  shipments: T[],
) =>
  shipments
    .filter((s) => isProcessing(s.status))
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));

export const finishedShipments = <T extends WithStatus & { updatedAt: string }>(
  shipments: T[],
  limit: number,
) =>
  recentShipments(
    shipments.filter((s) => !isProcessing(s.status)),
    limit,
  );

// ---- where a shipment page was opened from -----------------------------------------------------

const BACK_TARGETS = {
  overview: { to: "/", label: "Overview" },
  inbox: { to: "/inbox", label: "Inbox" },
  processing: { to: "/processing", label: "Processing" },
  exceptions: { to: "/exceptions", label: "Exceptions" },
  shipments: { to: "/shipments", label: "Shipments" },
} as const;

export type BackKey = keyof typeof BACK_TARGETS;

export const backTarget = (from: string | null) =>
  from !== null && Object.hasOwn(BACK_TARGETS, from)
    ? BACK_TARGETS[from as BackKey]
    : BACK_TARGETS.shipments;

export const shipmentPath = (id: string, from?: BackKey) =>
  `/shipments/${encodeURIComponent(id)}${from ? `?from=${from}` : ""}`;

// ---- processing -------------------------------------------------------------------------------

export type ProcessingStep = {
  label: string;
  state: "done" | "active" | "pending";
  detail: string | null;
};

export function processingSteps(view: Pick<ShipmentView, "progress">): ProcessingStep[] {
  const reading = view.progress.total === 0 || view.progress.done < view.progress.total;
  return [
    { label: "Email received", state: "done", detail: null },
    {
      label: "Reading attachments",
      state: reading ? "active" : "done",
      detail: view.progress.total > 0 ? progressText(view.progress) : null,
    },
    { label: "Checking against rules", state: reading ? "pending" : "active", detail: null },
    { label: "Ready for you", state: "pending", detail: null },
  ];
}

// The files of the email being processed now, not those of earlier rounds.
export const latestCycleDocuments = (view: Pick<ShipmentView, "documents" | "cycle">) =>
  view.documents.filter((d) => d.cycle === view.cycle);

export const latestEvent = (view: Pick<ShipmentView, "events">) => view.events.at(-1) ?? null;

// ---- received mail ----------------------------------------------------------------------------

export type MailRow = {
  id: string;
  shipmentId: string;
  reference: string;
  cycle: number;
  sender: { name: string | null; address: string };
  subject: string;
  receivedAt: string;
  body: string;
  files: ShipmentDocument[];
};

export function senderOf(from: string) {
  const match = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  return match
    ? { name: match[1]?.trim() || null, address: match[2]!.trim() }
    : { name: null, address: from.trim() };
}

export const mailRows = (views: ShipmentView[]): MailRow[] =>
  views
    .flatMap((view) =>
      view.emails.map((email) => ({
        id: email.id,
        shipmentId: view.id,
        reference: view.reference,
        cycle: email.cycle,
        sender: senderOf(email.from),
        subject: email.subject,
        receivedAt: email.receivedAt,
        body: email.bodyText,
        files: emailDocuments(view, email),
      })),
    )
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));

// ---- simulation -----------------------------------------------------------------------------

export function arrivalMessage(arrived: Pick<ShipmentSummary, "reference" | "cycle"> | null) {
  if (!arrived) {
    return "Nothing new arrived in the Inbox. Each sample email is accepted only once, so this one was most likely received before.";
  }
  return arrived.cycle > 1
    ? `Delivered. It was added to ${arrived.reference} as cycle ${arrived.cycle}.`
    : `Delivered. It arrived in the Inbox as ${arrived.reference}.`;
}

// ---- header ---------------------------------------------------------------------------------

export type PrimaryAction =
  | { kind: "review"; label: string }
  | { kind: "send"; label: string }
  | { kind: "status"; label: string };

export function primaryAction(
  view: Pick<ShipmentSummary, "status" | "openReviewItems">,
): PrimaryAction | null {
  switch (view.status) {
    case "NEEDS_REVIEW":
      return {
        kind: "review",
        label: `Review ${view.openReviewItems} ${view.openReviewItems === 1 ? "item" : "items"}`,
      };
    case "AMENDMENT_READY":
      return { kind: "send", label: "Send amendment" };
    case "APPROVAL_READY":
      return { kind: "send", label: "Send approval" };
    case "AMENDMENT_SENT":
      return { kind: "status", label: "Waiting for supplier" };
    case "APPROVAL_SENT":
      return { kind: "status", label: "Done" };
    default:
      return null;
  }
}

export function progressText({ total, done, failed }: ShipmentView["progress"]): string {
  const read = Math.max(0, done - failed);
  const text = `${read} of ${total} ${total === 1 ? "attachment" : "attachments"} read`;
  return failed > 0 ? `${text} · ${failed} could not be opened` : text;
}

export const progressPercent = ({ total, done }: ShipmentView["progress"]) =>
  total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

// ---- documents and emails ---------------------------------------------------------------------

const UNKNOWN: Meta = { label: "Status unavailable", tone: "neutral" };

const DOC_STATUS: Record<DocumentStatus, Meta> = {
  pending: { label: "Reading…", tone: "info" },
  processing: { label: "Reading…", tone: "info" },
  extracted: { label: "Read", tone: "success" },
  failed: { label: "Could not be read", tone: "danger" },
};

// Labels are looked up by values the backend sends, so an unfamiliar value must not break the page.
export const docStatusMeta = (status: string): Meta =>
  DOC_STATUS[status as DocumentStatus] ?? UNKNOWN;

// While a shipment is processed only some files are being read; the rest are waiting their turn.
export const fileProgressMeta = (status: string): Meta =>
  status === "pending" ? { label: "Waiting", tone: "neutral" } : docStatusMeta(status);

const TONE_ICON: Record<Tone, IconName> = {
  success: "checkCircle",
  warning: "alert",
  danger: "xCircle",
  info: "clock",
  neutral: "file",
};

export const toneIcon = (tone: Tone) => TONE_ICON[tone];

export const DOC_TYPE_OPTIONS: { value: DocType; label: string }[] = [
  { value: "COMMERCIAL_INVOICE", label: "Commercial invoice" },
  { value: "BOL", label: "Bill of lading" },
  { value: "PACKING_LIST", label: "Packing list" },
  { value: "CERTIFICATE_OF_ORIGIN", label: "Certificate of origin" },
  { value: "OTHER", label: "Other / unclassified" },
];

export const documentTypeLabel = (doc: Pick<ShipmentDocument, "docTypeLabel">) =>
  doc.docTypeLabel ?? "Type unknown";

export const emailDocuments = (view: Pick<ShipmentView, "documents">, email: ShipmentEmail) =>
  email.documentIds.flatMap((id) => view.documents.find((d) => d.id === id) ?? []);

export const currentDocuments = (view: Pick<ShipmentView, "documents">) =>
  view.documents.filter((d) => d.current);

// ---- verification grid ------------------------------------------------------------------------

const CONFIDENCE: Record<ConfidenceLevel, Meta> = {
  high: { label: "High", tone: "success" },
  medium: { label: "Medium", tone: "warning" },
  low: { label: "Low", tone: "danger" },
};

export const confidenceMeta = (level: string): Meta =>
  CONFIDENCE[level as ConfidenceLevel] ?? { label: "Unknown", tone: "neutral" };

export const confidenceTitle = (o: Pick<FieldObservation, "confidence">) =>
  `Confidence ${o.confidence.toFixed(2)}`;

export function formatObservation(o: Pick<FieldObservation, "value" | "unit">): string {
  if (o.value === null || o.value === "") return "Not found";
  return o.unit ? `${o.value} ${o.unit}` : String(o.value);
}

export const observationAt = (field: ShipmentField, documentId: string) =>
  field.observations.find((o) => o.documentId === documentId) ?? null;

export function cellTone(
  o: Pick<FieldObservation, "agrees" | "reliable">,
): "danger" | "warning" | null {
  if (o.agrees === false) return "danger";
  return o.reliable ? null : "warning";
}

export const isChecked = (f: Pick<ShipmentField, "ruleStatus" | "consistency">) =>
  !(f.ruleStatus === "not_checked" && f.consistency === "not_checked");

const FIELD_RESULT: Record<FieldState, Meta> = {
  ok: { label: "OK", tone: "success" },
  amendment: { label: "Needs correction", tone: "danger" },
  review: { label: "Needs review", tone: "warning" },
};

// The backend marks a field "ok" before validation has looked at it; say that plainly.
export const fieldResult = (
  f: Pick<ShipmentField, "state" | "ruleStatus" | "consistency">,
): Meta =>
  f.state === "ok" && !isChecked(f)
    ? { label: "Not checked yet", tone: "neutral" }
    : (FIELD_RESULT[f.state] ?? UNKNOWN);

export function gridSummary(view: Pick<ShipmentView, "fields" | "documents">): string | null {
  const { fields } = view;
  if (fields.length === 0) return null;
  const docs = currentDocuments(view).filter((d) => d.status === "extracted").length;
  const docText = `${docs} ${docs === 1 ? "document" : "documents"}`;
  const amendments = fields.filter((f) => f.state === "amendment").length;
  const reviews = fields.filter((f) => f.state === "review").length;
  const parts = [
    amendments > 0 ? `${amendments} ${amendments === 1 ? "needs" : "need"} correction` : null,
    reviews > 0 ? `${reviews} ${reviews === 1 ? "needs" : "need"} your review` : null,
  ].filter(Boolean);

  if (!fields.some(isChecked)) {
    const lead = `${fields.length} fields read across ${docText}`;
    const tail = parts.length ? `: ${parts.join(", ")}` : "";
    return `${lead}${tail}. Customer rules and cross-document checks run once intake is complete.`;
  }
  const lead = `${fields.length} fields checked across ${docText}`;
  return `${lead}: ${parts.length ? parts.join(", ") : "all clear"}`;
}

// ---- review panel -----------------------------------------------------------------------------

export type ReviewGroups = {
  decisions: ShipmentIssue[];
  outgoing: ShipmentIssue[];
  earlier: ShipmentIssue[];
  decided: number;
};

export function reviewGroups(view: Pick<ShipmentView, "issues" | "stage">): ReviewGroups {
  const current = view.issues.filter((i) => i.stage === view.stage);
  const decisions = current.filter((i) => i.severity === "review");
  return {
    decisions,
    outgoing: current.filter((i) => i.severity === "amendment"),
    earlier: view.issues.filter((i) => i.stage !== view.stage),
    decided: decisions.filter((i) => i.resolution).length,
  };
}

export type ClarifyForm = {
  showValue: boolean;
  valueRequired: boolean;
  prefill: string;
  showNote: boolean;
  noteRequired: boolean;
};

export function clarifyForm(
  issue: Pick<ShipmentIssue, "actionRules" | "found">,
): ClarifyForm | null {
  const rule = issue.actionRules.clarify;
  if (!rule) return null;
  return {
    showValue: rule.value !== "none",
    valueRequired: rule.value === "required",
    prefill: rule.value === "optional" ? (issue.found ?? "") : "",
    showNote: rule.note !== "none",
    noteRequired: rule.note === "required",
  };
}

export const canSubmitClarify = (form: ClarifyForm, value: string, note: string) =>
  (!form.valueRequired || value.trim() !== "") && (!form.noteRequired || note.trim() !== "");

export const RESOLUTION_LABEL = {
  clarify: "Checked and accepted",
  amend: "Supplier asked to fix this",
} as const;

// ---- discrepancy detail ------------------------------------------------------------------------

export const ruleSource = (view: Pick<ShipmentView, "customer">) =>
  view.customer ? `${view.customer.name} rule` : "Customer rule";

export function expectedSource(
  view: Pick<ShipmentView, "customer" | "documents" | "fields">,
  issue: Pick<ShipmentIssue, "reference" | "field">,
): string | null {
  const ref = issue.reference;
  if (!ref) return null;
  if (ref.source === "rule") return ruleSource(view);
  const doc = view.documents.find((d) => d.id === ref.documentId);
  if (!doc) return "Another document";
  const field = view.fields.find((f) => f.field === issue.field);
  const owner = field?.observations.find((o) => o.documentId === doc.id)?.isOwner;
  return `${documentTypeLabel(doc)}${owner ? " (owner)" : ""}`;
}

export type FieldExpectation = { value: string | null; source: string | null; rule: string | null };

export function fieldExpectation(
  view: Pick<ShipmentView, "customer" | "documents" | "fields" | "issues">,
  field: ShipmentField,
): FieldExpectation {
  const issue = view.issues.find((i) => i.field === field.field && i.expected);
  if (issue?.expected) {
    const differs = field.expected && field.expected !== issue.expected ? field.expected : null;
    return { value: issue.expected, source: expectedSource(view, issue), rule: differs };
  }
  if (field.expected) return { value: field.expected, source: ruleSource(view), rule: null };
  return { value: null, source: null, rule: null };
}

export const issuesForField = (issues: ShipmentIssue[], field: string) =>
  issues.filter((i) => i.field === field);

// ---- draft ------------------------------------------------------------------------------------

export type DraftEdits = { to: string; subject: string; body: string };

export const draftEdits = (d: Pick<Draft, "to" | "subject" | "body">): DraftEdits => ({
  to: d.to,
  subject: d.subject,
  body: d.body,
});

export const isDraftDirty = (d: Pick<Draft, "to" | "subject" | "body">, e: DraftEdits) =>
  d.to !== e.to || d.subject !== e.subject || d.body !== e.body;

const OUTBOUND_KIND: Record<OutboundKind, Meta> = {
  amendment: { label: "Amendment", tone: "danger" },
  approval: { label: "Approval", tone: "success" },
};

export const outboundKindMeta = (kind: string): Meta =>
  OUTBOUND_KIND[kind as OutboundKind] ?? { label: "Reply", tone: "neutral" };

export type SendFailure = { action: "reload" | "review" | "show"; message: string | null };

export function sendFailure(code: string | null): SendFailure {
  switch (code) {
    case "DRAFT_OUTDATED":
      return {
        action: "reload",
        message: "The draft changed (for example, the supplier replied). Please check it again.",
      };
    case "REVIEW_INCOMPLETE":
      return { action: "review", message: null };
    case "ALREADY_SENT":
      return { action: "reload", message: "This reply was already sent." };
    default:
      return { action: "show", message: null };
  }
}

// ---- timeline and metrics ---------------------------------------------------------------------

const EVENT_META: Record<string, { icon: IconName; tone: Tone }> = {
  email_received: { icon: "mail", tone: "info" },
  attachment_read: { icon: "file", tone: "neutral" },
  attachment_failed: { icon: "alert", tone: "danger" },
  attachment_unchanged: { icon: "file", tone: "neutral" },
  attachment_duplicate: { icon: "file", tone: "neutral" },
  attachment_skipped: { icon: "file", tone: "neutral" },
  document_type_set: { icon: "file", tone: "info" },
  evaluated: { icon: "shield", tone: "info" },
  review_action: { icon: "user", tone: "info" },
  draft_edited: { icon: "mail", tone: "neutral" },
  sent: { icon: "send", tone: "success" },
  failed: { icon: "xCircle", tone: "danger" },
};

export const eventMeta = (type: string) =>
  EVENT_META[type] ?? { icon: "clock" as IconName, tone: "neutral" as Tone };

export function formatMinutes(value: number | null | undefined): string {
  if (value == null) return "—";
  if (value < 1) return "<1 min";
  return `${Math.round(value * 10) / 10} min`;
}
