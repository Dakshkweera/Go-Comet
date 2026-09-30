import { describe, expect, it } from "vitest";
import type { RunView } from "../src/api.js";
import {
  decisionSegments,
  deriveCustomers,
  deriveUnresolved,
  outcomeSegments,
  totalOutcomes,
} from "../src/derived.js";
import { toRecord, type RunRecord } from "../src/domain.js";

type Status = "match" | "mismatch" | "uncertain";

const rule = (id: string, field: string, extra: Record<string, unknown> = {}) => ({
  id,
  customerId: "cust_bata_india",
  field,
  operator: "EXACT",
  expectedValue: "x",
  minValue: null,
  maxValue: null,
  unit: null,
  isActive: true,
  ...extra,
});

const validation = (ruleId: string, field: string, status: Status, extra = {}) => ({
  field,
  status,
  foundText: "x",
  foundNumber: null,
  expectedText: "x",
  expectedNumber: null,
  expectedMin: null,
  expectedMax: null,
  unit: null,
  confidence: 1,
  ruleId,
  ruleOperator: "EXACT",
  reason: status,
  ...extra,
});

const BATA_RULES = [
  rule("rule_bata_weight", "gross_weight", {
    operator: "MAX",
    expectedValue: null,
    maxValue: 1000,
    unit: "kg",
  }),
  rule("rule_bata_hs_code", "hs_code", { expectedValue: "640399" }),
];

function record(
  id: string,
  createdAt: string,
  decision: string | null,
  detail: Partial<RunView> | null,
): RunRecord {
  const summary = { id, filename: `${id}.pdf`, status: "COMPLETED", decision, createdAt };
  if (!detail) return toRecord(summary, null);
  return toRecord(summary, {
    id,
    status: "COMPLETED",
    currentStage: "COMPLETED",
    createdAt,
    completedAt: createdAt,
    document: { filename: `${id}.pdf`, mimeType: "application/pdf", size: 1 },
    extraction: null,
    customer: { status: "resolved", name: "Bata India", reason: "matched" },
    rules: BATA_RULES,
    validations: [],
    decision: null,
    error: null,
    attempts: [],
    ...detail,
  } as unknown as RunView);
}

const runs = [
  record("run_new", "2026-09-29T21:44:55.000Z", "human_review", {
    validations: [
      validation("rule_bata_hs_code", "hs_code", "uncertain"),
      validation("rule_bata_weight", "gross_weight", "uncertain"),
    ],
  } as Partial<RunView>),
  record("run_old", "2026-09-29T21:44:24.000Z", "auto_approve", {
    validations: [
      validation("rule_bata_hs_code", "hs_code", "match"),
      validation("rule_bata_weight", "gross_weight", "match"),
      validation("rule_bata_pod_old", "port_of_discharge", "mismatch", { expectedText: "Mumbai" }),
    ],
  } as Partial<RunView>),
  record("run_mid", "2026-09-29T21:44:41.000Z", "amendment_request", {
    validations: [validation("rule_bata_weight", "gross_weight", "mismatch")],
  } as Partial<RunView>),
  record("run_acme", "2026-09-29T21:40:00.000Z", "human_review", {
    customer: { status: "resolved", name: "Acme Imports", reason: "matched" },
    rules: [],
  }),
  record("run_unknown", "2026-09-29T21:46:00.000Z", "human_review", {
    customer: { status: "not_found", name: null, reason: "No customer matched." },
  }),
  record("run_ambiguous", "2026-09-29T21:30:00.000Z", "human_review", {
    customer: { status: "ambiguous", name: null, reason: "Matched two customers." },
  }),
  record("run_failed", "2026-09-29T21:20:00.000Z", "human_review", { customer: null }),
  record("run_loading", "2026-09-29T21:50:00.000Z", null, null),
];

describe("deriveCustomers", () => {
  const customers = deriveCustomers(runs);
  const bata = customers.find((c) => c.name === "Bata India")!;

  it("groups resolved runs by customer name, alphabetically", () => {
    expect(customers.map((c) => c.name)).toEqual(["Acme Imports", "Bata India"]);
    expect(bata.runs.map((r) => r.id)).toEqual(["run_new", "run_mid", "run_old"]);
    expect(bata.latest.id).toBe("run_new");
  });

  it("counts decisions per customer", () => {
    expect(bata.decisions).toEqual({
      auto_approve: 1,
      human_review: 1,
      amendment_request: 1,
      none: 0,
    });
  });

  it("uses the latest run's active rules in field order, with outcomes by rule id", () => {
    expect(bata.activeRules).toBe(2);
    expect(bata.validatedRuns).toBe(3);
    const active = bata.rules.filter((r) => r.active);
    expect(active.map((r) => r.id)).toEqual(["rule_bata_hs_code", "rule_bata_weight"]);
    expect(active[0]).toMatchObject({ operator: "EXACT", expectation: "640399" });
    expect(active[0]!.outcomes).toEqual({ match: 1, mismatch: 0, uncertain: 1 });
    expect(active[1]).toMatchObject({ operator: "MAX", expectation: "≤ 1,000 kg" });
    expect(active[1]!.outcomes).toEqual({ match: 1, mismatch: 1, uncertain: 1 });
  });

  it("keeps rules seen only in past validations as inactive", () => {
    const retired = bata.rules.filter((r) => !r.active);
    expect(retired).toEqual([
      {
        id: "rule_bata_pod_old",
        field: "port_of_discharge",
        operator: "EXACT",
        expectation: "Mumbai",
        active: false,
        outcomes: { match: 0, mismatch: 1, uncertain: 0 },
      },
    ]);
  });

  it("reports customers without rules", () => {
    const acme = customers.find((c) => c.name === "Acme Imports")!;
    expect(acme.activeRules).toBe(0);
    expect(acme.rules).toEqual([]);
    expect(acme.validatedRuns).toBe(0);
  });

  it("returns nothing when no run resolved a customer", () => {
    expect(deriveCustomers([])).toEqual([]);
    expect(deriveCustomers(runs.filter((r) => !r.customer))).toEqual([]);
  });
});

describe("deriveUnresolved", () => {
  it("lists not-found and ambiguous resolutions, newest first", () => {
    const unresolved = deriveUnresolved(runs);
    expect(unresolved.map((u) => [u.run.id, u.status, u.reason])).toEqual([
      ["run_unknown", "not_found", "No customer matched."],
      ["run_ambiguous", "ambiguous", "Matched two customers."],
    ]);
  });
});

describe("segments", () => {
  it("builds decision segments and only adds 'No decision' when needed", () => {
    const counts = { auto_approve: 2, human_review: 1, amendment_request: 0, none: 0 };
    expect(decisionSegments(counts).map((s) => [s.key, s.tone, s.count])).toEqual([
      ["auto_approve", "success", 2],
      ["human_review", "warning", 1],
      ["amendment_request", "danger", 0],
    ]);
    expect(decisionSegments({ ...counts, none: 1 }).at(-1)).toMatchObject({
      key: "none",
      count: 1,
    });
  });

  it("builds outcome segments and totals", () => {
    const counts = { match: 3, mismatch: 1, uncertain: 2 };
    expect(outcomeSegments(counts).map((s) => [s.label, s.count])).toEqual([
      ["Match", 3],
      ["Mismatch", 1],
      ["Uncertain", 2],
    ]);
    expect(totalOutcomes(counts)).toBe(6);
  });
});
