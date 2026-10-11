import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createDb,
  documents,
  extractions,
  inboundEmails,
  pipelineRuns,
  seedDb,
  shipmentEvents,
  shipments,
  type NovaDb,
} from "../../../src/db/index.js";
import {
  createInbox,
  createInboxWatcher,
  EmailParseError,
  parseEmail,
  type Inbox,
} from "../../../src/services/inbox/index.js";
import { createLogger } from "../../../src/utils/logger.js";
import { buildEml, pdf, SUPPLIER } from "../../helpers/eml.js";

let db: NovaDb;
let dir: string;
let inbox: Inbox;
let ready: string[];

const options = (overrides: Partial<Parameters<typeof createInbox>[0]> = {}) => ({
  db,
  uploadDir: join(dir, "uploads"),
  emailDir: join(dir, "emails"),
  inboxDir: join(dir, "inbox"),
  samplesDir: join(dir, "samples"),
  maxAttachments: 10,
  maxAttachmentBytes: 1024 * 1024,
  onShipmentReady: (id: string) => ready.push(id),
  ...overrides,
});

beforeEach(() => {
  db = createDb(":memory:");
  seedDb(db);
  dir = mkdtempSync(join(tmpdir(), "nova-inbox-"));
  ready = [];
  inbox = createInbox(options());
});

afterEach(() => {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

const docsOf = (shipmentId: string) =>
  db.select().from(documents).where(eq(documents.shipmentId, shipmentId)).all();

const runOf = (documentId: string) =>
  db.select().from(pipelineRuns).where(eq(pipelineRuns.documentId, documentId)).get()!;

const eventTypes = (shipmentId: string) =>
  db
    .select()
    .from(shipmentEvents)
    .where(eq(shipmentEvents.shipmentId, shipmentId))
    .all()
    .map((e) => e.type);

const invoice = { filename: "CI-2041.pdf", content: pdf("invoice") };
const attachments = [invoice, { filename: "BL-2041.pdf", content: pdf("bill of lading") }];

describe("ingestEmail", () => {
  it("turns one email with several attachments into one shipment with a run per file", async () => {
    const result = await inbox.ingest(await buildEml({ messageId: "<a@gz>", attachments }));
    expect(result).toMatchObject({ cycle: 1, duplicate: false });

    const shipment = db.select().from(shipments).get()!;
    expect(shipment).toMatchObject({
      reference: "SHP-0001",
      status: "RECEIVED",
      supplierAddress: "docs@gzleather.example",
      supplierName: "Guangzhou Leatherworks",
    });
    const docs = docsOf(shipment.id);
    expect(docs.map((d) => d.originalFilename).sort()).toEqual(["BL-2041.pdf", "CI-2041.pdf"]);
    expect(docs.every((d) => runOf(d.id).status === "RECEIVED")).toBe(true);
    expect(existsSync(db.select().from(inboundEmails).get()!.rawPath)).toBe(true);
    expect(ready).toEqual([shipment.id]);
    expect(eventTypes(shipment.id)).toEqual(["email_received"]);
  });

  it("ignores the same email delivered twice", async () => {
    const raw = await buildEml({ messageId: "<a@gz>", attachments });
    const first = await inbox.ingest(raw);
    expect(await inbox.ingest(raw)).toEqual({ ...first, duplicate: true });
    expect(db.select().from(shipments).all()).toHaveLength(1);
    expect(db.select().from(documents).all()).toHaveLength(2);
    expect(ready).toHaveLength(1);
  });

  it("falls back to a content hash when the email has no Message-ID", async () => {
    const raw = Buffer.from(
      "From: docs@gzleather.example\r\nSubject: Docs\r\n\r\nSee attached.\r\n",
    );
    expect((await parseEmail(raw)).messageId).toMatch(/^<sha256-[0-9a-f]{64}>$/);
    await inbox.ingest(raw);
    expect((await inbox.ingest(raw)).duplicate).toBe(true);
  });

  it("rejects an email without a sender", async () => {
    await expect(parseEmail(Buffer.from("Subject: x\r\n\r\nbody"))).rejects.toThrow(
      EmailParseError,
    );
  });

  it("stores the same file attached twice only once", async () => {
    const { shipmentId } = await inbox.ingest(
      await buildEml({ attachments: [invoice, { ...invoice, filename: "CI copy.pdf" }] }),
    );
    expect(docsOf(shipmentId)).toHaveLength(1);
    expect(eventTypes(shipmentId)).toContain("attachment_duplicate");
  });

  it("detects PDFs sent as octet-stream and skips inline signature images", async () => {
    const { shipmentId } = await inbox.ingest(
      await buildEml({
        attachments: [
          { filename: "invoice", content: pdf("x"), contentType: "application/octet-stream" },
          {
            filename: "logo.png",
            content: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]),
            cid: "logo@gz",
            contentDisposition: "inline",
          },
        ],
      }),
    );
    expect(docsOf(shipmentId).map((d) => [d.originalFilename, d.mimeType])).toEqual([
      ["invoice", "application/pdf"],
    ]);
    expect(eventTypes(shipmentId)).toContain("attachment_skipped");
  });

  it("keeps unreadable files as failed documents served as downloads", async () => {
    inbox = createInbox(options({ maxAttachments: 2, maxAttachmentBytes: 50 }));
    const { shipmentId } = await inbox.ingest(
      await buildEml({
        attachments: [
          { filename: "notes.html", content: "<script>x</script>", contentType: "text/html" },
          { filename: "big.pdf", content: Buffer.concat([pdf("big"), Buffer.alloc(100)]) },
          { filename: "third.pdf", content: pdf("third") },
        ],
      }),
    );
    const failed = docsOf(shipmentId).map((d) => [
      d.originalFilename,
      d.mimeType,
      runOf(d.id).status,
      runOf(d.id).errorCode,
    ]);
    expect(failed).toEqual(
      expect.arrayContaining([
        ["notes.html", "application/octet-stream", "COMPLETED", "UNSUPPORTED_FILE_TYPE"],
        ["big.pdf", "application/octet-stream", "COMPLETED", "FILE_TOO_LARGE"],
        ["third.pdf", "application/octet-stream", "COMPLETED", "TOO_MANY_ATTACHMENTS"],
      ]),
    );
  });
});

