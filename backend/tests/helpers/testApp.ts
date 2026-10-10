import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type AppDeps } from "../../src/app.js";
import { createDb, seedDb } from "../../src/db/index.js";
import { createFakeExtractor } from "../../src/services/extraction/index.js";
import { createPipeline } from "../../src/services/pipeline.service.js";
import { createRouter } from "../../src/services/routing/index.js";
import { createValidator } from "../../src/services/validation/index.js";
import { createLogger } from "../../src/utils/logger.js";

export const ALLOWED_ORIGIN = "http://localhost:5173";

export function createTestApp(overrides: Partial<AppDeps> = {}) {
  const db = createDb(":memory:");
  seedDb(db);
  const uploadDir = mkdtempSync(join(tmpdir(), "nova-api-"));
  const pipeline = createPipeline({
    db,
    extractor: createFakeExtractor(),
    validator: createValidator({ minConfidence: 0.8 }),
    router: createRouter({ minConfidence: 0.8 }),
    minConfidence: 0.8,
    maxAttempts: 3,
    retryDelayMs: 0,
  });
  const app = createApp({
    db,
    pipeline,
    queryService: null,
    uploadDir,
    minConfidence: 0.8,
    maxUploadBytes: 1024 * 1024,
    corsOrigins: [ALLOWED_ORIGIN],
    logger: createLogger("silent"),
    ...overrides,
  });
  const cleanup = () => {
    if (db.$client.open) db.$client.close();
    rmSync(uploadDir, { recursive: true, force: true });
  };
  return { app, db, uploadDir, cleanup };
}
