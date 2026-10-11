import { describe, expect, it } from "vitest";
import { buildReplyDraft } from "../../../src/services/routing/index.js";
import { assess, cleanSet, decide, doc, failedDoc, text, weight } from "../../helpers/shipment.js";

const kinds = (issues: { kind: string; documentIds: string[] }[]) =>
  issues.map((i) => `${i.kind}:${i.documentIds.join("+")}`);

describe("stage 1: intake", () => {
  it("approves a clean, complete set after validation", () => {
    const { route, stage2 } = assess(cleanSet());
    expect(route).toMatchObject({
      status: "APPROVAL_READY",
      stage: "validation",
      decision: "auto_approve",
      draftKind: "approval",
    });
    expect(route.headline).toBe("Ready to approve: 5 rules and all cross-document checks passed");
    expect(stage2).toEqual([]);
  });

  it("does not review a readable OTHER document because of its type", () => {
    const { route, stage1 } = assess([
      ...cleanSet(),
      doc("fum", "OTHER", { hs_code: text("??", 0.2) }),
    ]);
    expect(stage1).toEqual([]);
    expect(route.status).toBe("APPROVAL_READY");
  });

  it("asks for a resend when a file cannot be read, and stops before validation", () => {
    const { route, stage1, stage2 } = assess([
      doc("ci", "COMMERCIAL_INVOICE"),
      doc("bl", "BOL"),
      failedDoc("scan"),
    ]);
    expect(kinds(stage1)).toEqual(["attachment_failed:scan", "missing_document:scan"]);
    expect(stage1.map((i) => i.severity)).toEqual(["amendment", "amendment"]);
    expect(stage1[1]!.request).toBe(
      "If scan.pdf was the packing list, resending it is enough; otherwise please also send the packing list.",
    );
    expect(stage2).toBeNull();
    expect(route).toMatchObject({
      status: "AMENDMENT_READY",
      stage: "intake",
      draftKind: "amendment",
    });
    expect(route.headline).toBe(
      "Intake: 1 file could not be opened, 1 document missing. Request to the supplier ready",
    );
  });

  it("asks for a missing document when nothing else could be it", () => {
    const { stage1, route } = assess([doc("ci", "COMMERCIAL_INVOICE"), doc("bl", "BOL")]);
    expect(stage1).toMatchObject([
      {
        kind: "missing_document",
        severity: "amendment",
        request: "We did not receive a packing list. Please send it.",
      },
    ]);
    expect(route.status).toBe("AMENDMENT_READY");
  });

  it("asks CG first when an unclassified file might be the missing document", () => {
    const { stage1, route } = assess([
      doc("ci", "COMMERCIAL_INVOICE"),
      doc("bl", "BOL"),
      doc("x", "OTHER"),
    ]);
    expect(stage1).toMatchObject([
      {
        kind: "missing_document",
        severity: "review",
        documentIds: ["x"],
        allowedActions: ["clarify", "amend"],
      },
    ]);
    expect(route).toMatchObject({ status: "NEEDS_REVIEW", stage: "intake", draftKind: null });
  });

  it("asks for an empty email", () => {
    const { stage1, route } = assess([]);
    expect(kinds(stage1)).toEqual(["no_attachments:"]);
    expect(route.status).toBe("AMENDMENT_READY");
  });

  it("reviews a required field the extractor did not find, and validates once CG supplies it", () => {
    const docs = [
      doc("ci", "COMMERCIAL_INVOICE"),
      doc("bl", "BOL", { port_of_discharge: text(null) }),
      doc("pl", "PACKING_LIST"),
    ];
    const first = assess(docs);
    const issue = first.stage1[0]!;
    expect(issue).toMatchObject({
      kind: "missing_field",
      field: "port_of_discharge",
      severity: "review",
    });
    expect(issue.actionRules.clarify).toEqual({ value: "required", note: "optional" });
    expect(first.route.status).toBe("NEEDS_REVIEW");

    const after = assess(docs, [decide(issue.key, "clarify", "Mumbai")]);
    expect(after.route.status).toBe("APPROVAL_READY");
    const pod = after.fields.find((f) => f.field === "port_of_discharge")!;
    expect(pod).toMatchObject({ valueSource: "cg", state: "ok" });
  });

  it("does not require fields a document type normally lacks", () => {
    const { stage1 } = assess([
      doc("ci", "COMMERCIAL_INVOICE"),
      doc("bl", "BOL", { invoice_number: text(null), incoterms: text(null) }),
      doc("pl", "PACKING_LIST", { hs_code: text(null), port_of_loading: text(null) }),
    ]);
    expect(stage1).toEqual([]);
  });

  it("reviews an unreadable value: clarify keeps it, amend asks the supplier", () => {
    const docs = [
      ...cleanSet().slice(0, 2),
      doc("pl", "PACKING_LIST", { hs_code: text("6403.?9", 0.3) }),
    ];
    const { stage1, route } = assess(docs);
    expect(stage1).toMatchObject([
      { kind: "unreliable_value", field: "hs_code", found: "6403.?9" },
    ]);
    expect(route.status).toBe("NEEDS_REVIEW");

    const clarified = assess(docs, [decide(stage1[0]!.key, "clarify", "6403.99")]);
    expect(clarified.route.status).toBe("APPROVAL_READY");

    const amended = assess(docs, [decide(stage1[0]!.key, "amend")]);
    expect(amended.route).toMatchObject({ status: "AMENDMENT_READY", stage: "intake" });
    expect(amended.route.draftItems[0]!.request).toBe(
      "We could not read the HS code clearly on pl.pdf. Please confirm it or send a clearer copy.",
    );
  });

  it("reviews two invoices that disagree", () => {
    const { stage1 } = assess([
      ...cleanSet(),
      doc("ci2", "COMMERCIAL_INVOICE", { invoice_number: text("INV-2026-9999") }),
    ]);
    expect(stage1).toMatchObject([
      { kind: "duplicate_type_conflict", field: "invoice_number", documentIds: ["ci", "ci2"] },
    ]);
  });

  it("only lets CG ask the supplier when the customer is unknown", () => {
    const { stage1, route } = assess(
      cleanSet().map((d) => ({
        ...d,
        extraction: { ...d.extraction!, consignee_name: text("XYZ Traders") },
      })),
    );
    expect(stage1).toMatchObject([{ kind: "customer_unresolved", allowedActions: ["amend"] }]);
    expect(route.status).toBe("NEEDS_REVIEW");
  });

  it("shows review and amendment items together; an amended review item joins the same email", () => {
    const docs = [
      doc("ci", "COMMERCIAL_INVOICE"),
      doc("bl", "BOL", { hs_code: text("6403.?9", 0.3) }),
      doc("pl", "PACKING_LIST"),
      failedDoc("scan"),
    ];
    const first = assess(docs);
    expect(first.route).toMatchObject({
      status: "NEEDS_REVIEW",
      stage: "intake",
      draftKind: "amendment",
    });
    expect(first.route.draftItems.map((i) => i.kind)).toEqual(["attachment_failed"]);

    const review = first.stage1.find((i) => i.kind === "unreliable_value")!;
    const after = assess(docs, [decide(review.key, "amend")]);
    expect(after.route).toMatchObject({ status: "AMENDMENT_READY", stage: "intake" });
    expect(after.route.draftItems.map((i) => i.kind).sort()).toEqual([
      "attachment_failed",
      "unreliable_value",
    ]);
    expect(after.stage2).toBeNull();
  });

  it("lets CG proceed without customer rules, recorded as a decision", () => {
    const first = assess(cleanSet(), [], []);
    expect(first.stage1).toMatchObject([
      { kind: "no_rules", actionRules: { clarify: { note: "required" } } },
    ]);
    const after = assess(
      cleanSet(),
      [decide(first.stage1[0]!.key, "clarify", undefined, "New customer")],
      [],
    );
    expect(after.route.status).toBe("APPROVAL_READY");
    expect(after.route.headline).toContain("no customer rules");
    expect(after.route.reasoning).toContain("no customer rules: accepted (New customer)");
  });
});

