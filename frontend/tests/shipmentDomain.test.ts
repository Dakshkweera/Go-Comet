import { describe, expect, it } from "vitest";
import {
  applyFilter,
  arrivalMessage,
  attentionShipments,
  backTarget,
  canSubmitClarify,
  cellTone,
  clarifyForm,
  confidenceMeta,
  docStatusMeta,
  draftEdits,
  emailDocuments,
  EXCEPTION_FILTERS,
  eventMeta,
  exceptionCount,
  expectedSource,
  fieldExpectation,
  fieldResult,
  fileProgressMeta,
  filterCounts,
  finishedShipments,
  formatMinutes,
  formatObservation,
  gridSummary,
  isDraftDirty,
  isProcessing,
  latestCycleDocuments,
  latestEvent,
  longestWaitingFirst,
  mailRows,
  matchesShipmentQuery,
  outboundKindMeta,
  parseFilter,
  pipelineCounts,
  primaryAction,
  processingShipments,
  processingSteps,
  progressPercent,
  progressText,
  recentShipments,
  reviewGroups,
  SHIPMENT_FILTERS,
  sendFailure,
  senderOf,
  shipmentPath,
  shipmentStatusMeta,
  stageLabel,
} from "../src/shipmentDomain.js";
import type {
  FieldObservation,
  ShipmentDocument,
  ShipmentEmail,
  ShipmentField,
  ShipmentIssue,
  ShipmentStatus,
  ShipmentSummary,
  ShipmentView,
} from "../src/types/api.js";

const doc = (id: string, over: Partial<ShipmentDocument> = {}): ShipmentDocument => ({
  id,
  runId: `run_${id}`,
  filename: `${id}.pdf`,
  mimeType: "application/pdf",
  size: 1000,
  cycle: 1,
  current: true,
  unchangedFromCycle: null,
  docType: "PACKING_LIST",
  docTypeLabel: "Packing list",
  docTypeReason: null,
  status: "extracted",
  error: null,
  fileUrl: `/api/runs/run_${id}/document`,
  ...over,
});

const obs = (documentId: string, over: Partial<FieldObservation> = {}): FieldObservation => ({
  documentId,
  filename: `${documentId}.pdf`,
  docType: "PACKING_LIST",
  value: "6403.22",
  unit: null,
  confidence: 0.96,
  confidenceLevel: "high",
  reliable: true,
  reasons: [],
  evidence: "HS CODE: 6403.22",
  evidenceStatus: "supported",
  isOwner: false,
  agrees: true,
  ...over,
});

const field = (over: Partial<ShipmentField> = {}): ShipmentField => ({
  field: "hs_code",
  label: "HS code",
  state: "ok",
  ruleStatus: "match",
  consistency: "consistent",
  ownerDocType: null,
  value: "6403.99",
  unit: null,
  expected: "6403.99",
  reason: null,
  observations: [],
  ...over,
});

const issue = (over: Partial<ShipmentIssue> = {}): ShipmentIssue => ({
  key: "rule_mismatch:hs_code:doc_pl",
  stage: "validation",
  severity: "amendment",
  kind: "rule_mismatch",
  field: "hs_code",
  fieldLabel: "HS code",
  documents: [{ id: "doc_pl", filename: "PL.pdf", docType: "PACKING_LIST" }],
  found: "6403.22",
  expected: "6403.99",
  reference: { source: "rule", ruleId: "rule_bata_hs_code" },
  message: "HS code on the packing list shows 6403.22; Bata India requires 6403.99.",
  request: "HS code: shows 6403.22; Bata India requires 6403.99. Please correct it.",
  allowedActions: ["clarify"],
  actionRules: { clarify: { value: "none", note: "required" } },
  resolution: null,
  ...over,
});

