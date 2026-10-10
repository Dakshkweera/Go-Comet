import type {
  Decision,
  ExtractionField,
  RuleOperator,
  ValidationResult,
  ValidationStatus,
} from "./types/api.js";
import type { RunView } from "./api.js";
import {
  DECISIONS,
  FIELD_LABELS,
  VALIDATION,
  formatExpected,
  formatRuleExpectation,
  type RunRecord,
  type Tone,
} from "./domain.js";

export type OutcomeCounts = Record<ValidationStatus, number>;
export type DecisionCounts = Record<Decision, number> & { none: number };

export type DerivedRule = {
  id: string;
  field: ExtractionField;
  operator: RuleOperator | null;
  expectation: string;
  active: boolean;
  outcomes: OutcomeCounts;
};

export type DerivedCustomer = {
  name: string;
  runs: RunRecord[];
  latest: RunRecord;
  decisions: DecisionCounts;
  rules: DerivedRule[];
  activeRules: number;
  validatedRuns: number;
};

export type UnresolvedRun = {
  run: RunRecord;
  status: "not_found" | "ambiguous";
  consignee: string | null;
  reason: string | null;
};

export type Segment = { key: string; label: string; tone: Tone; count: number };

type ResolvedRun = RunRecord & { detail: RunView; customer: string };

const isResolved = (run: RunRecord): run is ResolvedRun =>
  run.detail !== null && run.customer !== null;

const isDecision = (decision: string | null): decision is Decision =>
  decision !== null && decision in DECISIONS;

const newestFirst = (a: RunRecord, b: RunRecord) =>
  Date.parse(b.createdAt) - Date.parse(a.createdAt);

const FIELD_ORDER = Object.keys(FIELD_LABELS);
const byField = (a: DerivedRule, b: DerivedRule) =>
  FIELD_ORDER.indexOf(a.field) - FIELD_ORDER.indexOf(b.field);

const noOutcomes = (): OutcomeCounts => ({ match: 0, mismatch: 0, uncertain: 0 });

export const totalOutcomes = (counts: OutcomeCounts) =>
  counts.match + counts.mismatch + counts.uncertain;

// Rules come from the newest run's detail: the API loads a customer's active rules live.
function toCustomer(name: string, runs: ResolvedRun[]): DerivedCustomer {
  const latest = runs[0]!;
  const decisions: DecisionCounts = {
    auto_approve: 0,
    human_review: 0,
    amendment_request: 0,
    none: 0,
  };
  const outcomes = new Map<string, OutcomeCounts>();
  const lastSeen = new Map<string, ValidationResult>();

  for (const run of runs) {
    decisions[isDecision(run.decision) ? run.decision : "none"]++;
    for (const v of run.detail.validations) {
      if (!v.ruleId) continue;
      const counts = outcomes.get(v.ruleId) ?? noOutcomes();
      counts[v.status]++;
      outcomes.set(v.ruleId, counts);
      if (!lastSeen.has(v.ruleId)) lastSeen.set(v.ruleId, v);
    }
  }

  const current: DerivedRule[] = latest.detail.rules
    .filter((rule) => rule.isActive)
    .map((rule) => ({
      id: rule.id,
      field: rule.field,
      operator: rule.operator,
      expectation: formatRuleExpectation(rule),
      active: true,
      outcomes: outcomes.get(rule.id) ?? noOutcomes(),
    }));
  const currentIds = new Set(current.map((rule) => rule.id));
  const retired: DerivedRule[] = [...lastSeen]
    .filter(([id]) => !currentIds.has(id))
    .map(([id, v]) => ({
      id,
      field: v.field,
      operator: v.ruleOperator,
      expectation: formatExpected(v),
      active: false,
      outcomes: outcomes.get(id) ?? noOutcomes(),
    }));

  return {
    name,
    runs,
    latest,
    decisions,
    rules: [...current.sort(byField), ...retired.sort(byField)],
    activeRules: current.length,
    validatedRuns: runs.filter((run) => run.detail.validations.length > 0).length,
  };
}

export function deriveCustomers(runs: RunRecord[]): DerivedCustomer[] {
  const groups = new Map<string, ResolvedRun[]>();
  for (const run of runs.filter(isResolved).sort(newestFirst)) {
    const group = groups.get(run.customer);
    if (group) group.push(run);
    else groups.set(run.customer, [run]);
  }
  return [...groups]
    .map(([name, group]) => toCustomer(name, group))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function deriveUnresolved(runs: RunRecord[]): UnresolvedRun[] {
  const unresolved: UnresolvedRun[] = [];
  for (const run of [...runs].sort(newestFirst)) {
    const customer = run.detail?.customer;
    if (customer?.status === "not_found" || customer?.status === "ambiguous") {
      unresolved.push({
        run,
        status: customer.status,
        consignee: run.consignee,
        reason: customer.reason,
      });
    }
  }
  return unresolved;
}

export function decisionSegments(counts: DecisionCounts): Segment[] {
  const segments: Segment[] = (Object.keys(DECISIONS) as Decision[]).map((key) => ({
    key,
    label: DECISIONS[key].label,
    tone: DECISIONS[key].tone,
    count: counts[key],
  }));
  if (counts.none > 0) {
    segments.push({ key: "none", label: "No decision", tone: "neutral", count: counts.none });
  }
  return segments;
}

export const outcomeSegments = (counts: OutcomeCounts): Segment[] =>
  (Object.keys(VALIDATION) as ValidationStatus[]).map((key) => ({
    key,
    label: VALIDATION[key].label,
    tone: VALIDATION[key].tone,
    count: counts[key],
  }));
