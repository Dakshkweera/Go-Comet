import cors from "cors";
import express from "express";
import { pinoHttp } from "pino-http";
import type { NovaDb } from "./db/index.js";
import { errorHandler, notFoundHandler } from "./middlewares/error.middleware.js";
import { createApiRouter } from "./routes/index.js";
import type { Inbox } from "./services/inbox/index.js";
import type { Pipeline } from "./services/pipeline.service.js";
import type { QueryService } from "./services/query/index.js";
import type { ShipmentService } from "./services/shipment/index.js";
import type { Logger } from "./utils/logger.js";

export type AppDeps = {
  db: NovaDb;
  pipeline: Pipeline;
  queryService: QueryService | null;
  shipments: ShipmentService;
  inbox: Inbox;
  uploadDir: string;
  emailDir: string;
  minConfidence: number;
  maxUploadBytes: number;
  maxEmailBytes: number;
  cgMailbox: string;
  corsOrigins: string[];
  logger: Logger;
};

export function createApp(deps: AppDeps) {
  const app = express();
  app.disable("x-powered-by");
  app.use(pinoHttp({ logger: deps.logger }));
  app.use(cors({ origin: deps.corsOrigins.includes("*") ? true : deps.corsOrigins }));
  app.use(express.json({ limit: "100kb" }));
  app.use("/api", createApiRouter(deps));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