describe("status labels", () => {
  it.each([
    ["RECEIVED", "Received", "neutral"],
    ["PROCESSING", "Processing", "info"],
    ["NEEDS_REVIEW", "Needs your review", "warning"],
    ["AMENDMENT_READY", "Amendment ready", "danger"],
    ["APPROVAL_READY", "Ready to approve", "success"],
    ["AMENDMENT_SENT", "Waiting for supplier", "neutral"],
    ["APPROVAL_SENT", "Approved and sent", "success"],
    ["FAILED", "Failed", "danger"],
  ])("%s → %s (%s)", (status, label, tone) => {
    expect(shipmentStatusMeta(status)).toEqual({ label, tone });
  });

  it("never shows a raw code for an unknown status", () => {
    expect(shipmentStatusMeta("SOMETHING_NEW").label).toBe("Status unavailable");
  });

  it("treats only RECEIVED and PROCESSING as processing", () => {
    expect(["RECEIVED", "PROCESSING"].every(isProcessing)).toBe(true);
    expect(["NEEDS_REVIEW", "AMENDMENT_SENT", "FAILED"].some(isProcessing)).toBe(false);
  });
});

const summary = (
  id: string,
  status: ShipmentStatus,
  over: Partial<ShipmentSummary> = {},
): ShipmentSummary => ({
  id,
  reference: `SHP-000${id}`,
  subject: "Shipment documents INV-2026-2041",
  supplier: { name: "Guangzhou Leatherworks Co., Ltd.", address: "docs@gzleather.example" },
  customer: { name: "Bata India" },
  status,
  stage: "intake",
  decision: null,
  headline: "Ready to approve",
  cycle: 1,
  attachments: 3,
  openReviewItems: 0,
  amendmentItems: 0,
  receivedAt: "2026-10-11T08:00:00.000Z",
  updatedAt: "2026-10-11T08:00:00.000Z",
  ...over,
});

describe("shipment filters", () => {
  const list = (
    [
      "NEEDS_REVIEW",
      "AMENDMENT_READY",
      "AMENDMENT_READY",
      "PROCESSING",
      "APPROVAL_SENT",
    ] as ShipmentStatus[]
  ).map((status) => ({ status }));

  it("falls back to all for an unknown filter", () => {
    expect(parseFilter(SHIPMENT_FILTERS, "nonsense").key).toBe("all");
    expect(parseFilter(SHIPMENT_FILTERS, "waiting").key).toBe("waiting");
    expect(parseFilter(SHIPMENT_FILTERS, null).key).toBe("all");
  });

  it("groups statuses into the chips", () => {
    const pick = (key: string) => applyFilter(list, parseFilter(SHIPMENT_FILTERS, key));
    expect(pick("amendment")).toHaveLength(2);
    expect(pick("done")).toHaveLength(1);
    expect(pick("all")).toHaveLength(5);
  });

  it("counts every chip", () => {
    expect(filterCounts(list, SHIPMENT_FILTERS)).toEqual({
      all: 5,
      review: 1,
      amendment: 2,
      approval: 0,
      waiting: 0,
      done: 1,
    });
  });
});

describe("exception filters", () => {
  const list = (
    ["NEEDS_REVIEW", "AMENDMENT_READY", "APPROVAL_READY", "PROCESSING", "APPROVAL_SENT"] as const
  ).map((status) => ({ status }));

  it("hold only what needs a decision or an amendment, not clean or finished shipments", () => {
    expect(filterCounts(list, EXCEPTION_FILTERS)).toEqual({
      all: 2,
      review: 1,
      amendment: 1,
    });
    expect(exceptionCount(list)).toBe(2);
  });

  it("explains every filter", () => {
    expect(EXCEPTION_FILTERS.every((f) => (f.hint ?? "").length > 0)).toBe(true);
  });
});

describe("shipment search", () => {
  const shipment = summary("1", "NEEDS_REVIEW", { headline: "HS code unreadable" });

  it.each([
    ["shp-0001", true],
    ["leatherworks 2041", true],
    ["bata", true],
    ["unreadable", true],
    ["gzleather.example", true],
    ["leatherworks 9999", false],
  ])("%s → %s", (query, expected) => {
    expect(matchesShipmentQuery(shipment, query)).toBe(expected);
  });

  it("matches everything for an empty search", () => {
    expect(matchesShipmentQuery(shipment, "   ")).toBe(true);
  });
});

