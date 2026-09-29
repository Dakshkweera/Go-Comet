import Fastify, { type FastifyError, type FastifyServerOptions } from "fastify";
import fastifyStatic from "@fastify/static";
import type { ApiError } from "@nova/contracts";
import type { NovaDb } from "@nova/db";
import { registerHealthRoutes } from "./routes/health.js";

export type ServerDeps = {
  db: NovaDb;
  webDistDir?: string | null;
  logger?: FastifyServerOptions["logger"];
};

const apiError = (code: string, message: string): ApiError => ({ error: { code, message } });

export function buildServer({ db, webDistDir, logger = false }: ServerDeps) {
  const app = Fastify({ logger });

  registerHealthRoutes(app, { db });

  if (webDistDir) {
    app.register(fastifyStatic, { root: webDistDir, wildcard: false });
  }

  app.setNotFoundHandler((request, reply) => {
    if (webDistDir && request.method === "GET" && !request.url.startsWith("/api/")) {
      return reply.sendFile("index.html");
    }
    return reply
      .code(404)
      .send(apiError("NOT_FOUND", `Route ${request.method} ${request.url} not found.`));
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const status = error.statusCode && error.statusCode < 500 ? error.statusCode : 500;
    if (status >= 500) {
      request.log.error({ err: error }, "unhandled error");
      return reply.code(500).send(apiError("INTERNAL_ERROR", "An internal error occurred."));
    }
    return reply.code(status).send(apiError(error.code ?? "BAD_REQUEST", error.message));
  });

  return app;
}
