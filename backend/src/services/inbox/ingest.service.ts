import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  documents,
  extractions,
  inboundEmails,
  outboundEmails,
  pipelineRuns,
  shipments,
  type NovaDb,
} from "../../db/index.js";
import { newId } from "../pipeline.service.js";
import { sanitizeFilename, SUPPORTED_MIME_TYPES } from "../run.service.js";
import { recordEvent } from "../shipment/events.js";
import { parseEmail, type ParsedEmail } from "./eml.js";

export type InboxDeps = {
  db: NovaDb;
  uploadDir: string;
  emailDir: string;
  inboxDir: string;
  samplesDir: string;
  maxAttachments: number;
  maxAttachmentBytes: number;
  onShipmentReady: (shipmentId: string) => void;
};

export type IngestResult = {
  shipmentId: string;
  emailId: string;
  cycle: number;
  duplicate: boolean;
};

type Prepared = {
  documentId: string;
  filename: string;
  mimeType: string;
  size: number;
  storagePath: string;
  contentHash: string;
  error: { code: string; message: string } | null;
  unchangedFrom: {
    documentId: string;
    runId: string;
    docType: string | null;
    reason: string | null;
  } | null;
};

const SAMPLE_NAME = /^[\w-]+$/;
const now = () => new Date().toISOString();

