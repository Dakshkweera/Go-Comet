import type { RequestHandler } from "express";
import { EmailParseError, type Inbox } from "../services/inbox/index.js";
import { apiError } from "../utils/apiError.js";

export function createInboxController(inbox: Inbox) {
  const samples: RequestHandler = async (_req, res) => {
    res.json(await inbox.listSamples());
  };

  const deliver: RequestHandler<{ name: string }> = async (req, res) => {
    const delivered = await inbox.deliverSample(req.params.name);
    if (!delivered) {
      res.status(404).json(apiError("SAMPLE_NOT_FOUND", "Sample email not found."));
      return;
    }
    res.status(202).json(delivered);
  };

  const upload: RequestHandler = async (req, res) => {
    if (!req.file || req.file.buffer.length === 0) {
      res.status(400).json(apiError("INVALID_FILE", "Upload an .eml file in the 'file' field."));
      return;
    }
    try {
      res.status(202).json(await inbox.ingest(req.file.buffer));
    } catch (err) {
      if (err instanceof EmailParseError) {
        res.status(400).json(apiError(err.code, err.message));
        return;
      }
      throw err;
    }
  };

  return { samples, deliver, upload };
}
