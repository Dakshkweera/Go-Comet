import type { AppConfig } from "./config/env.js";
import { createDb, seedDb } from "./db/index.js";
import { createExtractor, createFakeExtractor } from "./services/extraction/index.js";
import { createLlmClient } from "./services/llm/index.js";
import { createPipeline } from "./services/pipeline.service.js";
import { createQueryService, type QueryModels } from "./services/query/index.js";
import { createRouter } from "./services/routing/index.js";
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
  const extractor = llm ? createExtractor({ llm, model: extractorModel! }) : createFakeExtractor();

  const queryService = llm
    ? createQueryService({ db, llm, models: queryModels as QueryModels })
    : null;

  const pipeline = createPipeline({
    db,
    extractor,
    validator: createValidator({ minConfidence: policy.extractionMinConfidence }),
    router: createRouter({ minConfidence: policy.extractionMinConfidence }),
    minConfidence: policy.extractionMinConfidence,
    maxAttempts: llmConfig.maxAttempts,
  });

  return { logger, db, queryService, pipeline };
}
