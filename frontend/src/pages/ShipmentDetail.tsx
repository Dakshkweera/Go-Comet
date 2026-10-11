import "../styles/shipment.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { DraftPanel, type DraftPanelHandle } from "../components/DraftPanel.js";
import { BackLink } from "../components/BackLink.js";
import { EmailsPanel } from "../components/EmailsPanel.js";
import { EmptyState, ErrorState } from "../components/EmptyState.js";
import { jumpTo } from "../components/ExtractionGrid.js";
import { ReviewPanel } from "../components/ReviewPanel.js";
import { ShipmentDrawer, type DrawerPanel } from "../components/ShipmentDrawer.js";
import { ShipmentHeader } from "../components/ShipmentHeader.js";
import { ShipmentTimeline } from "../components/ShipmentTimeline.js";
import { VerificationGrid } from "../components/VerificationGrid.js";
import { useShipment } from "../shipmentData.js";
import { Link } from "../router.js";
import type { ExtractionField, ShipmentView } from "../types/api.js";

function Workspace({ view, reload }: { view: ShipmentView; reload: () => Promise<void> }) {
  const [panel, setPanel] = useState<DrawerPanel | null>(null);
  const draftRef = useRef<DraftPanelHandle>(null);

  const active =
    panel &&
    (panel.kind === "field"
      ? view.fields.some((f) => f.field === panel.field)
      : view.documents.some((d) => d.id === panel.documentId))
      ? panel
      : null;

  useEffect(() => {
    document.title = `${view.reference} · Nova`;
  }, [view.reference]);

  useEffect(() => {
    document.body.classList.toggle("doc-drawer-open", active !== null);
  }, [active]);

  useEffect(() => () => document.body.classList.remove("doc-drawer-open"), []);

  const openField = useCallback((field: ExtractionField) => setPanel({ kind: "field", field }), []);
  const openDocument = useCallback(
    (documentId: string, from: ExtractionField | null = null) =>
      setPanel({ kind: "document", documentId, from }),
    [],
  );
  const close = useCallback(() => setPanel(null), []);
  const toReview = useCallback(() => jumpTo("sd-review"), []);

  return (
    <div className="page sd-page">
      <ShipmentHeader
        view={view}
        onReview={toReview}
        onSend={() => draftRef.current?.requestSend()}
      />
      <EmailsPanel view={view} onOpenDocument={(id) => openDocument(id)} />
      <VerificationGrid view={view} onOpenField={openField} />
      <ReviewPanel view={view} onOpenField={openField} onOpenDocument={(id) => openDocument(id)} />
      <DraftPanel ref={draftRef} view={view} reload={reload} onReviewIncomplete={toReview} />
      <ShipmentTimeline events={view.events} />
      {active && (
        <ShipmentDrawer
          view={view}
          panel={active}
          onClose={close}
          onOpenField={openField}
          onOpenDocument={openDocument}
        />
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="page sd-page" aria-busy="true">
      <span className="sr-only" role="status">
        Loading shipment…
      </span>
      <BackLink />
      <div className="skeleton sd-skel-title" />
      <div className="skeleton sd-skel-line" />
      <div className="panel">
        <div className="skeleton sd-skel-block" />
      </div>
    </div>
  );
}

export function ShipmentDetailPage({ id }: { id: string }) {
  const { view, error, reload } = useShipment(id);

  if (view) return <Workspace view={view} reload={reload} />;

  if (error?.notFound) {
    return (
      <div className="page sd-page">
        <BackLink />
        <div className="panel">
          <EmptyState
            icon="shipments"
            title="Shipment not found"
            action={
              <Link to="/shipments" className="btn btn-secondary btn-sm">
                Go to Shipments
              </Link>
            }
          >
            This shipment does not exist. Check the link or open it from the Shipments page.
          </EmptyState>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page sd-page">
        <BackLink />
        <div className="panel">
          <ErrorState message={error.message} onRetry={() => void reload()} />
        </div>
      </div>
    );
  }

  return <Skeleton />;
}