describe("pipeline overview", () => {
  const at = (minute: number) => `2026-10-11T08:${String(minute).padStart(2, "0")}:00.000Z`;
  const list = [
    summary("1", "PROCESSING", { updatedAt: at(5), receivedAt: at(1) }),
    summary("2", "RECEIVED", { updatedAt: at(6), receivedAt: at(2) }),
    summary("3", "NEEDS_REVIEW", { updatedAt: at(10) }),
    summary("4", "AMENDMENT_READY", { updatedAt: at(3) }),
    summary("5", "APPROVAL_READY", { updatedAt: at(7) }),
    summary("6", "AMENDMENT_SENT", { updatedAt: at(8) }),
    summary("7", "APPROVAL_SENT", { updatedAt: at(9) }),
  ];

  it("counts shipments at each step, treating received and processing as one", () => {
    expect(pipelineCounts(list)).toEqual({
      processing: 2,
      review: 1,
      amendment: 1,
      approval: 1,
      waiting: 1,
      done: 1,
    });
  });

  it("lists what needs the CG, longest waiting first", () => {
    expect(attentionShipments(list, 10).map((s) => s.id)).toEqual(["4", "5", "3"]);
    expect(attentionShipments(list, 2).map((s) => s.id)).toEqual(["4", "5"]);
  });

  it("lists recent activity newest first", () => {
    expect(recentShipments(list, 3).map((s) => s.id)).toEqual(["3", "7", "6"]);
  });

  it("separates what is being processed from what just finished", () => {
    expect(processingShipments(list).map((s) => s.id)).toEqual(["2", "1"]);
    expect(finishedShipments(list, 2).map((s) => s.id)).toEqual(["3", "7"]);
  });

  it("does not reorder the list it is given", () => {
    const before = list.map((s) => s.id);
    attentionShipments(list, 5);
    recentShipments(list, 5);
    longestWaitingFirst(list);
    expect(list.map((s) => s.id)).toEqual(before);
  });
});

describe("returning to the list a shipment was opened from", () => {
  it("builds a link that remembers its origin", () => {
    expect(shipmentPath("shp_1", "processing")).toBe("/shipments/shp_1?from=processing");
    expect(shipmentPath("shp 1")).toBe("/shipments/shp%201");
  });

  it("goes back to the origin, or to Shipments when it is unknown", () => {
    expect(backTarget("exceptions")).toEqual({ to: "/exceptions", label: "Exceptions" });
    expect(backTarget("overview")).toEqual({ to: "/", label: "Overview" });
    expect(backTarget("nonsense")).toEqual({ to: "/shipments", label: "Shipments" });
    expect(backTarget("constructor")).toEqual({ to: "/shipments", label: "Shipments" });
    expect(backTarget(null)).toEqual({ to: "/shipments", label: "Shipments" });
  });
});

