import { Router } from "express";
import type { createQueryController } from "../controllers/query.controller.js";

export function createQueryRouter(controller: ReturnType<typeof createQueryController>) {
  const router = Router();
  router.post("/", controller.ask);
  return router;
}
