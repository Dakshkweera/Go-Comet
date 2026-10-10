import { readFile } from "node:fs/promises";
import type { RequestHandler } from "express";
import type { NovaDb } from "../db/index.js";
import type { Pipeline } from "../services/pipeline.service.js";
import {
  createRun,
  deleteRun,
  getRun,
  listRuns,
  SUPPORTED_MIME_TYPES,
} from "../services/run.service.js";
import { apiError } from "../utils/apiError.js";

export type RunsControllerDeps = {
  db: NovaDb;
  pipeline: Pipeline;
  uploadDir: string;
  minConfidence: number;
};

type IdParams = { id: string };

export function createRunsController({
  db,
  pipeline,
  uploadDir,
  minConfidence,
}: RunsControllerDeps) {
  const create: RequestHandler = async (req, res) => {
    const file = req.file;
    if (!file) {
      res.status(400).json(apiError("INVALID_FILE", "Upload a document in the 'file' field."));
      return;
    }
    if (!SUPPORTED_MIME_TYPES[file.mimetype]) {
      res
        .status(400)
        .json(apiError("UNSUPPORTED_FILE_TYPE", "Supported types: PDF, PNG, JPEG, WEBP."));
      return;
    }
    if (file.buffer.length === 0) {
      res.status(400).json(apiError("INVALID_FILE", "The uploaded file is empty."));
      return;
    }
    if (file.mimetype === "application/pdf" && file.buffer.subarray(0, 5).toString() !== "%PDF-") {
      res.status(400).json(apiError("DOCUMENT_READ_ERROR", "The file is not a readable PDF."));
      return;
    }

    const created = await createRun(db, uploadDir, {
      buffer: file.buffer,
      filename: file.originalname,
      mimeType: file.mimetype,
    });
    pipeline.run(created.runId).catch((err) => req.log.error({ err }, "pipeline failed"));
    res.status(202).json(created);
  };

  const list: RequestHandler = (_req, res) => {
    res.json(listRuns(db));
  };

  const get: RequestHandler<IdParams> = (req, res) => {
    const run = getRun(db, req.params.id, minConfidence);
    if (!run) {
      res.status(404).json(apiError("RUN_NOT_FOUND", "Run not found."));
      return;
    }
    res.json(run);
  };

  const remove: RequestHandler<IdParams> = async (req, res) => {
    const result = await deleteRun(db, uploadDir, req.params.id);
    if (result.status === "not_found") {
      res.status(404).json(apiError("RUN_NOT_FOUND", "Run not found."));
      return;
    }
    if (result.status === "in_progress") {
      res
        .status(409)
        .json(
          apiError("RUN_IN_PROGRESS", "The run is still processing; try again when it finishes."),
        );
      return;
    }
    const { runId, documentId, fileDeleted } = result;
    res.json({ deleted: true, runId, documentId, fileDeleted });
  };

  const document: RequestHandler<IdParams> = async (req, res) => {
    const run = db.query.pipelineRuns
      .findFirst({ where: (r, { eq }) => eq(r.id, req.params.id) })
      .sync();
    const doc =
      run &&
      db.query.documents.findFirst({ where: (d, { eq }) => eq(d.id, run.documentId) }).sync();
    if (!doc) {
      res.status(404).json(apiError("RUN_NOT_FOUND", "Run not found."));
      return;
    }

    let content: Buffer;
    try {
      content = await readFile(doc.storagePath);
    } catch {
      res
        .status(404)
        .json(apiError("DOCUMENT_MISSING", "The stored document file no longer exists."));
      return;
    }
    res
      .type(doc.mimeType)
      .set("Content-Disposition", `inline; filename="${doc.originalFilename.replace(/"/g, "")}"`)
      .set("X-Content-Type-Options", "nosniff")
      .send(content);
  };

  return { create, list, get, remove, document };
}
