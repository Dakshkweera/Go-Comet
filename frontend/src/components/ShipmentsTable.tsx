import "../styles/inbox.css";
import { formatDateTime, timeAgo } from "../domain.js";
import {
  isProcessing,
  progressPercent,
  progressText,
  shipmentPath,
  type BackKey,
} from "../shipmentDomain.js";
import { Link, navigate } from "../router.js";
import type { ShipmentSummary, ShipmentView } from "../types/api.js";
import { DeleteShipmentAction } from "./DeleteShipmentAction.js";
import { Icon } from "./Icon.js";
import { ProgressBar } from "./ProgressBar.js";
import { ShipmentStatusBadge } from "./StatusBadge.js";

function ShipmentRow({
  shipment,
  detail,
  from,
}: {
  shipment: ShipmentSummary;
  detail?: ShipmentView;
  from: BackKey;
}) {
  const path = shipmentPath(shipment.id, from);
  const progress = detail && isProcessing(shipment.status) ? detail.progress : null;

  return (
    <tr className="is-clickable" onClick={() => navigate(path)}>
      <td>
        <span className="cell-stack">
          <Link to={path} className="cell-primary mono" onClick={(e) => e.stopPropagation()}>
            {shipment.reference}
          </Link>
          {shipment.cycle > 1 && <span className="cell-secondary">Cycle {shipment.cycle}</span>}
        </span>
      </td>
      <td className="ib-subject">
        <span className="cell-stack">
          <span className="cell-primary ib-wrap">{shipment.supplier.name}</span>
          <span className="cell-secondary ib-wrap">{shipment.subject}</span>
        </span>
      </td>
      <td className="ib-files">
        <span className="ib-count">
          <Icon name="paperclip" size={13} className="text-faint" />
          {shipment.attachments}
        </span>
      </td>
      <td className="text-muted nowrap" title={`Received ${formatDateTime(shipment.receivedAt)}`}>
        {timeAgo(shipment.updatedAt)}
      </td>
      <td className="ib-status">
        <span className="cell-stack">
          <span>
            <ShipmentStatusBadge status={shipment.status} size="sm" />
          </span>
          <span className="cell-secondary ib-wrap">{shipment.headline}</span>
          {progress && (
            <span className="ib-progress">
              <ProgressBar percent={progressPercent(progress)} label="Attachments read" />
              <span className="cell-secondary">{progressText(progress)}</span>
            </span>
          )}
        </span>
      </td>
      <td className="ib-actions" onClick={(e) => e.stopPropagation()}>
        <DeleteShipmentAction shipment={shipment} iconOnly />
      </td>
    </tr>
  );
}

export function ShipmentsTable({
  shipments,
  details,
  from,
}: {
  shipments: ShipmentSummary[];
  details: ReadonlyMap<string, ShipmentView>;
  from: BackKey;
}) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Shipment</th>
            <th>Supplier</th>
            <th>Files</th>
            <th>Updated</th>
            <th>Status</th>
            <th>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {shipments.map((s) => (
            <ShipmentRow key={s.id} shipment={s} detail={details.get(s.id)} from={from} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
