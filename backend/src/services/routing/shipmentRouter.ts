import {
  DOC_TYPE_LABELS,
  FIELD_LABELS,
  type ActionRule,
  type Decision,
  type ExtractionField,
  type FieldResult,
  type IssueKind,
  type IssueResolution,
  type ReviewAction,
  type ShipmentDocument,
  type ShipmentIssue,
  type ShipmentStage,
  type ShipmentStatus,
} from "../../schemas/index.js";

export type ResolvedIssue = ShipmentIssue & {
  resolution: IssueResolution | null;
  actionRules: Partial<Record<ReviewAction, ActionRule>>;
};

const VALUE_REQUIRED = new Set<IssueKind>(["missing_field", "duplicate_type_conflict"]);

/** What a CG decision must include; a waiver or acceptance always carries a reason. */
export function actionRule(kind: IssueKind, action: ReviewAction): ActionRule {
  if (action === "amend") return { value: "none", note: "optional" };
  if (VALUE_REQUIRED.has(kind)) return { value: "required", note: "optional" };
  if (kind === "unreliable_value") return { value: "optional", note: "optional" };
  return { value: "none", note: "required" };
}

export function applyResolutions(
  issues: ShipmentIssue[],
  actions: Map<string, IssueResolution>,
): ResolvedIssue[] {
  return issues.map((issue) => {
    const resolution = actions.get(issue.key) ?? null;
    return {
      ...issue,
      resolution:
        resolution && issue.allowedActions.includes(resolution.action) ? resolution : null,
      actionRules: Object.fromEntries(
        issue.allowedActions.map((a) => [a, actionRule(issue.kind, a)]),
      ),
    };
  });
}

/** Open = still needs a CG decision. To send = goes into the reply to SU. */
export const isOpen = (i: ResolvedIssue) => i.severity === "review" && !i.resolution;
export const toSend = (i: ResolvedIssue) =>
  i.severity === "amendment"
    ? i.resolution?.action !== "clarify"
    : i.resolution?.action === "amend";

export type RouteInput = {
  stage1: ResolvedIssue[];
  stage2: ResolvedIssue[] | null;
  documents: ShipmentDocument[];
  customerName: string | null;
  customerReason: string;
  rulesCount: number;
};

