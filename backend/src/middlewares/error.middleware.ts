import type { ErrorRequestHandler, RequestHandler } from "express";
import { MulterError } from "multer";
import { apiError } from "../utils/apiError.js";

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json(apiError("NOT_FOUND", `Route ${req.method} ${req.originalUrl} not found.`));
};

const CLIENT_ERROR_CODES: Record<string, string> = {
  "entity.parse.failed": "INVALID_JSON",
  "entity.too.large": "PAYLOAD_TOO_LARGE",
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json(apiError("FILE_TOO_LARGE", "The file exceeds the upload size limit."));
    } else {
      res.status(400).json(apiError("INVALID_FILE", "Upload one document in the 'file' field."));
    }
    return;
  }

  const status = typeof err?.status === "number" ? err.status : 500;
  if (status >= 400 && status < 500) {
    const code = CLIENT_ERROR_CODES[err.type as string] ?? "BAD_REQUEST";
    res.status(status).json(apiError(code, String(err.message ?? "Bad request.")));
    return;
  }

  req.log.error({ err }, "unhandled error");
  res.status(500).json(apiError("INTERNAL_ERROR", "An internal error occurred."));
};
