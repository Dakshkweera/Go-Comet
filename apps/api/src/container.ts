import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { createDb, seedDb } from "../../../packages/db/src/index.js";
import { createExtractor, createFakeExtractor } from "../../../packages/extraction/src/index.js";
import { createLlmClient } from "../../../packages/llm/src/index.js";
import { createPipeline } from "../../../packages/pipeline/src/index.js";
import { createQueryService, type QueryModels } from "../../../packages/query/src/index.js";
import { createRouter } from "../../../packages/routing/src/index.js";
import { createValidator } from "../../../packages/validation/src/index.js";
import { loadConfig } from "./config.js";

const rootDir = fileURLToPath(new URL("../../..", import.meta.url));
loadDotenv({ path: resolve(rootDir, ".env"), quiet: true });

export const config = loadConfig(process.env, rootDir);
export const db = createDb(config.databasePath);
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

export const queryService = llm
  ? createQueryService({ db, llm, models: queryModels as QueryModels })
  : null;

export const pipeline = createPipeline({
  db,
  extractor,
  validator: createValidator({ minConfidence: policy.extractionMinConfidence }),
  router: createRouter({ minConfidence: policy.extractionMinConfidence }),
  minConfidence: policy.extractionMinConfidence,
  maxAttempts: llmConfig.maxAttempts,
});

export const webDistDir = existsSync(resolve(config.webDistDir, "index.html"))
  ? config.webDistDir
  : null;
export const logger = { level: process.env.LOG_LEVEL ?? "info" };
