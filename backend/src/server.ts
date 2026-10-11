import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { createApp } from "./app.js";
import { loadConfig } from "./config/env.js";
import { buildContainer } from "./container.js";

const baseDir = fileURLToPath(new URL("..", import.meta.url));
loadDotenv({ path: resolve(baseDir, ".env"), quiet: true });

const config = loadConfig(process.env, baseDir);
const { logger, db, queryService, pipeline, shipments, inbox, watcher } = buildContainer(config);

const app = createApp({
  db,
  pipeline,
  queryService,
  shipments,
  inbox,
  uploadDir: config.uploadDir,
  emailDir: config.inbox.emailDir,
  minConfidence: config.policy.extractionMinConfidence,
  maxUploadBytes: config.limits.maxUploadBytes,
  maxEmailBytes: config.limits.maxEmailBytes,
  cgMailbox: config.cg.mailbox,
  corsOrigins: config.corsOrigins,
  logger,
});

const server = app.listen(config.port, config.host);

server.once("listening", () => {
  logger.info({ host: config.host, port: config.port }, "api listening");
  for (const runId of pipeline.pendingRunIds()) {
    logger.info({ runId }, "resuming interrupted run");
    pipeline.run(runId).catch((err) => logger.error({ err, runId }, "resume failed"));
  }
  void shipments.resume();
  watcher.start();
  logger.info({ inbox: config.inbox.dir, pollMs: config.inbox.pollMs }, "watching inbox");
});

server.once("error", (err) => {
  logger.error({ err }, "failed to start");
  process.exit(1);
});

const shutdown = () => {
  watcher.stop();
  server.close(() => {
    db.$client.close();
    process.exit(0);
  });
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
