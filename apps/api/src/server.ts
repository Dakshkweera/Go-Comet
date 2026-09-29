import Fastify, { type FastifyError, type FastifyServerOptions } from "fastify";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import type { ApiError } from "@nova/contracts";
import type { NovaDb } from "@nova/db";
import type { Pipeline } from "@nova/pipeline";
import { registerHealthRoutes } from "./routes/health.js";
import { registerRunRoutes } from "./routes/runs.js";

export type ServerDeps = {
  db: NovaDb;
  pipeline: Pipeline;
  uploadDir: string;
  maxUploadBytes: number;
  webDistDir?: string | null;
  logger?: FastifyServerOptions["logger"];
};

const apiError = (code: string, message: string): ApiError => ({ error: { code, message } });

export function buildServer(deps: ServerDeps) {
  const { db, webDistDir, logger = false } = deps;
  const app = Fastify({ logger });

  app.register(fastifyMultipart, { limits: { fileSize: deps.maxUploadBytes, files: 1 } });
  registerHealthRoutes(app, { db });
  registerRunRoutes(app, deps);

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
