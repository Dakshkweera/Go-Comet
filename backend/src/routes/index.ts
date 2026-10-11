import { Router } from "express";
import type { AppDeps } from "../app.js";
import { createHealthController } from "../controllers/health.controller.js";
import { createInboxController } from "../controllers/inbox.controller.js";
import { createMetricsController } from "../controllers/metrics.controller.js";
import { createQueryController } from "../controllers/query.controller.js";
import { createRunsController } from "../controllers/runs.controller.js";
import { createSentEmailsController } from "../controllers/sentEmails.controller.js";
import { createShipmentsController } from "../controllers/shipments.controller.js";
import { createUploadMiddleware } from "../middlewares/upload.middleware.js";
import { createHealthRouter } from "./health.routes.js";
import { createInboxRouter } from "./inbox.routes.js";
import { createMetricsRouter } from "./metrics.routes.js";
import { createQueryRouter } from "./query.routes.js";
import { createRunsRouter } from "./runs.routes.js";
import { createSentEmailsRouter } from "./sentEmails.routes.js";
import { createShipmentsRouter } from "./shipments.routes.js";

export function createApiRouter(deps: AppDeps) {
  const router = Router();
  router.use("/health", createHealthRouter(createHealthController(deps.db)));
  router.use(
    "/runs",
    createRunsRouter(createRunsController(deps), createUploadMiddleware(deps.maxUploadBytes)),
  );
  router.use("/query", createQueryRouter(createQueryController(deps.queryService)));
  router.use(
    "/inbox",
    createInboxRouter(
      createInboxController(deps.inbox),
      createUploadMiddleware(deps.maxEmailBytes),
    ),
  );
  router.use("/shipments", createShipmentsRouter(createShipmentsController(deps)));
  router.use("/sent-emails", createSentEmailsRouter(createSentEmailsController(deps.db)));
  router.use("/metrics", createMetricsRouter(createMetricsController(deps.db)));
  return router;
}
