import "../styles/exceptions.css";
import { DocumentExceptions } from "../components/DocumentExceptions.js";
import { EmptyState, ErrorState, LoadingRows } from "../components/EmptyState.js";
import { FilterChips } from "../components/FilterChips.js";
import { PageHeader } from "../components/PageHeader.js";
import { RefreshButton } from "../components/RefreshButton.js";
import { ShipmentsTable } from "../components/ShipmentsTable.js";
import { useRuns } from "../data.js";
import { useShipments } from "../shipmentData.js";
import {
  applyFilter,
  EXCEPTION_FILTERS,
  exceptionCount,
  filterCounts,
  longestWaitingFirst,
  parseFilter,
} from "../shipmentDomain.js";
import { Link, setSearchParams, useSearchParams } from "../router.js";

function ShipmentExceptions() {
  const { shipments, details, loading, error, refresh } = useShipments();
  const filter = parseFilter(EXCEPTION_FILTERS, useSearchParams().get("filter"));
  const all = shipments ?? [];
  const rows = longestWaitingFirst(applyFilter(all, filter));

  return (
    <section className="section" aria-label="Shipment exceptions">
      <FilterChips
        filters={EXCEPTION_FILTERS}
        active={filter.key}
        counts={filterCounts(all, EXCEPTION_FILTERS)}
        label="Filter exceptions"
        onSelect={(key) => setSearchParams({ filter: key === "all" ? null : key })}
      />
      <p className="exc-hint">{filter.hint} Longest waiting first.</p>

      <div className="panel">
        {error ? (
          <ErrorState message={`Could not load shipments: ${error}`} onRetry={refresh} />
        ) : loading ? (
          <LoadingRows rows={4} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="checkCircle"
            title="No exceptions"
            action={
              <Link to="/shipments" className="btn btn-secondary btn-sm">
                View all shipments
              </Link>
            }
          >
            {all.length === 0
              ? "Exceptions appear here when an email needs a decision from you."
              : "Nothing needs a decision right now. Shipments that are ready to approve are on the Shipments page."}
          </EmptyState>
        ) : (
          <ShipmentsTable shipments={rows} details={details} from="exceptions" />
        )}
      </div>
    </section>
  );
}

export function ExceptionsPage() {
  const documents = useSearchParams().get("view") === "documents";
  const { shipments } = useShipments();
  const { runs } = useRuns();
  const documentCount = runs?.filter(
    (r) => r.decision === "human_review" || r.decision === "amendment_request",
  ).length;

  return (
    <div className="page">
      <PageHeader
        title="Exceptions"
        description="Where a person has to step in: a decision to make, or a reply to send to the supplier."
        actions={documents ? undefined : <RefreshButton />}
      />

      <nav className="tabs" aria-label="Exception source">
        <Link
          to="/exceptions"
          className={documents ? "tab" : "tab is-active"}
          aria-current={documents ? undefined : "page"}
        >
          Shipments
          {shipments && <span className="tab-count">{exceptionCount(shipments)}</span>}
        </Link>
        <Link
          to="/exceptions?view=documents"
          className={documents ? "tab is-active" : "tab"}
          aria-current={documents ? "page" : undefined}
        >
          Standalone documents
          {documentCount !== undefined && <span className="tab-count">{documentCount}</span>}
        </Link>
      </nav>

      {documents ? <DocumentExceptions /> : <ShipmentExceptions />}
    </div>
  );
}