export type Route = {
  status: ShipmentStatus;
  stage: ShipmentStage;
  decision: Decision;
  headline: string;
  reasoning: string;
  draftKind: "approval" | "amendment" | null;
  draftItems: ResolvedIssue[];
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function intakeSummary(items: ResolvedIssue[]) {
  const failed = items.filter((i) => i.kind === "attachment_failed").length;
  const missing = items.filter((i) => i.kind === "missing_document").length;
  const rest = items.length - failed - missing;
  return [
    failed ? `${plural(failed, "file")} could not be opened` : "",
    missing ? `${plural(missing, "document")} missing` : "",
    rest ? `${plural(rest, "item")} to confirm` : "",
    items.some((i) => i.kind === "no_attachments") ? "no documents attached" : "",
  ]
    .filter(Boolean)
    .join(", ");
}

function documentSummary(documents: ShipmentDocument[]) {
  const parts = documents.map((d) =>
    d.status === "failed"
      ? `${d.filename} (could not be read)`
      : `${d.docType ? DOC_TYPE_LABELS[d.docType].toLowerCase() : "unknown"} (${d.filename})`,
  );
  return parts.length ? `Documents: ${parts.join(", ")}.` : "No documents were attached.";
}

const SUBJECTS: Partial<Record<IssueKind, string>> = {
  no_attachments: "no documents",
  attachment_failed: "unreadable file",
  missing_document: "missing document",
  customer_unresolved: "customer",
  no_rules: "no customer rules",
};

function decisionsSummary(issues: ResolvedIssue[]) {
  const lines = issues.flatMap((i) => {
    if (!i.resolution) return [];
    const subject = i.field ? FIELD_LABELS[i.field] : (SUBJECTS[i.kind] ?? "item");
    const outcome =
      i.resolution.action === "amend"
        ? "asked the supplier"
        : i.resolution.value
          ? `verified as ${i.resolution.value}`
          : "accepted";
    return [`${subject}: ${outcome}${i.resolution.note ? ` (${i.resolution.note})` : ""}`];
  });
  return lines.length ? ` CG decisions: ${lines.join("; ")}.` : "";
}

export function routeShipment(input: RouteInput): Route {
  const { stage1, stage2 } = input;
  const base = `${documentSummary(input.documents)} ${input.customerReason}`;
  const open1 = stage1.filter(isOpen);
  const send1 = stage1.filter(toSend);

  if (open1.length > 0 || send1.length > 0) {
    const reasons = [...open1, ...send1].map((i) => i.message.replace(/\.$/, "")).join("; ");
    const reasoning = `${base} Intake: ${reasons}. Validation runs once intake is complete.${decisionsSummary(stage1)}`;
    if (open1.length > 0) {
      return {
        status: "NEEDS_REVIEW",
        stage: "intake",
        decision: "human_review",
        headline: `Needs your review: ${plural(open1.length, "item")} before validation`,
        reasoning,
        draftKind: send1.length > 0 ? "amendment" : null,
        draftItems: send1,
      };
    }
    return {
      status: "AMENDMENT_READY",
      stage: "intake",
      decision: "amendment_request",
      headline: `Intake: ${intakeSummary(send1)}. Request to the supplier ready`,
      reasoning,
      draftKind: "amendment",
      draftItems: send1,
    };
  }

  if (!stage2) throw new Error("Validation results are required once intake is complete.");
  const open2 = stage2.filter(isOpen);
  const send2 = stage2.filter(toSend);
  const checked =
    input.rulesCount > 0
      ? `${plural(input.rulesCount, "customer rule")} checked on every document, and the documents compared with each other.`
      : "No customer rules apply (accepted by CG); the documents were compared with each other.";
  const findings = [...open2, ...send2].map((i) => i.message.replace(/\.$/, "")).join("; ");
  const reasoning =
    `${base} Intake complete. Validation: ${checked} ` +
    (findings
      ? `Findings: ${findings}.`
      : "Every rule matched and every cross-checked field agrees.") +
    decisionsSummary([...stage1, ...stage2]);

  if (open2.length > 0) {
    return {
      status: "NEEDS_REVIEW",
      stage: "validation",
      decision: "human_review",
      headline: `Needs your review: ${plural(open2.length, "item")}`,
      reasoning,
      draftKind: send2.length > 0 ? "amendment" : null,
      draftItems: send2,
    };
  }
  if (send2.length > 0) {
    return {
      status: "AMENDMENT_READY",
      stage: "validation",
      decision: "amendment_request",
      headline: `${plural(send2.length, "correction")} needed: amendment draft ready`,
      reasoning,
      draftKind: "amendment",
      draftItems: send2,
    };
  }
  return {
    status: "APPROVAL_READY",
    stage: "validation",
    decision: "auto_approve",
    headline:
      input.rulesCount > 0
        ? `Ready to approve: ${plural(input.rulesCount, "rule")} and all cross-document checks passed`
        : "Ready to approve: cross-document checks passed (no customer rules)",
    reasoning,
    draftKind: "approval",
    draftItems: [],
  };
}

/** Grid colour per field: open review beats a correction, which beats ok. */
export function fieldStates(issues: ResolvedIssue[]) {
  const states = new Map<ExtractionField, FieldResult["state"]>();
  for (const issue of issues) {
    if (!issue.field) continue;
    const state = isOpen(issue) ? "review" : toSend(issue) ? "amendment" : null;
    if (!state || states.get(issue.field) === "review") continue;
    states.set(issue.field, state);
  }
  return states;
}