describe("processing steps", () => {
  it("is reading while attachments remain", () => {
    const steps = processingSteps({ progress: { total: 3, done: 1, failed: 0 } });
    expect(steps.map((s) => s.state)).toEqual(["done", "active", "pending", "pending"]);
    expect(steps[1]?.detail).toBe("1 of 3 attachments read");
  });

  it("moves on to checking once every attachment is read", () => {
    const steps = processingSteps({ progress: { total: 3, done: 3, failed: 0 } });
    expect(steps.map((s) => s.state)).toEqual(["done", "done", "active", "pending"]);
  });

  it("stays on reading when there is nothing to count yet", () => {
    const steps = processingSteps({ progress: { total: 0, done: 0, failed: 0 } });
    expect(steps[1]).toMatchObject({ state: "active", detail: null });
  });

  it("tells a waiting file from one being read", () => {
    expect(fileProgressMeta("pending")).toEqual({ label: "Waiting", tone: "neutral" });
    expect(fileProgressMeta("processing").label).toBe("Reading…");
    expect(fileProgressMeta("extracted").label).toBe("Read");
    expect(fileProgressMeta("something_new").label).toBe("Status unavailable");
  });

  it("shows only the files of the email being processed", () => {
    const documents = [doc("a", { cycle: 1 }), doc("b", { cycle: 2 }), doc("c", { cycle: 2 })];
    expect(latestCycleDocuments({ documents, cycle: 2 }).map((d) => d.id)).toEqual(["b", "c"]);
  });

  it("reads the latest event", () => {
    expect(latestEvent({ events: [] })).toBeNull();
    const events = [
      { type: "received", message: "Email received", at: "t1" },
      { type: "attachment_read", message: "CI.pdf read", at: "t2" },
    ];
    expect(latestEvent({ events })?.message).toBe("CI.pdf read");
  });
});

describe("received mail", () => {
  it.each([
    [
      "Guangzhou Leatherworks <docs@gz.example>",
      { name: "Guangzhou Leatherworks", address: "docs@gz.example" },
    ],
    ['"Li Wei" <li@gz.example>', { name: "Li Wei", address: "li@gz.example" }],
    ["docs@gz.example", { name: null, address: "docs@gz.example" }],
    ["<docs@gz.example>", { name: null, address: "docs@gz.example" }],
  ])("reads the sender of %s", (from, expected) => {
    expect(senderOf(from)).toEqual(expected);
  });

  const view = (id: string, reference: string, emails: Partial<ShipmentEmail>[]) =>
    ({
      id,
      reference,
      documents: [doc("d1"), doc("d2"), doc("d3")],
      emails: emails.map((e, i) => ({
        id: `email_${id}_${i}`,
        cycle: i + 1,
        from: "Supplier <s@gz.example>",
        subject: "Documents",
        receivedAt: "2026-10-11T08:00:00.000Z",
        bodyText: "Hello",
        documentIds: [],
        ...e,
      })),
    }) as unknown as ShipmentView;

  it("lists every email, newest first, with the shipment it belongs to", () => {
    const rows = mailRows([
      view("a", "SHP-0001", [
        { receivedAt: "2026-10-11T08:00:00.000Z", documentIds: ["d1", "d2"] },
        { receivedAt: "2026-10-11T08:30:00.000Z", subject: "Re: Documents", documentIds: ["d3"] },
      ]),
      view("b", "SHP-0002", [{ receivedAt: "2026-10-11T08:10:00.000Z" }]),
    ]);
    expect(rows.map((r) => [r.reference, r.cycle])).toEqual([
      ["SHP-0001", 2],
      ["SHP-0002", 1],
      ["SHP-0001", 1],
    ]);
    expect(rows[0]).toMatchObject({ shipmentId: "a", subject: "Re: Documents", body: "Hello" });
    expect(rows[0]?.files.map((f) => f.id)).toEqual(["d3"]);
    expect(rows[2]?.files.map((f) => f.id)).toEqual(["d1", "d2"]);
  });

  it("is empty when nothing was received", () => {
    expect(mailRows([])).toEqual([]);
  });
});

describe("arrival message", () => {
  it("names the shipment a new email created", () => {
    expect(arrivalMessage({ reference: "SHP-0005", cycle: 1 })).toBe(
      "Delivered. It arrived in the Inbox as SHP-0005.",
    );
  });

  it("names the cycle a reply added to an existing shipment", () => {
    expect(arrivalMessage({ reference: "SHP-0003", cycle: 2 })).toBe(
      "Delivered. It was added to SHP-0003 as cycle 2.",
    );
  });

  it("says plainly when nothing arrived", () => {
    expect(arrivalMessage(null)).toMatch(/^Nothing new arrived in the Inbox/);
  });
});

