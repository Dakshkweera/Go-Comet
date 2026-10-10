import { Router } from "express";
import type { AppDeps } from "../app.js";
import { createHealthController } from "../controllers/health.controller.js";
import { createQueryController } from "../controllers/query.controller.js";
import { createRunsController } from "../controllers/runs.controller.js";
import { createUploadMiddleware } from "../middlewares/upload.middleware.js";
import { createHealthRouter } from "./health.routes.js";
import { createQueryRouter } from "./query.routes.js";
import { createRunsRouter } from "./runs.routes.js";

export function createApiRouter(deps: AppDeps) {
  const router = Router();
  router.use("/health", createHealthRouter(createHealthController(deps.db)));
  router.use(
    "/runs",
    createRunsRouter(createRunsController(deps), createUploadMiddleware(deps.maxUploadBytes)),
  );
  router.use("/query", createQueryRouter(createQueryController(deps.queryService)));
  return router;
}
