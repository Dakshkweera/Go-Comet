import "../styles/processing.css";
import { timeAgo } from "../domain.js";
import {
  documentTypeLabel,
  fileProgressMeta,
  latestCycleDocuments,
  latestEvent,
  processingSteps,
  progressPercent,
  shipmentPath,
} from "../shipmentDomain.js";
import { Link } from "../router.js";
import type { ShipmentSummary, ShipmentView } from "../types/api.js";
import { LoadingRows } from "./EmptyState.js";
import { Icon } from "./Icon.js";
import { StepList } from "./ProcessingStepper.js";
import { ProgressBar } from "./ProgressBar.js";
import { Badge, ShipmentStatusBadge } from "./StatusBadge.js";

export function ProcessingCard({
  shipment,
  view,
}: {
  shipment: ShipmentSummary;
  view: ShipmentView | undefined;
}) {
  const path = shipmentPath(shipment.id, "processing");
  const latest = view ? latestEvent(view) : null;

  return (
    <article className="panel pr-card" aria-label={`${shipment.reference}, being processed`}>
      <header className="pr-head">
        <div className="pr-id">
          <Link to={path} className="pr-ref mono">
            {shipment.reference}
          </Link>
          <ShipmentStatusBadge status={shipment.status} size="sm" />
          {shipment.cycle > 1 && (
            <Badge tone="info" icon={null} size="sm">
              Reply
            </Badge>
          )}
        </div>
        <Link to={path} className="btn btn-secondary btn-sm">
          Open shipment
          <Icon name="arrowRight" size={14} />
        </Link>
      </header>

      <p className="pr-subject">
        <strong>{shipment.supplier.name}</strong>
        <span className="text-muted"> · {shipment.subject}</span>
      </p>
      <p className="pr-received text-muted">
        Received {timeAgo(view?.emails.at(-1)?.receivedAt ?? shipment.receivedAt)}
      </p>

      {!view ? (
        <LoadingRows rows={2} />
      ) : (
        <>
          <ProgressBar percent={progressPercent(view.progress)} label="Attachments read" />
          <div className="pr-body">
            <section aria-label="Steps">
              <h3 className="pr-label">Where it is now</h3>
              <StepList steps={processingSteps(view)} />
              {latest && <p className="pr-latest">Latest: {latest.message}</p>}
            </section>
            <section aria-label="Files">
              <h3 className="pr-label">Files in this email</h3>
              <ul className="pr-files">
                {latestCycleDocuments(view).map((doc) => {
                  const meta = fileProgressMeta(doc.status);
                  return (
                    <li key={doc.id} className="pr-file">
                      <Icon name="file" size={14} className="text-faint" />
                      <span className="pr-file-main">
                        <span className="pr-file-name">{doc.filename}</span>
                        {doc.status === "extracted" && (
                          <span className="text-muted">{documentTypeLabel(doc)}</span>
                        )}
                      </span>
                      <Badge tone={meta.tone} size="sm" icon={null}>
                        {doc.status === "processing" && (
                          <span className="spinner dd-badge-spinner" aria-hidden="true" />
                        )}
                        {meta.label}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            </section>
          </div>
        </>
      )}
    </article>
  );
}
