import {
  REQUIRED_FIELDS,
  type Decision,
  type EvidenceStatus,
  type ExtractedNumberField,
  type ExtractedTextField,
  type ExtractionField,
  type PipelineStage,
  type ValidationResult,
  type ValidationStatus,
} from "./types/api.js";
import type { RunSummary, RunView } from "./api.js";

// Server default EXTRACTION_MIN_CONFIDENCE; runs report the threshold they were processed with.
const DEFAULT_MIN_CONFIDENCE = 0.8;

export const minConfidence = (run: RunView) =>
  run.reliability?.minConfidence ?? DEFAULT_MIN_CONFIDENCE;

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

export const FIELD_LABELS: Record<ExtractionField, string> = {
  consignee_name: "Consignee",
  hs_code: "HS Code",
  port_of_loading: "Port of Loading",
  port_of_discharge: "Port of Discharge",
  incoterms: "Incoterms",
  description_of_goods: "Description of Goods",
  gross_weight: "Gross Weight",
  invoice_number: "Invoice Number",
};

export const fieldLabel = (field: string) =>
  FIELD_LABELS[field as ExtractionField] ?? field.replaceAll("_", " ");

export const DECISIONS: Record<Decision, { label: string; tone: Tone }> = {
  auto_approve: { label: "Auto approved", tone: "success" },
  human_review: { label: "Human review", tone: "warning" },
  amendment_request: { label: "Amendment request", tone: "danger" },
};

export const decisionMeta = (decision: string | null | undefined) =>
  decision ? (DECISIONS[decision as Decision] ?? null) : null;

export const isFinal = (status: string) => status === "COMPLETED" || status === "FAILED";

export const RUN_STATUS: Record<string, { label: string; tone: Tone }> = {
  RECEIVED: { label: "Queued", tone: "info" },
  PROCESSING: { label: "Processing", tone: "info" },
  COMPLETED: { label: "Completed", tone: "neutral" },
  FAILED: { label: "Failed", tone: "danger" },
};

export const runStatusMeta = (status: string) =>
  RUN_STATUS[status] ?? { label: status.toLowerCase(), tone: "neutral" as Tone };

export const EVIDENCE: Record<EvidenceStatus, { label: string; tone: Tone; hint: string }> = {
  supported: {
    label: "Supported",
    tone: "success",
    hint: "The value appears in the document text.",
  },
  unverified: {
    label: "Unverified",
    tone: "neutral",
    hint: "The value could not be checked against the document text.",
  },
  ambiguous: {
    label: "Ambiguous",
    tone: "warning",
    hint: "The document text for this field is unclear.",
  },
  contradicted: {
    label: "Contradicted",
    tone: "danger",
    hint: "The document text disagrees with the extracted value.",
  },
};

export const VALIDATION: Record<ValidationStatus, { label: string; tone: Tone }> = {
  match: { label: "Match", tone: "success" },
  mismatch: { label: "Mismatch", tone: "danger" },
  uncertain: { label: "Uncertain", tone: "warning" },
};

export type SignalLevel = "high" | "medium" | "low";

export function confidenceSignal(
  confidence: number,
  threshold: number,
): { level: SignalLevel; tone: Tone } {
  if (confidence >= threshold) return { level: "high", tone: "success" };
  if (confidence >= 0.5) return { level: "medium", tone: "warning" };
  return { level: "low", tone: "danger" };
}

export type ExtractedField = ExtractedTextField | ExtractedNumberField;
type AnyField = ExtractedField;

export function formatFieldValue(field: AnyField): string | null {
  if (field.value === null || field.value === "") return null;
  if (typeof field.value === "number") {
    const unit = "unit" in field && field.unit ? ` ${field.unit}` : "";
    return `${field.value.toLocaleString()}${unit}`;
  }
  return field.value;
}

export const hasConflict = (field: AnyField) =>
  !!field.candidates && new Set(field.candidates.map(String)).size > 1;

// The server's reliability assessment, i.e. the same checks the router used for this run.
export const fieldReasons = (run: RunView, field: ExtractionField): string[] =>
  run.reliability?.fields[field]?.reasons ?? [];

