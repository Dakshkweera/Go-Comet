import { existsSync, readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { decisions, documents, shipments } from "../src/db/index.js";
import type { ExtractorAgent, ExtractorOutput } from "../src/schemas/index.js";
import { DocumentReadError, FAKE_EXTRACTION } from "../src/services/extraction/index.js";
import { buildEml, pdf, type TestAttachment } from "./helpers/eml.js";
import { text, weight } from "./helpers/shipment.js";
import { createTestApp } from "./helpers/testApp.js";

const typed = (value: string, fields: Partial<ExtractorOutput> = {}): ExtractorOutput => ({
  ...FAKE_EXTRACTION,
  ...fields,
  documentType: { value, confidence: 0.95 },
});

/** Each test PDF is "%PDF-1.4 <label>"; the label picks the model's answer. */
const ANSWERS: Record<string, ExtractorOutput> = {
  invoice: typed("COMMERCIAL_INVOICE"),
  bol: typed("BOL"),
  pl: typed("PACKING_LIST"),
  "bol-950": typed("BOL", { gross_weight: weight(950) }),
  "pl-hs-wrong": typed("PACKING_LIST", { hs_code: text("6403.22") }),
  "pl-hs-blurry": typed("PACKING_LIST", { hs_code: text("6403.?9", 0.3) }),
  "pl-no-weight": typed("PACKING_LIST", { gross_weight: { ...weight(0), value: null } }),
  fumigation: typed("OTHER"),
};

let extractions = 0;
const extractor: ExtractorAgent = {
  async extract({ filePath }) {
    extractions++;
    const label = readFileSync(filePath).toString().replace("%PDF-1.4 ", "");
    if (label === "broken") throw new DocumentReadError("The PDF could not be parsed.");
    const answer = ANSWERS[label];
    if (!answer) throw new Error(`no test answer for ${label}`);
    return answer;
  },
};

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  extractions = 0;
});

function start() {
  const ctx = createTestApp({}, { extractor });
  cleanups.push(ctx.cleanup);
  return ctx;
}

type Ctx = ReturnType<typeof start>;

const file = (label: string, filename = `${label}.pdf`): TestAttachment => ({
  filename,
  content: pdf(label),
});

async function receive(ctx: Ctx, labels: string[], email: Parameters<typeof buildEml>[0] = {}) {
  const raw = await buildEml({
    messageId: "<orig@gz>",
    ...email,
    attachments: labels.map((l) => file(l)),
  });
  const res = await request(ctx.app)
    .post("/api/inbox/emails")
    .attach("file", raw, { filename: "email.eml", contentType: "message/rfc822" });
  await ctx.settle();
  return res;
}

const view = async (ctx: Ctx, id: string) =>
  (await request(ctx.app).get(`/api/shipments/${id}`)).body;