describe("stage 2: validation", () => {
  it("flags a rule violation on the document that breaks it, and a mismatch against the owner", () => {
    const { route, stage2 } = assess([
      doc("ci", "COMMERCIAL_INVOICE"),
      doc("bl", "BOL", { gross_weight: weight(950) }),
      doc("pl", "PACKING_LIST", { hs_code: text("6403.22") }),
    ]);
    expect(kinds(stage2!)).toEqual(["rule_mismatch:pl", "document_mismatch:bl"]);
    expect(stage2![0]).toMatchObject({ found: "6403.22", expected: "6403.99" });
    expect(stage2![0]!.request).toBe(
      "HS code: shows 6403.22; Bata India requires 6403.99. Please correct it. The commercial invoice (ci.pdf) and bill of lading (bl.pdf) already show the required value.",
    );
    expect(stage2![1]!.request).toBe(
      "Gross weight: shows 950 kg; the packing list (pl.pdf) shows 900 kg. Please make the bill of lading match the packing list.",
    );
    expect(route).toMatchObject({ status: "AMENDMENT_READY", stage: "validation" });
    expect(route.headline).toBe("2 corrections needed: amendment draft ready");
  });

  it.each([
    ["Mumbai", "Chennai", ["rule_mismatch:ci"]],
    ["Chennai", "Mumbai", ["rule_mismatch:bl"]],
    ["Chennai", "Chennai", ["rule_mismatch:ci+bl"]],
    ["Mumbai", "Mumbai", []],
  ])("port of discharge: BOL %s, invoice %s (rule Mumbai)", (bol, invoice, expected) => {
    const { stage2 } = assess([
      doc("ci", "COMMERCIAL_INVOICE", { port_of_discharge: text(invoice) }),
      doc("bl", "BOL", { port_of_discharge: text(bol) }),
      doc("pl", "PACKING_LIST", { port_of_discharge: text(null) }),
    ]);
    expect(kinds(stage2!)).toEqual(expected);
  });

  it("checks other documents against the owner for a field without a rule", () => {
    const { stage2 } = assess([
      ...cleanSet().slice(0, 2),
      doc("pl", "PACKING_LIST", { invoice_number: text("INV-2026-1043") }),
    ]);
    expect(stage2).toMatchObject([
      {
        kind: "document_mismatch",
        field: "invoice_number",
        documentIds: ["pl"],
        expected: "INV-2026-1042",
      },
    ]);
  });

  it("lists every value when nothing decides which is right", () => {
    const { stage2 } = assess([
      ...cleanSet().slice(0, 2),
      doc("pl", "PACKING_LIST", { consignee_name: text("Bata Retail") }),
    ]);
    expect(stage2).toMatchObject([
      { kind: "inconsistent", field: "consignee_name", documentIds: ["ci", "bl", "pl"] },
    ]);
    expect(stage2![0]!.request).toContain(
      "Please confirm the correct value and correct the documents.",
    );
  });

  it("treats safe formatting differences as the same value", () => {
    const { stage2 } = assess([
      doc("ci", "COMMERCIAL_INVOICE", {
        consignee_name: text("BATA INDIA PVT. LTD."),
        port_of_loading: text("Shanghai, China"),
      }),
      doc("bl", "BOL", { hs_code: text("6403.99"), gross_weight: weight(1984.16, "lb") }),
      doc("pl", "PACKING_LIST", {
        invoice_number: text("inv 2026 1042"),
        incoterms: text("FOB Shanghai"),
      }),
    ]);
    expect(stage2).toEqual([]);
  });

  it("does not compare the description of goods across documents", () => {
    const { stage2, fields } = assess([
      ...cleanSet().slice(0, 2),
      doc("pl", "PACKING_LIST", { description_of_goods: text("Footwear, 48 cartons") }),
    ]);
    expect(stage2).toEqual([]);
    expect(fields.find((f) => f.field === "description_of_goods")!.consistency).toBe("not_checked");
  });

  it("asks CG about an unclassified file that disagrees", () => {
    const { stage2, route } = assess([
      ...cleanSet(),
      doc("x", "OTHER", { consignee_name: text("Someone Else Ltd") }),
    ]);
    expect(stage2).toMatchObject([
      { kind: "other_document_mismatch", documentIds: ["x"], severity: "review" },
    ]);
    expect(route.status).toBe("NEEDS_REVIEW");
  });

  it("cannot verify a weight with an unknown unit", () => {
    const { stage2 } = assess([
      ...cleanSet().slice(0, 2),
      doc("pl", "PACKING_LIST", { gross_weight: weight(900, "bags") }),
    ]);
    expect(stage2!.map((i) => i.kind)).toContain("cannot_verify");
  });

  it("lets CG waive a correction only with a note, and records it", () => {
    const docs = [
      ...cleanSet().slice(0, 2),
      doc("pl", "PACKING_LIST", { hs_code: text("6403.22") }),
    ];
    const issue = assess(docs).stage2![0]!;
    expect(issue.actionRules).toEqual({ clarify: { value: "none", note: "required" } });
    const after = assess(docs, [
      decide(issue.key, "clarify", undefined, "Customer accepts 6403.22"),
    ]);
    expect(after.route.status).toBe("APPROVAL_READY");
    expect(after.route.reasoning).toContain("HS code: accepted (Customer accepts 6403.22)");
  });

  it("keeps issue keys stable across evaluations", () => {
    const docs = [
      ...cleanSet().slice(0, 2),
      doc("pl", "PACKING_LIST", { hs_code: text("6403.22") }),
    ];
    expect(assess(docs).issues.map((i) => i.key)).toEqual(assess(docs).issues.map((i) => i.key));
  });

  it("shows every document's value, the owner and agreement in the field grid", () => {
    const { fields } = assess([
      doc("ci", "COMMERCIAL_INVOICE"),
      doc("bl", "BOL", { gross_weight: weight(950) }),
      doc("pl", "PACKING_LIST"),
    ]);
    const gross = fields.find((f) => f.field === "gross_weight")!;
    expect(gross).toMatchObject({
      state: "amendment",
      ownerDocType: "PACKING_LIST",
      value: 900,
      sourceDocumentId: "pl",
      expected: "at most 1000 kg",
    });
    expect(gross.observations.map((o) => [o.documentId, o.isOwner, o.agrees])).toEqual([
      ["ci", false, true],
      ["bl", false, false],
      ["pl", true, true],
    ]);
  });
});

