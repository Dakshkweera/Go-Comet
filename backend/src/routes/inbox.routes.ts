import { Router, type RequestHandler } from "express";
import type { createInboxController } from "../controllers/inbox.controller.js";

export function createInboxRouter(
  controller: ReturnType<typeof createInboxController>,
  upload: RequestHandler,
) {
  const router = Router();
  router.get("/samples", controller.samples);
  router.post("/samples/:name/deliver", controller.deliver);
  router.post("/emails", upload, controller.upload);
  return router;
}
