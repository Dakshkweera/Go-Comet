import { Router } from "express";
import type { createShipmentsController } from "../controllers/shipments.controller.js";

export function createShipmentsRouter(controller: ReturnType<typeof createShipmentsController>) {
  const router = Router();
  router.get("/", controller.list);
  router.get("/:id", controller.get);
  router.delete("/:id", controller.remove);
  router.post("/:id/review", controller.review);
  router.put("/:id/documents/:documentId/type", controller.setType);
  router.put("/:id/draft", controller.updateDraft);
  router.post("/:id/draft/send", controller.send);
  return router;
}