describe("primary action", () => {
  it.each([
    ["NEEDS_REVIEW", 2, { kind: "review", label: "Review 2 items" }],
    ["NEEDS_REVIEW", 1, { kind: "review", label: "Review 1 item" }],
    ["AMENDMENT_READY", 0, { kind: "send", label: "Send amendment" }],
    ["APPROVAL_READY", 0, { kind: "send", label: "Send approval" }],
    ["AMENDMENT_SENT", 0, { kind: "status", label: "Waiting for supplier" }],
    ["APPROVAL_SENT", 0, { kind: "status", label: "Done" }],
  ] as const)("%s (%i open) → %j", (status, openReviewItems, expected) => {
    expect(primaryAction({ status, openReviewItems })).toEqual(expected);
  });

  it("offers nothing while processing or failed", () => {
    expect(primaryAction({ status: "PROCESSING", openReviewItems: 0 })).toBeNull();
    expect(primaryAction({ status: "FAILED", openReviewItems: 0 })).toBeNull();
  });
});

describe("progress", () => {
  it("reports attachments read", () => {
    expect(progressText({ total: 3, done: 2, failed: 0 })).toBe("2 of 3 attachments read");
    expect(progressPercent({ total: 3, done: 2, failed: 0 })).toBe(67);
  });

  it("does not count a failed file as read", () => {
    expect(progressText({ total: 3, done: 3, failed: 1 })).toBe(
      "2 of 3 attachments read · 1 could not be opened",
    );
  });

  it("handles an empty email", () => {
    expect(progressPercent({ total: 0, done: 0, failed: 0 })).toBe(0);
    expect(progressText({ total: 1, done: 0, failed: 0 })).toBe("0 of 1 attachment read");
  });
});

describe("verification grid", () => {
  const checked = { ruleStatus: "mismatch", consistency: "consistent" } as const;
  const unchecked = { ruleStatus: "not_checked", consistency: "not_checked" } as const;

  it("colours the result from the backend field state", () => {
    expect(fieldResult({ state: "ok", ...checked })).toEqual({ label: "OK", tone: "success" });
    expect(fieldResult({ state: "amendment", ...checked })).toEqual({
      label: "Needs correction",
      tone: "danger",
    });
    expect(fieldResult({ state: "review", ...unchecked })).toEqual({
      label: "Needs review",
      tone: "warning",
    });
  });

  it("does not call a field OK before validation has looked at it", () => {
    expect(fieldResult({ state: "ok", ...unchecked })).toEqual({
      label: "Not checked yet",
      tone: "neutral",
    });
  });

  it("flags disagreeing and unreliable cells", () => {
    expect(cellTone({ agrees: false, reliable: true })).toBe("danger");
    expect(cellTone({ agrees: true, reliable: false })).toBe("warning");
    expect(cellTone({ agrees: null, reliable: true })).toBeNull();
  });

  it("formats values with their unit and shows a missing value plainly", () => {
    expect(formatObservation({ value: 950, unit: "KG" })).toBe("950 KG");
    expect(formatObservation({ value: "6403.22", unit: null })).toBe("6403.22");
    expect(formatObservation({ value: null, unit: null })).toBe("Not found");
  });

  it("summarises checked fields across documents", () => {
    const fields = [
      field({ field: "hs_code", state: "amendment" }),
      field({ field: "gross_weight", state: "amendment" }),
      field({ field: "incoterms", state: "review" }),
      field({ field: "invoice_number" }),
    ];
    const documents = [doc("a"), doc("b"), doc("c")];
    expect(gridSummary({ fields, documents })).toBe(
      "4 fields checked across 3 documents: 2 need correction, 1 needs your review",
    );
    expect(gridSummary({ fields: [field()], documents: [doc("a")] })).toBe(
      "1 fields checked across 1 document: all clear",
    );
  });

  it("explains that validation has not run at the intake stage", () => {
    const fields = [
      field({ ...unchecked, state: "review" }),
      field({ ...unchecked, field: "incoterms" }),
    ];
    expect(gridSummary({ fields, documents: [doc("a"), doc("b")] })).toBe(
      "2 fields read across 2 documents: 1 needs your review. Customer rules and cross-document checks run once intake is complete.",
    );
  });

  it("has no summary without fields", () => {
    expect(gridSummary({ fields: [], documents: [] })).toBeNull();
  });
});

