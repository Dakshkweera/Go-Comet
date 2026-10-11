import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { documents, pipelineRuns, shipments } from "../../../src/db/index.js";
import type { ExtractorAgent } from "../../../src/schemas/index.js";
import { FAKE_EXTRACTION } from "../../../src/services/extraction/index.js";
import { createPipeline } from "../../../src/services/pipeline.service.js";
import { createRouter } from "../../../src/services/routing/index.js";
import { createRun } from "../../../src/services/run.service.js";
import { createShipmentService } from "../../../src/services/shipment/index.js";
import { createValidator } from "../../../src/services/validation/index.js";
import { createLogger } from "../../../src/utils/logger.js";
import { buildEml, pdf } from "../../helpers/eml.js";
import { createTestApp } from "../../helpers/testApp.js";

const TYPES: Record<string, string> = {
  invoice: "COMMERCIAL_INVOICE",
  bol: "BOL",
  pl: "PACKING_LIST",
};

function countingExtractor() {
  const counter = { calls: 0 };
  const extractor: ExtractorAgent = {
    async extract({ filePath }) {
      counter.calls++;
      await new Promise((r) => setTimeout(r, 5));
      const label = readFileSync(filePath).toString().replace("%PDF-1.4 ", "");
      return { ...FAKE_EXTRACTION, documentType: { value: TYPES[label]!, confidence: 0.95 } };
    },
  };
  return { extractor, counter };
}

const attachments = ["invoice", "bol", "pl"].map((l) => ({
  filename: `${l}.pdf`,
  content: pdf(l),
}));
const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

function setup() {
  const { extractor, counter } = countingExtractor();
  const ctx = createTestApp({}, { extractor });
  cleanups.push(ctx.cleanup);
  return { ...ctx, extractor, counter };
}

const service = (ctx: ReturnType<typeof setup>) => {
  const validator = createValidator({ minConfidence: 0.8 });
  const pipeline = createPipeline({
    db: ctx.db,
    extractor: ctx.extractor,
    validator,
    router: createRouter({ minConfidence: 0.8 }),
    minConfidence: 0.8,
    maxAttempts: 3,
    retryDelayMs: 0,
  });
  return {
    pipeline,
    shipments: createShipmentService({
      db: ctx.db,
      pipeline,
      validator,
      minConfidence: 0.8,
      cg: { mailbox: "cg@nova.local", signature: "CG Team" },
      logger: createLogger("silent"),
    }),
  };
};

describe("shipment processing", () => {
  it("extracts each attachment once, records its type, and leaves no Part 1 decision", async () => {
    const ctx = setup();
    const { shipmentId } = await ctx.inbox.ingest(await buildEml({ attachments }));
    await ctx.settle();
    const docs = ctx.db.select().from(documents).where(eq(documents.shipmentId, shipmentId)).all();
    expect(docs.map((d) => d.docType)).toEqual(["COMMERCIAL_INVOICE", "BOL", "PACKING_LIST"]);
    const runs = ctx.db.select().from(pipelineRuns).all();
    expect(runs.every((r) => r.status === "COMPLETED" && r.finalDecision === null)).toBe(true);
    expect(ctx.counter.calls).toBe(3);
  });

  it("joins a run already in flight instead of returning before it finishes", async () => {
    const ctx = setup();
    const { pipeline } = service(ctx);
    const { runId } = await createRun(ctx.db, ctx.uploadDir, {
      buffer: pdf("invoice"),
      filename: "invoice.pdf",
      mimeType: "application/pdf",
    });
    await Promise.all([pipeline.run(runId), pipeline.run(runId)]);
    const run = ctx.db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId)).get()!;
    expect(run.status).toBe("COMPLETED");
    expect(ctx.counter.calls).toBe(1);
  });

  it("resumes a shipment interrupted after ingest without re-reading finished files", async () => {
    const ctx = setup();
    const { shipmentId } = await ctx.inbox.ingest(await buildEml({ attachments }));
    await ctx.settle();
    ctx.db
      .update(shipments)
      .set({ status: "PROCESSING" })
      .where(eq(shipments.id, shipmentId))
      .run();
    const [first] = ctx.db
      .select()
      .from(documents)
      .where(eq(documents.shipmentId, shipmentId))
      .all();
    ctx.db
      .update(pipelineRuns)
      .set({ status: "PROCESSING", currentStage: "EXTRACTED" })
      .where(eq(pipelineRuns.documentId, first!.id))
      .run();

    const before = ctx.counter.calls;
    await service(ctx).shipments.resume();
    expect(ctx.counter.calls).toBe(before);
    const shipment = ctx.db.select().from(shipments).where(eq(shipments.id, shipmentId)).get()!;
    expect(shipment.status).toBe("APPROVAL_READY");
    expect(ctx.db.select().from(documents).where(eq(documents.id, first!.id)).get()!.docType).toBe(
      "COMMERCIAL_INVOICE",
    );
  });

  it("processes a supplier reply that arrives while the first email is still being read", async () => {
    const ctx = setup();
    const first = await ctx.inbox.ingest(
      await buildEml({ messageId: "<a@gz>", attachments: attachments.slice(0, 2) }),
    );
    await ctx.inbox.ingest(
      await buildEml({
        messageId: "<b@gz>",
        inReplyTo: "<a@gz>",
        attachments: attachments.slice(2),
      }),
    );
    await ctx.settle();
    const shipment = ctx.db
      .select()
      .from(shipments)
      .where(eq(shipments.id, first.shipmentId))
      .get()!;
    expect(shipment).toMatchObject({ cycle: 2, status: "APPROVAL_READY" });
  });
});
