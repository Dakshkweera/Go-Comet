import {
  isProcessing,
  primaryAction,
  progressPercent,
  progressText,
  stageLabel,
} from "../shipmentDomain.js";
import { navigate } from "../router.js";
import type { ShipmentView } from "../types/api.js";
import { BackLink, useBackTarget } from "./BackLink.js";
import { DeleteShipmentAction } from "./DeleteShipmentAction.js";
import { Icon } from "./Icon.js";
import { ProgressBar } from "./ProgressBar.js";
import { Badge, ShipmentStatusBadge } from "./StatusBadge.js";

export function ShipmentHeader({
  view,
  onReview,
  onSend,
}: {
  view: ShipmentView;
  onReview: () => void;
  onSend: () => void;
}) {
  const action = primaryAction(view);
  const processing = isProcessing(view.status);
  const back = useBackTarget();

  return (
    <header className="sd-header">
      <BackLink />

      <div className="sd-header-top">
        <div className="sd-header-id">
          <h1 className="sd-ref">{view.reference}</h1>
          <ShipmentStatusBadge status={view.status} size="lg" />
          <Badge tone="neutral" icon={null}>
            {stageLabel(view.stage)}
          </Badge>
          {view.cycle > 1 && (
            <Badge tone="info" icon={null}>
              Cycle {view.cycle}
            </Badge>
          )}
        </div>

        <div className="sd-header-actions">
          <DeleteShipmentAction shipment={view} onDeleted={() => navigate(back.to)} />
          {action?.kind === "review" && (
            <button type="button" className="btn btn-primary" onClick={onReview}>
              {action.label}
              <Icon name="chevronDown" size={15} />
            </button>
          )}
          {action?.kind === "send" && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={onSend}
              disabled={!view.draft?.canSend}
              title={view.draft?.sendBlockedReason ?? undefined}
            >
              <Icon name="send" size={15} />
              {action.label}
            </button>
          )}
          {action?.kind === "status" && (
            <span className="sd-action-status">
              <Icon name={action.label === "Done" ? "checkCircle" : "clock"} size={15} />
              {action.label}
            </span>
          )}
        </div>
      </div>

      <p className="sd-meta">
        <span>
          <span className="text-muted">Supplier</span> {view.supplier.name}
        </span>
        <span>
          <span className="text-muted">Customer</span>{" "}
          {view.customer ? (
            view.customer.name
          ) : (
            <span className="text-warning">Not identified</span>
          )}
        </span>
        <span className="sd-meta-subject">
          <span className="text-muted">Subject</span> {view.subject}
        </span>
      </p>

      <p className="sd-headline">{view.headline}</p>

      {processing && (
        <div className="sd-progress" role="status">
          <ProgressBar percent={progressPercent(view.progress)} label="Attachments read" />
          <span>{progressText(view.progress)}. This page updates automatically.</span>
        </div>
      )}

      {view.reasoning && (
        <details className="sd-why">
          <summary>
            <Icon name="chevronRight" size={14} />
            Why?
          </summary>
          <p>{view.reasoning}</p>
        </details>
      )}
    </header>
  );
}