describe("review groups", () => {
  const stage1 = issue({ key: "a", stage: "intake", severity: "review", resolution: null });
  const stage2Review = issue({
    key: "b",
    severity: "review",
    resolution: { action: "clarify", value: "6403.99", note: null, at: "2026-10-11T07:00:00Z" },
  });
  const stage2Amendment = issue({ key: "c", severity: "amendment" });

  it("splits the current stage into decisions and what goes to the supplier", () => {
    const groups = reviewGroups({
      stage: "validation",
      issues: [stage1, stage2Review, stage2Amendment],
    });
    expect(groups.decisions.map((i) => i.key)).toEqual(["b"]);
    expect(groups.outgoing.map((i) => i.key)).toEqual(["c"]);
    expect(groups.earlier.map((i) => i.key)).toEqual(["a"]);
    expect(groups.decided).toBe(1);
  });

  it("counts only decided review items", () => {
    const groups = reviewGroups({ stage: "intake", issues: [stage1, { ...stage1, key: "d" }] });
    expect(groups.decisions).toHaveLength(2);
    expect(groups.decided).toBe(0);
  });
});

describe("clarify inputs", () => {
  it("asks for a value and a note when both are required", () => {
    const form = clarifyForm({
      found: null,
      actionRules: { clarify: { value: "required", note: "required" } },
    })!;
    expect(form).toMatchObject({
      showValue: true,
      valueRequired: true,
      noteRequired: true,
      prefill: "",
    });
    expect(canSubmitClarify(form, "", "")).toBe(false);
    expect(canSubmitClarify(form, "6403.99", " ")).toBe(false);
    expect(canSubmitClarify(form, "6403.99", "checked the scan")).toBe(true);
  });

  it("pre-fills the extracted value when the value is optional", () => {
    const form = clarifyForm({
      found: "6403 79",
      actionRules: { clarify: { value: "optional", note: "optional" } },
    })!;
    expect(form.prefill).toBe("6403 79");
    expect(canSubmitClarify(form, "", "")).toBe(true);
  });

  it("shows only a mandatory note when waiving", () => {
    const form = clarifyForm({
      found: "6403.22",
      actionRules: { clarify: { value: "none", note: "required" } },
    })!;
    expect(form.showValue).toBe(false);
    expect(canSubmitClarify(form, "", "supplier confirmed by phone")).toBe(true);
    expect(canSubmitClarify(form, "", "")).toBe(false);
  });

  it("offers no clarify form when the backend does not allow it", () => {
    expect(clarifyForm({ found: null, actionRules: {} })).toBeNull();
  });
});

describe("expected value and its source", () => {
  const documents = [
    doc("doc_pl"),
    doc("doc_bl", { docType: "BOL", docTypeLabel: "Bill of lading" }),
  ];
  const plField = field({
    field: "gross_weight",
    expected: "at most 1000 kg",
    observations: [obs("doc_pl", { isOwner: true }), obs("doc_bl")],
  });
  const base = { customer: { name: "Bata India" }, documents, fields: [plField] };

  it("names the customer rule as the source", () => {
    const rule = issue({ reference: { source: "rule", ruleId: "r1" } });
    expect(expectedSource(base, rule)).toBe("Bata India rule");
  });

  it("names the owner document as the source", () => {
    const ref = issue({
      field: "gross_weight",
      reference: { source: "document", documentId: "doc_pl" },
    });
    expect(expectedSource(base, ref)).toBe("Packing list (owner)");
  });

  it("does not mark a non-owner document as owner", () => {
    const ref = issue({
      field: "gross_weight",
      reference: { source: "document", documentId: "doc_bl" },
    });
    expect(expectedSource(base, ref)).toBe("Bill of lading");
  });

  it("prefers the issue's expected value and keeps the customer rule alongside", () => {
    const ref = issue({
      field: "gross_weight",
      expected: "900 KG",
      reference: { source: "document", documentId: "doc_pl" },
    });
    expect(fieldExpectation({ ...base, issues: [ref] }, plField)).toEqual({
      value: "900 KG",
      source: "Packing list (owner)",
      rule: "at most 1000 kg",
    });
  });

  it("falls back to the rule on the field", () => {
    expect(fieldExpectation({ ...base, issues: [] }, plField)).toEqual({
      value: "at most 1000 kg",
      source: "Bata India rule",
      rule: null,
    });
  });

  it("never invents an expected value", () => {
    expect(fieldExpectation({ ...base, issues: [] }, field({ expected: null }))).toEqual({
      value: null,
      source: null,
      rule: null,
    });
  });
});

