import { shipmentPath, shipmentStatusMeta, toneIcon, type BackKey } from "../shipmentDomain.js";
import type { ShipmentSummary } from "../types/api.js";
import { ActivityFeed } from "./ActivityList.js";

export function ShipmentFeed({ shipments, from }: { shipments: ShipmentSummary[]; from: BackKey }) {
  return (
    <ActivityFeed
      items={shipments.map((s) => {
        const status = shipmentStatusMeta(s.status);
        return {
          key: s.id,
          tone: status.tone,
          icon: toneIcon(status.tone),
          busy: s.status === "RECEIVED" || s.status === "PROCESSING",
          title: (
            <>
              <strong>{s.reference}</strong> {status.label}
            </>
          ),
          meta: `${s.supplier.name} · ${s.headline}`,
          at: s.updatedAt,
          to: shipmentPath(s.id, from),
        };
      })}
    />
  );
}
