import { Router, type RequestHandler } from "express";
import type { createRunsController } from "../controllers/runs.controller.js";

export function createRunsRouter(
  controller: ReturnType<typeof createRunsController>,
  upload: RequestHandler,
) {
  const router = Router();
  router.post("/", upload, controller.create);
  router.get("/", controller.list);
  router.get("/:id", controller.get);
  router.delete("/:id", controller.remove);
  router.get("/:id/document", controller.document);
  return router;
}
