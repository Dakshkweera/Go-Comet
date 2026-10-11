import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { shipmentIssues } from "../src/db/index.js";
import { createTestApp } from "./helpers/testApp.js";
import { textLayerExtractor } from "./helpers/textLayerExtractor.js";

const eml = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../../samples/emails/${name}.eml`, import.meta.url)));

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

function start() {
  const ctx = createTestApp({}, { extractor: textLayerExtractor });
  cleanups.push(ctx.cleanup);
  const deliver = async (name: string) => {
    const { shipmentId } = await ctx.inbox.ingest(eml(name));
    await ctx.settle();
    return (await request(ctx.app).get(`/api/shipments/${shipmentId}`)).body;
  };
  return { ...ctx, deliver };
}

const send = (
  ctx: ReturnType<typeof start>,
  shipment: { id: string; draft: { version: number } },
) =>
  request(ctx.app)
    .post(`/api/shipments/${shipment.id}/draft/send`)
    .send({ version: shipment.draft.version });

describe("sample SU emails", () => {
  it("01-clean: approval ready; the fumigation certificate is tagged OTHER without a review", async () => {
    const shipment = await start().deliver("01-clean");
    expect(shipment).toMatchObject({ status: "APPROVAL_READY", stage: "validation", issues: [] });
    expect(shipment.documents.map((d: { docType: string }) => d.docType)).toEqual([
      "COMMERCIAL_INVOICE",
      "BOL",
      "PACKING_LIST",
      "OTHER",
    ]);
  });

  it("02-intake → reply: resend request first, then validation on the full set", async () => {
    const ctx = start();
    const first = await ctx.deliver("02-intake");
    expect(first).toMatchObject({ status: "AMENDMENT_READY", stage: "intake" });
    expect(first.issues.map((i: { kind: string }) => i.kind)).toEqual([
      "attachment_failed",
      "missing_document",
    ]);
    expect(first.draft.body).toContain("We could not open scan_01.pdf. Please resend it.");
    await send(ctx, first);

    const reply = await ctx.deliver("02-intake-reply");
    expect(reply).toMatchObject({ id: first.id, cycle: 2, status: "APPROVAL_READY" });
  });

  it("03-validation → reply: two corrections grouped by document, then approval with the unchanged invoice reused", async () => {
    const ctx = start();
    const first = await ctx.deliver("03-validation");
    expect(first).toMatchObject({
      status: "AMENDMENT_READY",
      stage: "validation",
      amendmentItems: 2,
    });
    expect(
      first.issues.map((i: { kind: string; field: string }) => `${i.kind}:${i.field}`),
    ).toEqual(["rule_mismatch:hs_code", "document_mismatch:gross_weight"]);
    expect(first.draft.body).toContain(
      "Bill of lading (BL-2043.pdf)\n  1. Gross weight: shows 950 KG",
    );
    expect(first.draft.body).toContain("Packing list (PL-2043.pdf)\n  2. HS code: shows 6403.22");
    await send(ctx, first);

    const reply = await ctx.deliver("03-validation-reply");
    expect(reply).toMatchObject({ id: first.id, cycle: 2, status: "APPROVAL_READY" });
    const invoice = reply.documents.find(
      (d: { cycle: number; filename: string }) => d.cycle === 2 && d.filename === "CI-2043.pdf",
    );
    expect(invoice.unchangedFromCycle).toBe(1);
    expect(reply.issues).toEqual([]);
    const history = ctx.db
      .select({ cycle: shipmentIssues.cycle, kind: shipmentIssues.kind })
      .from(shipmentIssues)
      .where(eq(shipmentIssues.shipmentId, first.id))
      .all();
    expect(history).toHaveLength(2);
    expect(history).toEqual(
      expect.arrayContaining([
        { cycle: 1, kind: "rule_mismatch" },
        { cycle: 1, kind: "document_mismatch" },
      ]),
    );
  });

  it("04-review: an unreadable HS code needs CG first; clarifying it lets validation run", async () => {
    const ctx = start();
    const shipment = await ctx.deliver("04-review");
    expect(shipment).toMatchObject({ status: "NEEDS_REVIEW", stage: "intake", draft: null });
    const [item] = shipment.issues;
    expect(item).toMatchObject({ kind: "unreliable_value", field: "hs_code" });
    expect(item.message).toContain("the document text for this field is ambiguous");

    const res = await request(ctx.app)
      .post(`/api/shipments/${shipment.id}/review`)
      .send({ issueKey: item.key, action: "clarify", value: "6403.99", note: "Checked the scan" });
    expect(res.body).toMatchObject({ status: "APPROVAL_READY", stage: "validation" });
  });
});
