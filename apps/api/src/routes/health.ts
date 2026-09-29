import type { FastifyInstance } from "fastify";
import type { HealthResponse } from "@nova/contracts";
import { pingDb, type NovaDb } from "@nova/db";

export function registerHealthRoutes(app: FastifyInstance, deps: { db: NovaDb }) {
  app.get("/api/health", async (_request, reply) => {
    const dbOk = pingDb(deps.db);
    const body: HealthResponse = { status: dbOk ? "ok" : "degraded", db: dbOk ? "ok" : "error" };
    return reply.code(dbOk ? 200 : 503).send(body);
  });
}
