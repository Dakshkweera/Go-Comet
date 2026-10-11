export type ShipmentErrorCode =
  | "SHIPMENT_NOT_FOUND"
  | "ISSUE_NOT_FOUND"
  | "DOCUMENT_NOT_FOUND"
  | "DRAFT_NOT_FOUND"
  | "INVALID_ACTION"
  | "VALUE_REQUIRED"
  | "NOTE_REQUIRED"
  | "SHIPMENT_PROCESSING"
  | "REVIEW_INCOMPLETE"
  | "DRAFT_OUTDATED"
  | "ALREADY_SENT";

export class ShipmentError extends Error {
  constructor(
    readonly code: ShipmentErrorCode,
    message: string,
  ) {
    super(message);
  }
}
