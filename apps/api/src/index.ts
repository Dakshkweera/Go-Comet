import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { createDb, seedDb } from "@nova/db";
import { createExtractor, createFakeExtractor } from "@nova/extraction";
import { createLlmClient } from "@nova/llm";
import { createPipeline } from "@nova/pipeline";
import { createQueryService, type QueryModels } from "@nova/query";
import { createRouter } from "@nova/routing";
import { createValidator } from "@nova/validation";
import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";

const rootDir = fileURLToPath(new URL("../../..", import.meta.url));
loadDotenv({ path: resolve(rootDir, ".env"), quiet: true });

const config = loadConfig(process.env, rootDir);
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
  maxAttempts: llmConfig.maxAttempts,
});

const app = buildServer({
  db,
  pipeline,
  queryService,
  uploadDir: config.uploadDir,
  maxUploadBytes: config.limits.maxUploadBytes,
  webDistDir: existsSync(resolve(config.webDistDir, "index.html")) ? config.webDistDir : null,
  logger: { level: process.env.LOG_LEVEL ?? "info" },
});

const shutdown = async () => {
  await app.close();
  db.$client.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ host: config.host, port: config.port });

for (const runId of pipeline.pendingRunIds()) {
  app.log.info({ runId }, "resuming interrupted run");
  pipeline.run(runId).catch((err) => app.log.error({ err, runId }, "resume failed"));
}
