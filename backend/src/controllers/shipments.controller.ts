import type { RequestHandler, Response } from "express";
import type { ZodType } from "zod";
import type { NovaDb } from "../db/index.js";
import {
  draftSendSchema,
  draftUpdateSchema,
  reviewRequestSchema,
  setDocTypeRequestSchema,
} from "../schemas/index.js";
import {
  deleteShipment,
  getShipmentView,
  listShipments,
  reviewIssue,
  saveDraft,
  sendDraft,
  setDocumentType,
  ShipmentError,
  type ShipmentErrorCode,
  type ShipmentService,
} from "../services/shipment/index.js";
import { apiError } from "../utils/apiError.js";

export type ShipmentsControllerDeps = {
  db: NovaDb;
  shipments: ShipmentService;
  cgMailbox: string;
  uploadDir: string;
  emailDir: string;
};

const STATUS: Record<ShipmentErrorCode, number> = {
  SHIPMENT_NOT_FOUND: 404,
  ISSUE_NOT_FOUND: 404,
  DOCUMENT_NOT_FOUND: 404,
  DRAFT_NOT_FOUND: 404,
  INVALID_ACTION: 400,
  VALUE_REQUIRED: 400,
  NOTE_REQUIRED: 400,
  SHIPMENT_PROCESSING: 409,
  REVIEW_INCOMPLETE: 409,
  DRAFT_OUTDATED: 409,
  ALREADY_SENT: 409,
};

type IdParams = { id: string };

export function createShipmentsController({
  db,
  shipments,
  cgMailbox,
  uploadDir,
  emailDir,
}: ShipmentsControllerDeps) {
  async function handle(res: Response, run: () => unknown) {
    try {
      const result = await run();
      if (result !== undefined) res.json(result);
    } catch (err) {
      if (!(err instanceof ShipmentError)) throw err;
      res.status(STATUS[err.code]).json(apiError(err.code, err.message));
    }
  }

  function parse<T>(schema: ZodType<T>, body: unknown, res: Response): T | null {
    const parsed = schema.safeParse(body);
    if (parsed.success) return parsed.data;
    const issue = parsed.error.issues[0];
    res
      .status(400)
      .json(apiError("INVALID_REQUEST", `${issue?.path.join(".") || "body"}: ${issue?.message}`));
    return null;
  }

  const view = (id: string) => {
    const shipment = getShipmentView(db, id);
    if (!shipment) throw new ShipmentError("SHIPMENT_NOT_FOUND", "Shipment not found.");
    return shipment;
  };

  const list: RequestHandler = (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const customerId = typeof req.query.customerId === "string" ? req.query.customerId : undefined;
    res.json(listShipments(db, { status, customerId }));
  };

  const get: RequestHandler<IdParams> = (req, res) => handle(res, () => view(req.params.id));

  const review: RequestHandler<IdParams> = (req, res) => {
    const body = parse(reviewRequestSchema, req.body, res);
    if (!body) return;
    return handle(res, () => {
      reviewIssue(db, shipments, req.params.id, body);
      return view(req.params.id);
    });
  };

  const setType: RequestHandler<IdParams & { documentId: string }> = (req, res) => {
    const body = parse(setDocTypeRequestSchema, req.body, res);
    if (!body) return;
    return handle(res, () => {
      setDocumentType(db, shipments, req.params.id, req.params.documentId, body);
      return view(req.params.id);
    });
  };

  const updateDraft: RequestHandler<IdParams> = (req, res) => {
    const body = parse(draftUpdateSchema, req.body, res);
    if (!body) return;
    return handle(res, () => {
      saveDraft(db, req.params.id, body);
      return view(req.params.id).draft;
    });
  };

  const send: RequestHandler<IdParams> = (req, res) => {
    const body = parse(draftSendSchema, req.body, res);
    if (body) return handle(res, () => sendDraft(db, cgMailbox, req.params.id, body.version));
  };

  const remove: RequestHandler<IdParams> = (req, res) =>
    handle(res, () => deleteShipment(db, { uploadDir, emailDir }, req.params.id));

  return { list, get, review, setType, updateDraft, send, remove };
}
