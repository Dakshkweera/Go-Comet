import type { FastifyInstance, FastifyReply } from "fastify";
import type { NovaDb } from "@nova/db";
import { createRun, getRun, listRuns, SUPPORTED_MIME_TYPES, type Pipeline } from "@nova/pipeline";

export type RunRouteDeps = { db: NovaDb; pipeline: Pipeline; uploadDir: string };

const badRequest = (reply: FastifyReply, code: string, message: string) =>
  reply.code(400).send({ error: { code, message } });

export function registerRunRoutes(app: FastifyInstance, { db, pipeline, uploadDir }: RunRouteDeps) {
  app.post("/api/runs", async (request, reply) => {
    const file = await request.file();
    if (!file) return badRequest(reply, "INVALID_FILE", "Upload a document in the 'file' field.");
    if (!SUPPORTED_MIME_TYPES[file.mimetype]) {
      return badRequest(reply, "UNSUPPORTED_FILE_TYPE", "Supported types: PDF, PNG, JPEG, WEBP.");
    }
    const buffer = await file.toBuffer();
    if (buffer.length === 0)
      return badRequest(reply, "INVALID_FILE", "The uploaded file is empty.");
    if (file.mimetype === "application/pdf" && buffer.subarray(0, 5).toString() !== "%PDF-") {
      return badRequest(reply, "DOCUMENT_READ_ERROR", "The file is not a readable PDF.");
    }

    const created = await createRun(db, uploadDir, {
      buffer,
      filename: file.filename,
      mimeType: file.mimetype,
    });
    pipeline.run(created.runId).catch((err) => request.log.error({ err }, "pipeline failed"));
    return reply.code(202).send(created);
  });

  app.get("/api/runs", async () => listRuns(db));

  app.get<{ Params: { id: string } }>("/api/runs/:id", async (request, reply) => {
    const run = getRun(db, request.params.id);
    if (!run)
      return reply.code(404).send({ error: { code: "RUN_NOT_FOUND", message: "Run not found." } });
    return run;
  });
}
