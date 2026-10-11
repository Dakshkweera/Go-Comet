import "../styles/processing.css";
import { EmptyState, ErrorState, LoadingRows } from "../components/EmptyState.js";
import { PageHeader, SectionHeader } from "../components/PageHeader.js";
import { ProcessingCard } from "../components/ProcessingCard.js";
import { RefreshButton } from "../components/RefreshButton.js";
import { ShipmentFeed } from "../components/ShipmentFeed.js";
import { useShipments } from "../shipmentData.js";
import { finishedShipments, processingShipments } from "../shipmentDomain.js";
import { Link } from "../router.js";

export function ProcessingPage() {
  const { shipments, details, loading, error, refresh } = useShipments();
  const active = processingShipments(shipments ?? []);
  const finished = finishedShipments(shipments ?? [], 5);

  return (
    <div className="page">
      <PageHeader
        title="Processing"
        description="Emails Nova is reading right now, and the step each one is on. This page updates by itself while anything is processing."
        actions={<RefreshButton />}
      />

      {error ? (
        <div className="panel">
          <ErrorState message={`Could not load shipments: ${error}`} onRetry={refresh} />
        </div>
      ) : loading ? (
        <div className="panel">
          <LoadingRows rows={4} />
        </div>
      ) : active.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon="checkCircle"
            title="Nothing is being processed"
            action={
              <Link to="/simulate" className="btn btn-secondary btn-sm">
                Simulate a supplier email
              </Link>
            }
          >
            New emails are picked up within a couple of seconds of arriving. Use Refresh to check
            again.
          </EmptyState>
        </div>
      ) : (
        <div className="pr-list">
          {active.map((s) => (
            <ProcessingCard key={s.id} shipment={s} view={details.get(s.id)} />
          ))}
        </div>
      )}

      {finished.length > 0 && (
        <section className="section" aria-labelledby="pr-done-title">
          <SectionHeader
            id="pr-done-title"
            title="Just finished"
            subtitle="Where the latest emails ended up"
            actions={
              <Link to="/shipments" className="link-button">
                All shipments
              </Link>
            }
          />
          <div className="panel">
            <ShipmentFeed shipments={finished} from="processing" />
          </div>
        </section>
      )}
    </div>
  );
}
