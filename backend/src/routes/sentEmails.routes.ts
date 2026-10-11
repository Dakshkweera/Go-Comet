import { Router } from "express";
import type { createSentEmailsController } from "../controllers/sentEmails.controller.js";

export function createSentEmailsRouter(controller: ReturnType<typeof createSentEmailsController>) {
  const router = Router();
  router.get("/", controller.list);
  return router;
}
