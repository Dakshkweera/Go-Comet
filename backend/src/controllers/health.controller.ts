import type { RequestHandler } from "express";
import { pingDb, type NovaDb } from "../db/index.js";
import type { HealthResponse } from "../schemas/index.js";

export function createHealthController(db: NovaDb) {
  const check: RequestHandler = (_req, res) => {
    const dbOk = pingDb(db);
    const body: HealthResponse = { status: dbOk ? "ok" : "degraded", db: dbOk ? "ok" : "error" };
    res.status(dbOk ? 200 : 503).json(body);
  };
  return { check };
}