const withUnit = (n: number | null, unit: string | null) =>
  n == null ? "—" : `${n.toLocaleString()}${unit ? ` ${unit}` : ""}`;

// foundNumber is the raw extracted value; v.unit is the rule's unit, so prefer the document's unit.
export function formatFound(v: ValidationResult, extracted?: AnyField | null): string {
  if (v.foundText != null) return v.foundText;
  const unit = extracted && "unit" in extracted && extracted.unit ? extracted.unit : v.unit;
  return v.foundNumber != null ? withUnit(v.foundNumber, unit) : "—";
}

export function formatExpected(v: ValidationResult): string {
  switch (v.ruleOperator) {
    case "MAX":
      return `≤ ${withUnit(v.expectedMax, v.unit)}`;
    case "MIN":
      return `≥ ${withUnit(v.expectedMin, v.unit)}`;
    case "RANGE":
      return `${v.expectedMin ?? "—"}–${withUnit(v.expectedMax, v.unit)}`;
    default:
      return v.expectedText ?? (v.expectedNumber != null ? String(v.expectedNumber) : "—");
  }
}

export type RuleLike = RunView["rules"][number];

export function formatRuleExpectation(rule: RuleLike): string {
  switch (rule.operator) {
    case "MAX":
      return `≤ ${withUnit(rule.maxValue, rule.unit)}`;
    case "MIN":
      return `≥ ${withUnit(rule.minValue, rule.unit)}`;
    case "RANGE":
      return `${rule.minValue ?? "—"}–${withUnit(rule.maxValue, rule.unit)}`;
    default:
      return rule.expectedValue == null ? "—" : String(rule.expectedValue);
  }
}

