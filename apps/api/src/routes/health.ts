import type { FastifyInstance } from "fastify";
import type { HealthResponse } from "../../../../packages/contracts/src/index.js";
import { pingDb } from "../../../../packages/db/src/index.js";
import { db } from "../container.js";

export default async function healthRoutes(app: FastifyInstance) {
  app.get("/", async (_request, reply) => {
    const dbOk = pingDb(db);
    const body: HealthResponse = { status: dbOk ? "ok" : "degraded", db: dbOk ? "ok" : "error" };
    return reply.code(dbOk ? 200 : 503).send(body);
  });
}