export function createInbox(deps: InboxDeps) {
  const { db } = deps;

  const existing = (messageId: string) =>
    db.select().from(inboundEmails).where(eq(inboundEmails.messageId, messageId)).get();

  function findThread(email: ParsedEmail): string | null {
    const ids = [email.inReplyTo, ...email.references].filter((id): id is string => Boolean(id));
    if (ids.length > 0) {
      const inbound = db
        .select({ shipmentId: inboundEmails.shipmentId })
        .from(inboundEmails)
        .where(inArray(inboundEmails.messageId, ids))
        .get();
      if (inbound) return inbound.shipmentId;
      const sent = db
        .select({ shipmentId: outboundEmails.shipmentId })
        .from(outboundEmails)
        .where(inArray(outboundEmails.messageId, ids))
        .get();
      if (sent) return sent.shipmentId;
    }
    const reference = email.subject.match(/\[(SHP-\d+)\]/)?.[1];
    const shipment =
      reference && db.select().from(shipments).where(eq(shipments.reference, reference)).get();
    if (!shipment) return null;
    const knownSender = db
      .select({ id: inboundEmails.id })
      .from(inboundEmails)
      .where(
        and(
          eq(inboundEmails.shipmentId, shipment.id),
          eq(inboundEmails.fromAddress, email.fromAddress),
        ),
      )
      .get();
    return knownSender ? shipment.id : null;
  }

  function previousExtraction(shipmentId: string, contentHash: string) {
    return db
      .select({
        documentId: documents.id,
        runId: pipelineRuns.id,
        docType: documents.docType,
        reason: documents.docTypeReason,
      })
      .from(documents)
      .innerJoin(pipelineRuns, eq(pipelineRuns.documentId, documents.id))
      .where(
        and(
          eq(documents.shipmentId, shipmentId),
          eq(documents.contentHash, contentHash),
          eq(pipelineRuns.status, "COMPLETED"),
          isNull(pipelineRuns.errorCode),
        ),
      )
      .orderBy(desc(documents.createdAt))
      .get();
  }

  async function prepare(email: ParsedEmail, shipmentId: string | null) {
    const prepared: Prepared[] = [];
    const duplicates: string[] = [];
    const seen = new Set<string>();
    for (const attachment of email.attachments) {
      const contentHash = createHash("sha256").update(attachment.content).digest("hex");
      if (seen.has(contentHash)) {
        duplicates.push(attachment.filename);
        continue;
      }
      seen.add(contentHash);

      const extension = attachment.mimeType ? SUPPORTED_MIME_TYPES[attachment.mimeType] : undefined;
      const error =
        prepared.length >= deps.maxAttachments
          ? {
              code: "TOO_MANY_ATTACHMENTS",
              message: `Only the first ${deps.maxAttachments} attachments are processed.`,
            }
          : !extension
            ? {
                code: "UNSUPPORTED_FILE_TYPE",
                message: "This file type cannot be read. Supported: PDF, PNG, JPEG, WEBP.",
              }
            : attachment.content.length > deps.maxAttachmentBytes
              ? { code: "FILE_TOO_LARGE", message: "The file exceeds the size limit." }
              : null;

      const documentId = newId("doc");
      const storagePath = join(deps.uploadDir, `${documentId}.${error ? "bin" : extension}`);
      await writeFile(storagePath, attachment.content);
      prepared.push({
        documentId,
        filename: sanitizeFilename(attachment.filename),
        // Unreadable files are served as downloads, never with the type the sender declared.
        mimeType: error ? "application/octet-stream" : attachment.mimeType!,
        size: attachment.content.length,
        storagePath,
        contentHash,
        error,
        unchangedFrom:
          !error && shipmentId ? (previousExtraction(shipmentId, contentHash) ?? null) : null,
      });
    }
    return { prepared, duplicates };
  }

  async function ingest(raw: Buffer): Promise<IngestResult> {
    const email = await parseEmail(raw);
    const known = existing(email.messageId);
    if (known) {
      return {
        shipmentId: known.shipmentId,
        emailId: known.id,
        cycle: known.cycle,
        duplicate: true,
      };
    }

    await mkdir(deps.emailDir, { recursive: true });
    await mkdir(deps.uploadDir, { recursive: true });
    const emailId = newId("email");
    const rawPath = join(deps.emailDir, `${emailId}.eml`);
    await writeFile(rawPath, raw);
    const threadShipmentId = findThread(email);
    const { prepared, duplicates } = await prepare(email, threadShipmentId);

    const result = db.transaction((tx): IngestResult => {
      const raced = tx
        .select()
        .from(inboundEmails)
        .where(eq(inboundEmails.messageId, email.messageId))
        .get();
      if (raced) {
        return {
          shipmentId: raced.shipmentId,
          emailId: raced.id,
          cycle: raced.cycle,
          duplicate: true,
        };
      }

      let shipmentId = threadShipmentId;
      let cycle = 1;
      if (shipmentId) {
        const shipment = tx.select().from(shipments).where(eq(shipments.id, shipmentId)).get()!;
        cycle = shipment.cycle + 1;
        tx.update(shipments)
          .set({
            cycle,
            status: "RECEIVED",
            stage: null,
            headline: "New supplier email received",
            updatedAt: now(),
          })
          .where(eq(shipments.id, shipmentId))
          .run();
        tx.update(outboundEmails)
          .set({ status: "superseded", updatedAt: now() })
          .where(and(eq(outboundEmails.shipmentId, shipmentId), eq(outboundEmails.status, "draft")))
          .run();
      } else {
        // Highest number + 1, not a row count, so references stay unique after a shipment is deleted.
        const last =
          tx
            .select({ n: sql<number>`max(cast(substr(${shipments.reference}, 5) as integer))` })
            .from(shipments)
            .get()?.n ?? 0;
        shipmentId = newId("shp");
        tx.insert(shipments)
          .values({
            id: shipmentId,
            reference: `SHP-${String(last + 1).padStart(4, "0")}`,
            subject: email.subject,
            supplierName: email.fromName,
            supplierAddress: email.fromAddress,
            status: "RECEIVED",
            headline: "New supplier email received",
          })
          .run();
      }

      tx.insert(inboundEmails)
        .values({
          id: emailId,
          shipmentId,
          cycle,
          messageId: email.messageId,
          fromName: email.fromName,
          fromAddress: email.fromAddress,
          replyTo: email.replyTo,
          toAddress: email.to,
          subject: email.subject,
          bodyText: email.text,
          sentAt: email.sentAt,
          inReplyTo: email.inReplyTo,
          referencesJson: JSON.stringify(email.references),
          rawPath,
        })
        .run();

      for (const p of prepared) {
        tx.insert(documents)
          .values({
            id: p.documentId,
            originalFilename: p.filename,
            mimeType: p.mimeType,
            fileSize: p.size,
            storagePath: p.storagePath,
            contentHash: p.contentHash,
            shipmentId,
            inboundEmailId: emailId,
            cycle,
            docType: p.unchangedFrom?.docType ?? null,
            docTypeReason: p.unchangedFrom ? p.unchangedFrom.reason : null,
            unchangedFromDocumentId: p.unchangedFrom?.documentId ?? null,
          })
          .run();
        const runId = newId("run");
        const done = Boolean(p.error || p.unchangedFrom);
        tx.insert(pipelineRuns)
          .values({
            id: runId,
            documentId: p.documentId,
            status: done ? "COMPLETED" : "RECEIVED",
            currentStage: p.unchangedFrom ? "EXTRACTED" : "RECEIVED",
            errorCode: p.error?.code ?? null,
            errorMessage: p.error?.message ?? null,
            completedAt: done ? now() : null,
          })
          .run();
        if (p.unchangedFrom) {
          const rows = tx
            .select()
            .from(extractions)
            .where(eq(extractions.runId, p.unchangedFrom.runId))
            .all()
            .map(({ id: _id, runId: _runId, createdAt: _c, ...row }) => row);
          for (const row of rows) {
            tx.insert(extractions)
              .values({ ...row, id: newId("ext"), runId })
              .run();
          }
          recordEvent(
            tx,
            shipmentId,
            "attachment_unchanged",
            `${p.filename} is unchanged from the previous version.`,
          );
        }
        if (p.error) {
          recordEvent(tx, shipmentId, "attachment_failed", `${p.filename}: ${p.error.message}`);
        }
      }

      const sender = email.fromName
        ? `${email.fromName} <${email.fromAddress}>`
        : email.fromAddress;
      const files = prepared.length === 1 ? "1 attachment" : `${prepared.length} attachments`;
      recordEvent(
        tx,
        shipmentId,
        "email_received",
        cycle > 1
          ? `Supplier replied (cycle ${cycle}) from ${sender} with ${files}.`
          : `Email from ${sender} with ${files}.`,
        { messageId: email.messageId, cycle },
      );
      for (const name of email.skipped) {
        recordEvent(tx, shipmentId, "attachment_skipped", `Skipped inline image ${name}.`);
      }
      for (const name of duplicates) {
        recordEvent(
          tx,
          shipmentId,
          "attachment_duplicate",
          `${name} was attached twice; kept once.`,
        );
      }
      return { shipmentId, emailId, cycle, duplicate: false };
    });

    if (!result.duplicate) deps.onShipmentReady(result.shipmentId);
    return result;
  }

  async function sampleFiles() {
    try {
      return (await readdir(deps.samplesDir))
        .filter((f) => f.endsWith(".eml"))
        .sort((a, b) => a.replace(/\.eml$/, "").localeCompare(b.replace(/\.eml$/, "")));
    } catch {
      return [];
    }
  }

  return {
    ingest,

    async listSamples() {
      const samples = [];
      for (const file of await sampleFiles()) {
        const email = await parseEmail(await readFile(join(deps.samplesDir, file)));
        samples.push({
          name: file.replace(/\.eml$/, ""),
          subject: email.subject,
          from: email.fromName ? `${email.fromName} <${email.fromAddress}>` : email.fromAddress,
          inReplyTo: email.inReplyTo,
          attachments: email.attachments.map((a) => a.filename),
        });
      }
      return samples;
    },

    async deliverSample(name: string) {
      if (!SAMPLE_NAME.test(name) || !(await sampleFiles()).includes(`${name}.eml`)) return null;
      await mkdir(deps.inboxDir, { recursive: true });
      const stamp = Date.now();
      const temp = join(deps.inboxDir, `.${name}-${stamp}.tmp`);
      const file = `${name}-${stamp}.eml`;
      await copyFile(join(deps.samplesDir, `${name}.eml`), temp);
      await rename(temp, join(deps.inboxDir, file));
      return { file };
    },
  };
}

export type Inbox = ReturnType<typeof createInbox>;