export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function listText(items: string[]): string {
  if (items.length <= 2) return items.join(" and ");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export function candidateList(field: AnyField): string {
  const unit = "unit" in field && field.unit ? ` ${field.unit}` : "";
  const values = (field.candidates ?? []).map((c) =>
    typeof c === "number" ? c.toLocaleString() : c,
  );
  return `${values.join(" / ")}${unit}`;
}

function phrase(reason: string, field?: AnyField | null): string {
  const low = /^low extraction confidence \(([\d.]+)/i.exec(reason);
  if (low) return `below confidence threshold (${low[1]})`;
  const conflict = /^conflicting values in the document \((.*)\)$/i.exec(reason);
  if (conflict) {
    return `conflicting values (${field?.candidates?.length ? candidateList(field) : conflict[1]})`;
  }
  if (/ambiguous/i.test(reason)) return "ambiguous source evidence";
  if (/contradicts/i.test(reason)) return "contradicted by the document text";
  if (/^no supporting evidence/i.test(reason)) return "no supporting evidence";
  if (/^not found in the document/i.test(reason)) return "not found in the document";
  if (/not a valid HS code/i.test(reason)) return "invalid HS code format";
  if (/must be positive/i.test(reason)) return "non-positive weight";
  return reason.charAt(0).toLowerCase() + reason.slice(1);
}

// Condenses router/validator reason strings into short phrases, e.g. "ambiguous source evidence".
export function reasonPhrases(reasons: string[], field?: AnyField | null): string[] {
  const parts = reasons.flatMap((r) =>
    r
      .replace(/^cannot validate:\s*/i, "")
      .replace(/\.$/, "")
      .split("; "),
  );
  return [...new Set(parts.map((p) => phrase(p.trim(), field)))];
}

export type IssueKind = "field" | "mismatch" | "customer" | "rules" | "error";

export type Issue = {
  kind: IssueKind;
  field: ExtractionField | null;
  title: string;
  reasons: string[];
  found?: string;
  expected?: string;
};

// Reconstructs why the router chose its decision, using the same reliability checks.
export function runIssues(run: RunView): Issue[] {
  const decision = run.decision?.decision;
  if (decision === "amendment_request") {
    return run.decision!.discrepancies.map((d) => ({
      kind: "mismatch",
      field: d.field,
      title: fieldLabel(d.field),
      reasons: [d.reason],
      found: d.found,
      expected: d.expected,
    }));
  }
  if (decision !== "human_review") return [];

  if (!run.extraction || run.error) {
    return [
      {
        kind: "error",
        field: null,
        title: "Document could not be processed",
        reasons: [run.error?.message ?? "No extraction result was produced."],
      },
    ];
  }
  if (!run.customer || run.customer.status !== "resolved") {
    return [
      {
        kind: "customer",
        field: null,
        title:
          run.customer?.status === "ambiguous"
            ? "Customer is ambiguous"
            : "Customer not identified",
        reasons: [run.customer?.reason ?? "No customer resolution was recorded."],
      },
    ];
  }
  if (run.validations.length === 0) {
    return [
      {
        kind: "rules",
        field: null,
        title: "No customer rules configured",
        reasons: [
          `No validation rules are configured for ${run.customer.name ?? "this customer"}.`,
        ],
      },
    ];
  }

  const issues = new Map<ExtractionField, Issue>();
  for (const field of REQUIRED_FIELDS) {
    const reasons = fieldReasons(run, field);
    if (reasons.length) {
      issues.set(field, { kind: "field", field, title: fieldLabel(field), reasons });
    }
  }
  for (const v of run.validations) {
    if (v.status === "uncertain" && !issues.has(v.field)) {
      issues.set(v.field, {
        kind: "field",
        field: v.field,
        title: fieldLabel(v.field),
        reasons: [v.reason],
      });
    }
  }
  return [...issues.values()];
}

export function issueComparison(run: RunView, issue: Issue): { found: string; expected: string } {
  const v = run.validations.find((x) => x.field === issue.field && x.status === "mismatch");
  if (v) return { found: formatFound(v, run.extraction?.[v.field]), expected: formatExpected(v) };
  return { found: issue.found ?? "—", expected: issue.expected ?? "—" };
}

// The most specific phrase for an uncertain field, e.g. "ambiguous source evidence".
export function issueHeadline(run: RunView, issue: Issue): string {
  const extracted = issue.field && run.extraction ? run.extraction[issue.field] : null;
  const phrases = reasonPhrases(issue.reasons, extracted);
  return phrases.find((p) => !p.startsWith("below confidence")) ?? phrases[0] ?? "uncertain";
}

export function issueSummary(run: RunView | null, decision: string | null): string {
  if (!run) return decision ? "Loading details…" : "—";
  const issues = runIssues(run);
  const first = issues[0];
  if (!first) return decision === "auto_approve" ? "All rules matched" : "—";
  if (first.kind === "mismatch") {
    return `${issues.length} rule${issues.length === 1 ? "" : "s"} mismatched`;
  }
  if (first.kind === "field") {
    return `${issues.length} field${issues.length === 1 ? "" : "s"} uncertain`;
  }
  return first.title;
}

export type StepKey = "extract" | "customer" | "validate" | "decide";
export type StepState = "done" | "active" | "pending" | "warning" | "failed" | "skipped";
export type PipelineStep = { key: StepKey; label: string; state: StepState; detail: string };

const STAGE_ORDER: PipelineStage[] = [
  "RECEIVED",
  "EXTRACTING",
  "EXTRACTED",
  "CUSTOMER_RESOLVING",
  "CUSTOMER_RESOLVED",
  "VALIDATING",
  "VALIDATED",
  "ROUTING",
  "ROUTED",
  "COMPLETED",
];

export const stageIndex = (stage: string) => STAGE_ORDER.indexOf(stage as PipelineStage);

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// The orchestrator persists RECEIVED → EXTRACTING → EXTRACTED → COMPLETED; resolution,
// validation and routing run together right after extraction.
export function pipelineSteps(run: RunView): PipelineStep[] {
  if (!isFinal(run.status)) {
    const extracted = stageIndex(run.currentStage) >= stageIndex("EXTRACTED");
    const attempt = run.attempts.filter((a) => a.stage === "EXTRACTING").length;
    return [
      {
        key: "extract",
        label: "Extract",
        state: extracted ? "done" : "active",
        detail: extracted
          ? "Fields extracted"
          : attempt > 1
            ? `Attempt ${attempt}`
            : "Reading document",
      },
      {
        key: "customer",
        label: "Customer",
        state: extracted ? "active" : "pending",
        detail: extracted ? "Resolving" : "Waiting",
      },
      { key: "validate", label: "Validate", state: "pending", detail: "Waiting" },
      { key: "decide", label: "Decision", state: "pending", detail: "Waiting" },
    ];
  }

  const ex = run.extraction;
  const found = ex ? REQUIRED_FIELDS.filter((f) => formatFieldValue(ex[f]) !== null).length : 0;
  const extract: PipelineStep = ex
    ? {
        key: "extract",
        label: "Extract",
        state: found === REQUIRED_FIELDS.length ? "done" : "warning",
        detail: `${found} of ${REQUIRED_FIELDS.length} fields`,
      }
    : { key: "extract", label: "Extract", state: "failed", detail: "Extraction failed" };

  const resolved = run.customer?.status === "resolved";
  const customer: PipelineStep = !run.customer
    ? { key: "customer", label: "Customer", state: "skipped", detail: "Not attempted" }
    : resolved
      ? {
          key: "customer",
          label: "Customer",
          state: "done",
          detail: run.customer.name ?? "Resolved",
        }
      : {
          key: "customer",
          label: "Customer",
          state: "warning",
          detail: run.customer.status === "ambiguous" ? "Ambiguous match" : "Not found",
        };

  const counts = countValidations(run.validations);
  const validate: PipelineStep =
    run.validations.length === 0
      ? {
          key: "validate",
          label: "Validate",
          state: "skipped",
          detail: resolved ? "No rules configured" : "No rules applied",
        }
      : counts.mismatch > 0
        ? {
            key: "validate",
            label: "Validate",
            state: "failed",
            detail: `${counts.mismatch} mismatched`,
          }
        : counts.uncertain > 0
          ? {
              key: "validate",
              label: "Validate",
              state: "warning",
              detail: `${counts.uncertain} uncertain`,
            }
          : {
              key: "validate",
              label: "Validate",
              state: "done",
              detail: `${counts.match} of ${run.validations.length} matched`,
            };

  const meta = decisionMeta(run.decision?.decision);
  const decide: PipelineStep = meta
    ? {
        key: "decide",
        label: "Decision",
        state: meta.tone === "success" ? "done" : meta.tone === "danger" ? "failed" : "warning",
        detail: meta.label,
      }
    : { key: "decide", label: "Decision", state: "failed", detail: "No decision" };

  return [extract, customer, validate, decide];
}

export function countValidations(validations: ValidationResult[]) {
  const counts = { match: 0, mismatch: 0, uncertain: 0 };
  for (const v of validations) counts[v.status]++;
  return counts;
}

export type RunRecord = RunSummary & {
  detail: RunView | null;
  customer: string | null;
  customerStatus: string | null;
  consignee: string | null;
  invoice: string | null;
  origin: string | null;
  destination: string | null;
  completedAt: string | null;
};

export function toRecord(summary: RunSummary, detail: RunView | null): RunRecord {
  const ex = detail?.extraction ?? null;
  return {
    ...summary,
    detail,
    customer: detail?.customer?.status === "resolved" ? detail.customer.name : null,
    customerStatus: detail?.customer?.status ?? null,
    consignee: ex?.consignee_name.value ?? null,
    invoice: ex?.invoice_number.value ?? null,
    origin: ex?.port_of_loading.value ?? null,
    destination: ex?.port_of_discharge.value ?? null,
    completedAt: detail?.completedAt ?? null,
  };
}

export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const seconds = Math.round((now - new Date(iso).getTime()) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export const formatDateTime = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDuration(fromIso: string, toIso: string | null): string | null {
  if (!toIso) return null;
  const seconds = Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export const fileKind = (filenameOrMime: string) => {
  const s = filenameOrMime.toLowerCase();
  if (s.includes("pdf")) return "PDF";
  if (s.includes("png")) return "PNG";
  if (s.includes("jp")) return "JPEG";
  if (s.includes("webp")) return "WEBP";
  return "File";
};