describe("threading", () => {
  it("links a reply by In-Reply-To to the same shipment as the next cycle", async () => {
    const first = await inbox.ingest(await buildEml({ messageId: "<a@gz>", attachments }));
    const reply = await inbox.ingest(
      await buildEml({
        messageId: "<b@gz>",
        inReplyTo: "<a@gz>",
        subject: "Re: Shipment documents INV-2026-2041",
        attachments: [{ filename: "PL-2041.pdf", content: pdf("packing list") }],
      }),
    );
    expect(reply).toMatchObject({ shipmentId: first.shipmentId, cycle: 2, duplicate: false });
    expect(db.select().from(shipments).get()).toMatchObject({ cycle: 2, status: "RECEIVED" });
    expect(docsOf(first.shipmentId).map((d) => d.cycle)).toEqual([1, 1, 2]);
  });

  it("links by the subject tag only when the sender matches", async () => {
    const first = await inbox.ingest(await buildEml({ messageId: "<a@gz>" }));
    const tagged = (from: string, messageId: string) =>
      buildEml({ from, messageId, subject: "Corrected documents [SHP-0001]" });
    const same = await inbox.ingest(await tagged(SUPPLIER, "<b@gz>"));
    const other = await inbox.ingest(await tagged("intruder@evil.example", "<c@evil>"));
    expect(same.shipmentId).toBe(first.shipmentId);
    expect(other.shipmentId).not.toBe(first.shipmentId);
  });

  it("reuses the extraction of a file resent unchanged", async () => {
    const first = await inbox.ingest(await buildEml({ messageId: "<a@gz>", attachments }));
    const original = docsOf(first.shipmentId).find((d) => d.originalFilename === "CI-2041.pdf")!;
    const run = runOf(original.id);
    db.update(pipelineRuns)
      .set({ status: "COMPLETED", currentStage: "EXTRACTED" })
      .where(eq(pipelineRuns.id, run.id))
      .run();
    db.update(documents)
      .set({ docType: "COMMERCIAL_INVOICE" })
      .where(eq(documents.id, original.id))
      .run();
    db.insert(extractions)
      .values({
        id: "ext_1",
        runId: run.id,
        fieldName: "hs_code",
        valueText: "6403.99",
        confidence: 1,
      })
      .run();

    await inbox.ingest(
      await buildEml({ messageId: "<b@gz>", inReplyTo: "<a@gz>", attachments: [invoice] }),
    );
    const resent = docsOf(first.shipmentId).find((d) => d.cycle === 2)!;
    expect(resent).toMatchObject({
      unchangedFromDocumentId: original.id,
      docType: "COMMERCIAL_INVOICE",
    });
    const resentRun = runOf(resent.id);
    expect(resentRun).toMatchObject({ status: "COMPLETED", currentStage: "EXTRACTED" });
    expect(
      db.select().from(extractions).where(eq(extractions.runId, resentRun.id)).all(),
    ).toHaveLength(1);
    expect(eventTypes(first.shipmentId)).toContain("attachment_unchanged");
  });
});

describe("samples and watcher", () => {
  it("lists and delivers samples by name only", async () => {
    mkdirSync(join(dir, "samples"));
    writeFileSync(join(dir, "samples", "01-clean.eml"), await buildEml({ attachments }));

    expect(await inbox.listSamples()).toMatchObject([
      { name: "01-clean", attachments: ["CI-2041.pdf", "BL-2041.pdf"] },
    ]);
    expect(await inbox.deliverSample("../01-clean")).toBeNull();
    expect(await inbox.deliverSample("missing")).toBeNull();
    const delivered = await inbox.deliverSample("01-clean");
    expect(readdirSync(join(dir, "inbox"))).toEqual([delivered!.file]);
  });

  it("returns no samples when the folder is missing", async () => {
    expect(await inbox.listSamples()).toEqual([]);
  });

  it("moves ingested files to processed/ and unparseable ones to failed/", async () => {
    const inboxDir = join(dir, "inbox");
    mkdirSync(inboxDir);
    writeFileSync(join(inboxDir, "good.eml"), await buildEml({ messageId: "<a@gz>" }));
    writeFileSync(join(inboxDir, "bad.eml"), "Subject: no sender\r\n\r\n");
    const watcher = createInboxWatcher({
      dir: inboxDir,
      pollMs: 0,
      ingest: inbox.ingest,
      logger: createLogger("silent"),
    });
    await watcher.poll();
    expect(readdirSync(join(inboxDir, "processed"))).toEqual([expect.stringMatching(/good\.eml$/)]);
    expect(readdirSync(join(inboxDir, "failed"))).toEqual([expect.stringMatching(/bad\.eml$/)]);
    expect(db.select().from(shipments).all()).toHaveLength(1);
  });
});
