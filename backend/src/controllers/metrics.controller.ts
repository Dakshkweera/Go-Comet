import type { RequestHandler } from "express";
import type { NovaDb } from "../db/index.js";
import { getMetrics } from "../services/shipment/index.js";

export function createMetricsController(db: NovaDb) {
  const get: RequestHandler = (_req, res) => {
    res.json(getMetrics(db));
  };
  return { get };
}
