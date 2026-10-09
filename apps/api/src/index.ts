import { config, db, pipeline } from "./container.js";
import { buildServer } from "./server.js";

const app = buildServer();

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
