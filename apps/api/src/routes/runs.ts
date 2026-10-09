import { readFile } from "node:fs/promises";
import type { FastifyInstance, FastifyReply } from "fastify";
import {
  createRun,
  deleteRun,
  getRun,
  listRuns,
  SUPPORTED_MIME_TYPES,
} from "../../../../packages/pipeline/src/index.js";
import { config, db, pipeline } from "../container.js";

const uploadDir = config.uploadDir;
const minConfidence = config.policy.extractionMinConfidence;

const badRequest = (reply: FastifyReply, code: string, message: string) =>
  reply.code(400).send({ error: { code, message } });

const notFound = (reply: FastifyReply, code: string, message: string) =>
  reply.code(404).send({ error: { code, message } });

export default async function runRoutes(app: FastifyInstance) {
  app.post("/", async (request, reply) => {
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

  app.get("/", async () => listRuns(db));

  app.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const run = getRun(db, request.params.id, minConfidence);
    if (!run)
      return reply.code(404).send({ error: { code: "RUN_NOT_FOUND", message: "Run not found." } });
    return run;
  });

  app.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const result = await deleteRun(db, uploadDir, request.params.id);
    if (result.status === "not_found") return notFound(reply, "RUN_NOT_FOUND", "Run not found.");
    if (result.status === "in_progress") {
      return reply.code(409).send({
        error: {
          code: "RUN_IN_PROGRESS",
          message: "The run is still processing; try again when it finishes.",
        },
      });
    }
    const { runId, documentId, fileDeleted } = result;
    return { deleted: true, runId, documentId, fileDeleted };
  });

  app.get<{ Params: { id: string } }>("/:id/document", async (request, reply) => {
    const run = db.query.pipelineRuns
      .findFirst({ where: (r, { eq }) => eq(r.id, request.params.id) })
      .sync();
    const doc =
      run &&
      db.query.documents.findFirst({ where: (d, { eq }) => eq(d.id, run.documentId) }).sync();
    if (!doc) return notFound(reply, "RUN_NOT_FOUND", "Run not found.");

    let content: Buffer;
    try {
      content = await readFile(doc.storagePath);
    } catch {
      return notFound(reply, "DOCUMENT_MISSING", "The stored document file no longer exists.");
    }
    return reply
      .type(doc.mimeType)
      .header("Content-Disposition", `inline; filename="${doc.originalFilename.replace(/"/g, "")}"`)
      .header("X-Content-Type-Options", "nosniff")
      .send(content);
  });
}
