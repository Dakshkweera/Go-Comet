import type { AppConfig } from "./config/env.js";
import { createDb, seedDb } from "./db/index.js";
import {
  createExtractor,
  createFakeExtractor,
  limitExtractor,
} from "./services/extraction/index.js";
import { createInbox, createInboxWatcher } from "./services/inbox/index.js";
import { createLlmClient } from "./services/llm/index.js";
import { createPipeline } from "./services/pipeline.service.js";
import { createQueryService, type QueryModels } from "./services/query/index.js";
import { createRouter } from "./services/routing/index.js";
import { createShipmentService } from "./services/shipment/index.js";
import { createValidator } from "./services/validation/index.js";
import { createLogger } from "./utils/logger.js";

export function buildContainer(config: AppConfig) {
  const logger = createLogger(config.logLevel);
  const db = createDb(config.databasePath);
  seedDb(db);

  const { llm: llmConfig, policy } = config;
  const llm =
    llmConfig.provider === "openrouter"
      ? createLlmClient({
          baseUrl: llmConfig.baseUrl,
          apiKey: llmConfig.apiKey!,
          timeoutMs: llmConfig.timeoutMs,
        })
      : null;
  const { extractor: extractorModel, ...queryModels } = llmConfig.models;
  const extractor = limitExtractor(
    llm ? createExtractor({ llm, model: extractorModel! }) : createFakeExtractor(),
    llmConfig.concurrency,
  );

  const queryService = llm
    ? createQueryService({ db, llm, models: queryModels as QueryModels })
    : null;

  const minConfidence = policy.extractionMinConfidence;
  const validator = createValidator({ minConfidence });
  const pipeline = createPipeline({
    db,
    extractor,
    validator,
    router: createRouter({ minConfidence }),
    minConfidence,
    maxAttempts: llmConfig.maxAttempts,
  });

  const shipments = createShipmentService({
    db,
    pipeline,
    validator,
    minConfidence,
    cg: config.cg,
    logger,
  });
  const inbox = createInbox({
    db,
    uploadDir: config.uploadDir,
    emailDir: config.inbox.emailDir,
    inboxDir: config.inbox.dir,
    samplesDir: config.inbox.samplesDir,
    maxAttachments: config.limits.maxAttachments,
    maxAttachmentBytes: config.limits.maxUploadBytes,
    onShipmentReady: (shipmentId) => void shipments.processCycle(shipmentId),
  });
  const watcher = createInboxWatcher({
    dir: config.inbox.dir,
    pollMs: config.inbox.pollMs,
    ingest: inbox.ingest,
    logger,
  });

  return { logger, db, queryService, pipeline, shipments, inbox, watcher };
}
