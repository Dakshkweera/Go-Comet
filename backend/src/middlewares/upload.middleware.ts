import multer from "multer";

export const createUploadMiddleware = (maxBytes: number) =>
  multer({ storage: multer.memoryStorage(), limits: { fileSize: maxBytes, files: 1 } }).single(
    "file",
  );
