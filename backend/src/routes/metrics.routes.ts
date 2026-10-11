import { Router } from "express";
import type { createMetricsController } from "../controllers/metrics.controller.js";

export function createMetricsRouter(controller: ReturnType<typeof createMetricsController>) {
  const router = Router();
  router.get("/", controller.get);
  return router;
}
