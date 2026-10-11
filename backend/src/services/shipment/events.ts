import { shipmentEvents, type NovaDb } from "../../db/index.js";
import { newId } from "../pipeline.service.js";

type Writer = Pick<NovaDb, "insert">;

export function recordEvent(
  db: Writer,
  shipmentId: string,
  type: string,
  message: string,
  data?: Record<string, unknown>,
) {
  db.insert(shipmentEvents)
    .values({
      id: newId("evt"),
      shipmentId,
      type,
      message,
      dataJson: data ? JSON.stringify(data) : null,
    })
    .run();
}