describe("draft", () => {
  const draft = { to: "docs@gzleather.example", subject: "Re: Shipment documents", body: "Hello" };

  it("detects unsaved edits in any field", () => {
    const edits = draftEdits(draft);
    expect(isDraftDirty(draft, edits)).toBe(false);
    expect(isDraftDirty(draft, { ...edits, body: "Hello there" })).toBe(true);
    expect(isDraftDirty(draft, { ...edits, to: "other@example.com" })).toBe(true);
  });

  it.each([
    ["DRAFT_OUTDATED", "reload"],
    ["REVIEW_INCOMPLETE", "review"],
    ["ALREADY_SENT", "reload"],
    ["SHIPMENT_PROCESSING", "show"],
    [null, "show"],
  ])("send failure %s → %s", (code, action) => {
    expect(sendFailure(code).action).toBe(action);
  });

  it("explains an outdated draft in plain words", () => {
    expect(sendFailure("DRAFT_OUTDATED").message).toBe(
      "The draft changed (for example, the supplier replied). Please check it again.",
    );
  });
});

describe("misc helpers", () => {
  it("lists an email's attachments in the email's order", () => {
    const documents = [doc("a"), doc("b"), doc("c")];
    const email = {
      id: "e",
      cycle: 1,
      from: "x",
      subject: "s",
      receivedAt: "",
      bodyText: "",
      documentIds: ["c", "a"],
    };
    expect(emailDocuments({ documents }, email).map((d) => d.id)).toEqual(["c", "a"]);
  });

  it("gives unknown timeline events a neutral icon", () => {
    expect(eventMeta("evaluated").icon).toBe("shield");
    expect(eventMeta("brand_new_event")).toEqual({ icon: "clock", tone: "neutral" });
  });

  it("formats the median reply time", () => {
    expect(formatMinutes(null)).toBe("—");
    expect(formatMinutes(0.4)).toBe("<1 min");
    expect(formatMinutes(12.34)).toBe("12.3 min");
  });
});

describe("values the backend may send", () => {
  it("labels a document that is still being read, as the backend reports it", () => {
    expect(docStatusMeta("processing")).toEqual({ label: "Reading…", tone: "info" });
    expect(docStatusMeta("pending").label).toBe("Reading…");
    expect(docStatusMeta("extracted").label).toBe("Read");
    expect(docStatusMeta("failed").label).toBe("Could not be read");
  });

  it("never throws on an unfamiliar value", () => {
    expect(docStatusMeta("queued").label).toBe("Status unavailable");
    expect(confidenceMeta("very_high")).toEqual({ label: "Unknown", tone: "neutral" });
    expect(confidenceMeta("medium")).toEqual({ label: "Medium", tone: "warning" });
    expect(outboundKindMeta("forward").label).toBe("Reply");
    expect(stageLabel("archive")).toBe("In progress");
    expect(
      fieldResult({ state: "later" as never, ruleStatus: "match", consistency: "consistent" })
        .label,
    ).toBe("Status unavailable");
  });
});
