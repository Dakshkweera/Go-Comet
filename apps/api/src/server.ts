import Fastify, { type FastifyError } from "fastify";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import type { ApiError } from "../../../packages/contracts/src/index.js";
import { config, logger, webDistDir } from "./container.js";
import healthRoutes from "./routes/health.js";
import queryRoutes from "./routes/query.js";
import runRoutes from "./routes/runs.js";

const apiError = (code: string, message: string): ApiError => ({ error: { code, message } });

export function buildServer() {
  const app = Fastify({ logger });

  app.register(fastifyMultipart, { limits: { fileSize: config.limits.maxUploadBytes, files: 1 } });
  app.register(healthRoutes, { prefix: "/api/health" });
  app.register(runRoutes, { prefix: "/api/runs" });
  app.register(queryRoutes, { prefix: "/api/query" });

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
