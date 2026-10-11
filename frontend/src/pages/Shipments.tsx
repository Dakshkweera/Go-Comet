import "../styles/inbox.css";
import { EmptyState, ErrorState, LoadingRows } from "../components/EmptyState.js";
import { FilterChips } from "../components/FilterChips.js";
import { Icon } from "../components/Icon.js";
import { PageHeader } from "../components/PageHeader.js";
import { RefreshButton } from "../components/RefreshButton.js";
import { ShipmentsTable } from "../components/ShipmentsTable.js";
import { useShipments } from "../shipmentData.js";
import {
  applyFilter,
  filterCounts,
  matchesShipmentQuery,
  parseFilter,
  SHIPMENT_FILTERS,
} from "../shipmentDomain.js";
import { Link, setSearchParams, useSearchParams } from "../router.js";

export function ShipmentsPage() {
  const { shipments, details, loading, error, refresh } = useShipments();
  const params = useSearchParams();
  const filter = parseFilter(SHIPMENT_FILTERS, params.get("filter"));
  const q = params.get("q") ?? "";
  const all = shipments ?? [];
  const searched = q.trim() ? all.filter((s) => matchesShipmentQuery(s, q)) : all;
  const rows = applyFilter(searched, filter);

  return (
    <div className="page">
      <PageHeader
        title="Shipments"
        description="Every supplier shipment and where it stands. Open one to review it or reply to the supplier."
        actions={<RefreshButton />}
      />

      <section className="ib-main" aria-label="Shipments">
        <div className="ib-toolbar">
          <FilterChips
            filters={SHIPMENT_FILTERS}
            active={filter.key}
            counts={filterCounts(searched, SHIPMENT_FILTERS)}
            label="Filter shipments"
            onSelect={(key) => setSearchParams({ filter: key === "all" ? null : key })}
          />
          <div className="input-with-icon ib-search">
            <Icon name="search" size={15} />
            <input
              className="input"
              type="search"
              aria-label="Search shipments"
              value={q}
              onChange={(e) => setSearchParams({ q: e.target.value || null })}
              placeholder="Search reference, supplier, subject…"
            />
          </div>
        </div>

        <div className="panel">
          {error ? (
            <ErrorState message={`Could not load shipments: ${error}`} onRetry={refresh} />
          ) : loading ? (
            <LoadingRows rows={5} />
          ) : all.length === 0 ? (
            <EmptyState
              icon="inbox"
              title="No shipments yet"
              action={
                <Link to="/simulate" className="btn btn-secondary btn-sm">
                  Simulate a supplier email
                </Link>
              }
            >
              A shipment is created for every supplier email that arrives.
            </EmptyState>
          ) : rows.length === 0 ? (
            <EmptyState
              icon="filter"
              title="No shipments match"
              action={
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setSearchParams({ filter: null, q: null })}
                >
                  Show all shipments
                </button>
              }
            >
              Nothing matches the selected filter or search.
            </EmptyState>
          ) : (
            <ShipmentsTable shipments={rows} details={details} from="shipments" />
          )}
        </div>
      </section>
    </div>
  );
}