describe("reply drafts", () => {
  const documents = [
    doc("ci", "COMMERCIAL_INVOICE"),
    doc("bl", "BOL", { gross_weight: weight(950) }),
    doc("pl", "PACKING_LIST", { hs_code: text("6403.22") }, { unchanged: true }),
  ];
  const draft = (kind: "approval" | "amendment", docs = documents) => {
    const { route } = assess(docs);
    return buildReplyDraft({
      kind,
      stage: "validation",
      reference: "SHP-0003",
      subject: "Re: Shipment documents INV-2026-1042 [SHP-0003]",
      supplierName: "Guangzhou Leatherworks",
      invoiceNumber: "INV-2026-1042",
      customerName: "Bata India",
      documents: docs,
      items: route.draftItems,
      signature: "CG Team",
    });
  };

  it("lists every correction grouped by document, in the supplier's thread", () => {
    const { subject, body } = draft("amendment");
    expect(subject).toBe("Re: Shipment documents INV-2026-1042 [SHP-0003]");
    expect(body).toBe(
      [
        "Hello Guangzhou Leatherworks team,",
        "",
        "Thank you for the documents for invoice INV-2026-1042 (consignee: Bata India). We checked them against Bata India's requirements and need the corrections below before we can release them.",
        "",
        "Bill of lading (bl.pdf)",
        "  1. Gross weight: shows 950 kg; the packing list (pl.pdf) shows 900 kg. Please make the bill of lading match the packing list.",
        "",
        "Packing list (pl.pdf)",
        "  2. HS code: shows 6403.22; Bata India requires 6403.99. Please correct it. The commercial invoice (ci.pdf) and bill of lading (bl.pdf) already show the required value.",
        "     This file is the same as the version you sent before; the correction is still needed.",
        "",
        "Please reply to this email with the corrected documents.",
        "",
        "Regards,",
        "CG Team",
      ].join("\n"),
    );
  });

  it("writes an approval listing the documents checked", () => {
    const { body } = draft("approval", [...cleanSet(), doc("fum", "OTHER")]);
    expect(body).toContain(
      "- Commercial invoice (ci.pdf)\n- Bill of lading (bl.pdf)\n- Packing list (pl.pdf)",
    );
    expect(body).toContain("Also received (not part of the checks): fum.pdf.");
    expect(body).toContain("No changes are needed.");
  });
});
