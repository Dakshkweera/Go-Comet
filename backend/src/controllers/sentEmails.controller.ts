import type { RequestHandler } from "express";
import type { NovaDb } from "../db/index.js";
import { listSentEmails } from "../services/shipment/index.js";

export function createSentEmailsController(db: NovaDb) {
  const list: RequestHandler = (_req, res) => {
    res.json(listSentEmails(db));
  };
  return { list };
}
