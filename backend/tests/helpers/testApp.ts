import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type AppDeps } from "../../src/app.js";
import { createDb, seedDb } from "../../src/db/index.js";
import type { ExtractorAgent } from "../../src/schemas/index.js";
import { createFakeExtractor } from "../../src/services/extraction/index.js";
import { createInbox } from "../../src/services/inbox/index.js";
import { createPipeline } from "../../src/services/pipeline.service.js";
import { createRouter } from "../../src/services/routing/index.js";
import { createShipmentService } from "../../src/services/shipment/index.js";
import { createValidator } from "../../src/services/validation/index.js";
import { createLogger } from "../../src/utils/logger.js";

export const ALLOWED_ORIGIN = "http://localhost:5173";

export function createTestApp(
  overrides: Partial<AppDeps> = {},
  { extractor = createFakeExtractor() }: { extractor?: ExtractorAgent } = {},
) {
  const db = createDb(":memory:");
  seedDb(db);
  const uploadDir = mkdtempSync(join(tmpdir(), "nova-api-"));
  const logger = createLogger("silent");
  const validator = createValidator({ minConfidence: 0.8 });
  const pipeline = createPipeline({
    db,
    extractor,
    validator,
    router: createRouter({ minConfidence: 0.8 }),
    minConfidence: 0.8,
    maxAttempts: 3,
    retryDelayMs: 0,
  });
  const shipments = createShipmentService({
    db,
    pipeline,
    validator,
    minConfidence: 0.8,
    cg: { mailbox: "cg@nova.local", signature: "CG Team" },
    logger,
  });
  const processing: Promise<void>[] = [];
  const inbox = createInbox({
    db,
    uploadDir,
    emailDir: join(uploadDir, "emails"),
    inboxDir: join(uploadDir, "inbox"),
    samplesDir: join(uploadDir, "samples"),
    maxAttachments: 10,
    maxAttachmentBytes: 1024 * 1024,
    onShipmentReady: (id) => void processing.push(shipments.processCycle(id)),
  });
  const app = createApp({
    db,
    pipeline,
    queryService: null,
    shipments,
    inbox,
    uploadDir,
    emailDir: join(uploadDir, "emails"),
    minConfidence: 0.8,
    maxUploadBytes: 1024 * 1024,
    maxEmailBytes: 5 * 1024 * 1024,
    cgMailbox: "cg@nova.local",
    corsOrigins: [ALLOWED_ORIGIN],
    logger,
    ...overrides,
  });
  /** Waits until every shipment the inbox handed over has been processed. */
  const settle = async () => {
    while (processing.length) await processing.shift();
  };
  const cleanup = () => {
    if (db.$client.open) db.$client.close();
    rmSync(uploadDir, { recursive: true, force: true });
  };
  return { app, db, uploadDir, inbox, shipments, settle, cleanup };
}