describe("shipment workflow over HTTP", () => {
  it("runs email → verification → edited amendment → CG send → reply → approval → send", async () => {
    const ctx = start();
    const received = await receive(ctx, ["invoice", "bol-950", "pl-hs-wrong"]);
    expect(received.status).toBe(202);
    expect(received.body).toMatchObject({ cycle: 1, duplicate: false });
    const id = received.body.shipmentId;

    const list = (await request(ctx.app).get("/api/shipments")).body;
    expect(list).toMatchObject([
      {
        reference: "SHP-0001",
        status: "AMENDMENT_READY",
        stage: "validation",
        amendmentItems: 2,
        openReviewItems: 0,
      },
    ]);

    const shipment = await view(ctx, id);
    expect(shipment.documents.map((d: { docType: string }) => d.docType)).toEqual([
      "COMMERCIAL_INVOICE",
      "BOL",
      "PACKING_LIST",
    ]);
    expect(shipment.issues.map((i: { kind: string }) => i.kind)).toEqual([
      "rule_mismatch",
      "document_mismatch",
    ]);
    const hs = shipment.fields.find((f: { field: string }) => f.field === "hs_code");
    expect(
      hs.observations.map((o: { filename: string; value: string; confidenceLevel: string }) => [
        o.filename,
        o.value,
        o.confidenceLevel,
      ]),
    ).toEqual([
      ["invoice.pdf", "640399", "high"],
      ["bol-950.pdf", "640399", "high"],
      ["pl-hs-wrong.pdf", "6403.22", "high"],
    ]);
    expect(shipment.draft).toMatchObject({
      kind: "amendment",
      version: 1,
      canSend: true,
      to: "docs@gzleather.example",
    });
    expect(shipment.draft.body).toContain("Packing list (pl-hs-wrong.pdf)");
    expect(shipment.customerResolution).toMatchObject({ status: "resolved", name: "Bata India" });

    const edited = await request(ctx.app)
      .put(`/api/shipments/${id}/draft`)
      .send({
        version: 1,
        subject: shipment.draft.subject,
        body: `${shipment.draft.body}\nThanks!`,
      });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ version: 1, edited: true });

    const sent = await request(ctx.app)
      .post(`/api/shipments/${id}/draft/send`)
      .send({ version: 1 });
    expect(sent.status).toBe(200);
    expect(sent.body).toMatchObject({
      status: "AMENDMENT_SENT",
      sentEmail: { kind: "amendment", edited: true },
    });
    expect(
      (await request(ctx.app).post(`/api/shipments/${id}/draft/send`).send({ version: 1 })).body
        .error.code,
    ).toBe("ALREADY_SENT");
    expect((await request(ctx.app).get("/api/sent-emails")).body).toMatchObject([
      { reference: "SHP-0001", kind: "amendment", status: "sent (simulated)" },
    ]);

    const reply = await receive(ctx, ["bol", "pl"], {
      messageId: "<reply@gz>",
      inReplyTo: sent.body.sentEmail.messageId,
      subject: "Re: corrected documents",
    });
    expect(reply.body).toMatchObject({ shipmentId: id, cycle: 2 });
    const approved = await view(ctx, id);
    expect(approved).toMatchObject({
      status: "APPROVAL_READY",
      cycle: 2,
      draft: { kind: "approval", version: 2 },
    });
    expect(
      approved.documents
        .filter((d: { current: boolean }) => d.current)
        .map((d: { filename: string }) => d.filename),
    ).toEqual(["invoice.pdf", "bol.pdf", "pl.pdf"]);

    const final = await request(ctx.app)
      .post(`/api/shipments/${id}/draft/send`)
      .send({ version: 2 });
    expect(final.body.status).toBe("APPROVAL_SENT");
    const metrics = (await request(ctx.app).get("/api/metrics")).body;
    expect(metrics).toMatchObject({
      shipments: 1,
      replies: { sent: 2, edited: 1, unedited: 1 },
      averageCycles: 2,
    });
    expect(typeof metrics.northStar.value).toBe("number");
    expect(ctx.db.select().from(decisions).all()).toEqual([]);
  });

  it("never sends without the CG click: the draft stays a draft", async () => {
    const ctx = start();
    const { shipmentId } = (await receive(ctx, ["invoice", "bol", "pl"])).body;
    expect((await view(ctx, shipmentId)).draft).toMatchObject({
      kind: "approval",
      status: "draft",
    });
    expect((await request(ctx.app).get("/api/sent-emails")).body).toEqual([]);
  });

  it("ignores the same email delivered twice", async () => {
    const ctx = start();
    const first = await receive(ctx, ["invoice", "bol", "pl"]);
    const again = await receive(ctx, ["invoice", "bol", "pl"]);
    expect(again.body).toEqual({ ...first.body, duplicate: true });
    expect(extractions).toBe(3);
  });

  it("asks for a resend of an unreadable file before validating", async () => {
    const ctx = start();
    const { shipmentId } = (await receive(ctx, ["invoice", "bol", "broken"])).body;
    const shipment = await view(ctx, shipmentId);
    expect(shipment).toMatchObject({ status: "AMENDMENT_READY", stage: "intake" });
    expect(shipment.draft.body).toContain("We could not open broken.pdf. Please resend it.");
    expect(shipment.documents[2]).toMatchObject({
      status: "failed",
      error: { code: "DOCUMENT_READ_ERROR" },
    });
  });

  it("blocks Send until review is done, then validates once CG clarifies", async () => {
    const ctx = start();
    const { shipmentId: id } = (await receive(ctx, ["invoice", "bol", "pl-hs-blurry"])).body;
    const shipment = await view(ctx, id);
    expect(shipment).toMatchObject({ status: "NEEDS_REVIEW", stage: "intake", draft: null });
    const send = await request(ctx.app)
      .post(`/api/shipments/${id}/draft/send`)
      .send({ version: 1 });
    expect([send.status, send.body.error.code]).toEqual([409, "REVIEW_INCOMPLETE"]);

    const [item] = shipment.issues;
    expect(item).toMatchObject({
      kind: "unreliable_value",
      actionRules: { clarify: { value: "optional" } },
    });
    const clarified = await request(ctx.app).post(`/api/shipments/${id}/review`).send({
      issueKey: item.key,
      action: "clarify",
      value: "6403.99",
      note: "Read on the original",
    });
    expect(clarified.status).toBe(200);
    expect(clarified.body).toMatchObject({ status: "APPROVAL_READY", stage: "validation" });
    expect(clarified.body.issues[0].resolution).toMatchObject({
      action: "clarify",
      value: "6403.99",
    });
  });

  it("validates review decisions", async () => {
    const ctx = start();
    const { shipmentId: id } = (await receive(ctx, ["invoice", "bol", "pl-no-weight"])).body;
    const [missing] = (await view(ctx, id)).issues;
    expect(missing.kind).toBe("missing_field");
    const post = (body: object) => request(ctx.app).post(`/api/shipments/${id}/review`).send(body);

    expect((await post({ issueKey: missing.key, action: "clarify" })).body.error.code).toBe(
      "VALUE_REQUIRED",
    );
    expect(
      (await post({ issueKey: missing.key, action: "clarify", value: "heavy" })).body.error.code,
    ).toBe("VALUE_REQUIRED");
    expect((await post({ issueKey: "nope", action: "amend" })).status).toBe(404);
    expect((await post({ issueKey: missing.key, action: "skip" })).body.error.code).toBe(
      "INVALID_REQUEST",
    );
    const ok = await post({ issueKey: missing.key, action: "clarify", value: "900 kg" });
    expect(ok.body.status).toBe("APPROVAL_READY");
  });

  it("needs a note to waive a correction, and rejects a stale draft version", async () => {
    const ctx = start();
    const { shipmentId: id } = (await receive(ctx, ["invoice", "bol-950", "pl-hs-wrong"])).body;
    const shipment = await view(ctx, id);
    const hs = shipment.issues.find((i: { kind: string }) => i.kind === "rule_mismatch");
    const post = (body: object) => request(ctx.app).post(`/api/shipments/${id}/review`).send(body);
    expect((await post({ issueKey: hs.key, action: "amend" })).body.error.code).toBe(
      "INVALID_ACTION",
    );
    expect((await post({ issueKey: hs.key, action: "clarify" })).body.error.code).toBe(
      "NOTE_REQUIRED",
    );

    const waived = await post({
      issueKey: hs.key,
      action: "clarify",
      note: "Customer accepts 6403.22",
    });
    expect(waived.body).toMatchObject({
      status: "AMENDMENT_READY",
      amendmentItems: 1,
      draft: { version: 2 },
    });
    const stale = { version: 1, subject: "x", body: "y" };
    expect(
      (await request(ctx.app).put(`/api/shipments/${id}/draft`).send(stale)).body.error.code,
    ).toBe("DRAFT_OUTDATED");
    expect(
      (await request(ctx.app).post(`/api/shipments/${id}/draft/send`).send({ version: 1 })).body
        .error.code,
    ).toBe("DRAFT_OUTDATED");
  });

  it("refuses to send while attachments are still being read", async () => {
    const ctx = start();
    const { shipmentId: id } = (await receive(ctx, ["invoice", "bol", "pl"])).body;
    ctx.db.update(shipments).set({ status: "PROCESSING" }).where(eq(shipments.id, id)).run();
    const res = await request(ctx.app).post(`/api/shipments/${id}/draft/send`).send({ version: 1 });
    expect(res.body.error.code).toBe("SHIPMENT_PROCESSING");
  });

  it("lets CG set the type of an unclassified file", async () => {
    const ctx = start();
    const { shipmentId: id } = (await receive(ctx, ["invoice", "bol", "fumigation"])).body;
    const shipment = await view(ctx, id);
    expect(shipment.issues).toMatchObject([{ kind: "missing_document", severity: "review" }]);
    const other = shipment.documents.find((d: { docType: string }) => d.docType === "OTHER");
    const res = await request(ctx.app)
      .put(`/api/shipments/${id}/documents/${other.id}/type`)
      .send({ docType: "PACKING_LIST", note: "It is the packing list" });
    expect(res.body).toMatchObject({ status: "APPROVAL_READY" });
    expect(res.body.documents[2]).toMatchObject({
      docType: "PACKING_LIST",
      docTypeReason: "Set by CG operator: It is the packing list",
    });
  });

  it("keeps attachment runs out of the Part 1 run list and protects them from deletion", async () => {
    const ctx = start();
    const { shipmentId: id } = (await receive(ctx, ["invoice", "bol", "broken"])).body;
    expect((await request(ctx.app).get("/api/runs")).body).toEqual([]);
    const failed = (await view(ctx, id)).documents[2];
    const del = await request(ctx.app).delete(`/api/runs/${failed.runId}`);
    expect([del.status, del.body.error.code]).toEqual([409, "RUN_PART_OF_SHIPMENT"]);
    expect(ctx.db.select().from(documents).where(eq(documents.id, failed.id)).get()).toBeDefined();
  });

  it("deletes a shipment with everything it owns, so the same email can be received again", async () => {
    const ctx = start();
    const first = (await receive(ctx, ["invoice", "bol", "pl"])).body;
    const second = (
      await receive(ctx, ["invoice", "bol", "pl"], {
        messageId: "<second@gz>",
        subject: "Shipment documents INV-2026-2042",
      })
    ).body;
    const files = ctx.db
      .select()
      .from(documents)
      .where(eq(documents.shipmentId, first.shipmentId))
      .all()
      .map((d) => d.storagePath);
    expect(files.every((f) => existsSync(f))).toBe(true);

    const res = await request(ctx.app).delete(`/api/shipments/${first.shipmentId}`);
    expect(res.body).toEqual({
      deleted: true,
      shipmentId: first.shipmentId,
      reference: "SHP-0001",
      filesDeleted: 4,
    });
    expect(files.some((f) => existsSync(f))).toBe(false);
    expect((await request(ctx.app).get(`/api/shipments/${first.shipmentId}`)).status).toBe(404);
    expect((await request(ctx.app).get("/api/shipments")).body).toMatchObject([
      { id: second.shipmentId, reference: "SHP-0002" },
    ]);
    expect((await view(ctx, second.shipmentId)).documents).toHaveLength(3);

    const again = await receive(ctx, ["invoice", "bol", "pl"]);
    expect(again.body).toMatchObject({ duplicate: false, cycle: 1 });
    expect((await view(ctx, again.body.shipmentId)).reference).toBe("SHP-0003");
  });

  it("refuses to delete a shipment that is still processing", async () => {
    const ctx = start();
    const { shipmentId: id } = (await receive(ctx, ["invoice", "bol", "pl"])).body;
    ctx.db.update(shipments).set({ status: "PROCESSING" }).where(eq(shipments.id, id)).run();
    const res = await request(ctx.app).delete(`/api/shipments/${id}`);
    expect([res.status, res.body.error.code]).toEqual([409, "SHIPMENT_PROCESSING"]);
    expect((await request(ctx.app).get(`/api/shipments/${id}`)).status).toBe(200);
  });

  it("turns an unexpected failure into a structured 500 on every write endpoint", async () => {
    const ctx = start();
    const { shipmentId: id } = (await receive(ctx, ["invoice", "bol", "pl"])).body;
    ctx.db.$client.close();
    const calls = [
      request(ctx.app).post(`/api/shipments/${id}/review`).send({ issueKey: "k", action: "amend" }),
      request(ctx.app).put(`/api/shipments/${id}/documents/doc_x/type`).send({ docType: "BOL" }),
      request(ctx.app)
        .put(`/api/shipments/${id}/draft`)
        .send({ version: 1, subject: "s", body: "b" }),
      request(ctx.app).post(`/api/shipments/${id}/draft/send`).send({ version: 1 }),
      request(ctx.app).delete(`/api/shipments/${id}`),
    ];
    for (const res of await Promise.all(calls)) {
      expect([res.status, res.body.error.code]).toEqual([500, "INTERNAL_ERROR"]);
    }
  });

  it("answers 404 when deleting an unknown shipment", async () => {
    const res = await request(start().app).delete("/api/shipments/shp_x");
    expect([res.status, res.body.error.code]).toEqual([404, "SHIPMENT_NOT_FOUND"]);
  });

  it("rejects unusable uploads and unknown resources", async () => {
    const ctx = start();
    const bad = await request(ctx.app)
      .post("/api/inbox/emails")
      .attach("file", Buffer.from("Subject: hi\r\n\r\nno sender"), { filename: "x.eml" });
    expect([bad.status, bad.body.error.code]).toEqual([400, "EMAIL_INVALID"]);
    expect((await request(ctx.app).post("/api/inbox/emails")).body.error.code).toBe("INVALID_FILE");
    expect((await request(ctx.app).get("/api/shipments/shp_x")).status).toBe(404);
    expect((await request(ctx.app).post("/api/inbox/samples/missing/deliver")).status).toBe(404);
    expect((await request(ctx.app).get("/api/inbox/samples")).body).toEqual([]);
  });
});
