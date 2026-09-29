import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { createDb, seedDb } from "@nova/db";
import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";

const rootDir = fileURLToPath(new URL("../../..", import.meta.url));
loadDotenv({ path: resolve(rootDir, ".env"), quiet: true });

const config = loadConfig(process.env, rootDir);
const db = createDb(config.databasePath);
seedDb(db);
const app = buildServer({
  db,
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
