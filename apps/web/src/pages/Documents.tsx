import { useMemo } from "react";
import { EmptyState, ErrorState, LoadingRows } from "../components/EmptyState.js";
import { Icon } from "../components/Icon.js";
import { PageHeader } from "../components/PageHeader.js";
import { ShipmentTable } from "../components/ShipmentTable.js";
import { refreshRuns, RUN_LIST_LIMIT, useRuns } from "../data.js";
import { DECISIONS, isFinal, plural, type RunRecord } from "../domain.js";
import { Link, setSearchParams, useSearchParams } from "../router.js";
import "../styles/documents.css";

type Option = { value: string; label: string };

const UNRESOLVED = "unresolved";
const DAY_MS = 86_400_000;

const STATUS_OPTIONS: Option[] = [
  { value: "processing", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
];

const DECISION_OPTIONS: Option[] = Object.entries(DECISIONS).map(([value, meta]) => ({
  value,
  label: meta.label,
}));

const DATE_OPTIONS: Option[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
];

const CLEARED = { q: null, status: null, decision: null, customer: null, date: null };

const pick = (value: string | null | undefined, options: Option[]) =>
  options.some((o) => o.value === value) ? value! : "";

const isUnresolved = (run: RunRecord) =>
  run.customerStatus === "not_found" || run.customerStatus === "ambiguous";

function startOf(date: string): number {
  if (date === "today") return new Date().setHours(0, 0, 0, 0);
  return Date.now() - (date === "7d" ? 7 : 30) * DAY_MS;
}

function matchesStatus(run: RunRecord, status: string) {
  return status === "processing" ? !isFinal(run.status) : run.status.toLowerCase() === status;
}

const searchText = (run: RunRecord) =>
  [run.filename, run.customer, run.consignee, run.invoice, run.origin, run.destination, run.id]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

function FilterSelect({
  label,
  allLabel,
  value,
  options,
  param,
}: {
  label: string;
  allLabel: string;
  value: string;
  options: Option[];
  param: string;
}) {
  return (
    <select
      className={value ? "select docs-filter is-active" : "select docs-filter"}
      aria-label={label}
      value={value}
      onChange={(e) => setSearchParams({ [param]: e.target.value || null })}
    >
      <option value="">{allLabel}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function DocumentsPage() {
  const { runs, error, truncated } = useRuns();
  const params = useSearchParams();
  const q = params.get("q") ?? "";
  const status = pick(params.get("status")?.toLowerCase(), STATUS_OPTIONS);
  const decision = pick(params.get("decision"), DECISION_OPTIONS);
  const date = pick(params.get("date"), DATE_OPTIONS);
  const customer = params.get("customer") ?? "";
  const filtered = Boolean(q.trim() || status || decision || date || customer);

  const customerOptions = useMemo<Option[]>(() => {
    const names = new Set<string>();
    for (const run of runs ?? []) if (run.customer) names.add(run.customer);
    if (customer && customer !== UNRESOLVED) names.add(customer);
    return [
      ...[...names]
        .sort((a, b) => a.localeCompare(b))
        .map((name) => ({ value: name, label: name })),
      { value: UNRESOLVED, label: "Unresolved" },
    ];
  }, [runs, customer]);

  const results = useMemo(() => {
    if (!runs) return [];
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const since = date ? startOf(date) : null;
    return runs
      .filter(
        (run) =>
          (!status || matchesStatus(run, status)) &&
          (!decision || run.decision === decision) &&
          (!customer ||
            (customer === UNRESOLVED ? isUnresolved(run) : run.customer === customer)) &&
          (since === null || Date.parse(run.createdAt) >= since) &&
          (terms.length === 0 || terms.every((t) => searchText(run).includes(t))),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [runs, q, status, decision, customer, date]);

  const clearFilters = () => setSearchParams(CLEARED);

  return (
    <div className="page">
      <PageHeader
        title="Documents"
        description="Review processed trade documents and pipeline decisions."
        actions={
          <Link to="/" className="btn btn-primary">
            <Icon name="upload" size={15} />
            Upload document
          </Link>
        }
      />

      {error ? (
        <div className="panel">
          <ErrorState message={error} onRetry={() => void refreshRuns()} />
        </div>
      ) : runs?.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon="documents"
            title="No documents processed yet."
            action={
              <Link to="/" className="btn btn-primary btn-sm">
                <Icon name="upload" size={14} />
                Upload document
              </Link>
            }
          >
            Upload a trade document to start your first pipeline run.
          </EmptyState>
        </div>
      ) : (
        <section className="section" aria-label="Document list">
          <div className="filter-bar">
            <div className="input-with-icon docs-search">
              <Icon name="search" size={15} />
              <input
                className="input"
                type="search"
                aria-label="Search documents"
                value={q}
                onChange={(e) => setSearchParams({ q: e.target.value })}
                placeholder="Search file, customer, invoice, port…"
              />
              {q && (
                <button
                  type="button"
                  className="docs-clear-search"
                  aria-label="Clear search"
                  onClick={() => setSearchParams({ q: null })}
                >
                  <Icon name="x" size={14} />
                </button>
              )}
            </div>
            <FilterSelect
              label="Status"
              allLabel="All statuses"
              value={status}
              options={STATUS_OPTIONS}
              param="status"
            />
            <FilterSelect
              label="Decision"
              allLabel="All decisions"
              value={decision}
              options={DECISION_OPTIONS}
              param="decision"
            />
            <FilterSelect
              label="Customer"
              allLabel="All customers"
              value={customer}
              options={customerOptions}
              param="customer"
            />
            <FilterSelect
              label="Date"
              allLabel="Any time"
              value={date}
              options={DATE_OPTIONS}
              param="date"
            />
          </div>

          {runs && (
            <div className="docs-meta">
              <div className="docs-count">
                <p role="status">
                  {filtered ? (
                    <>
                      <strong>{results.length}</strong> of {plural(runs.length, "document")}
                    </>
                  ) : (
                    <strong>{plural(runs.length, "document")}</strong>
                  )}
                </p>
                {filtered && (
                  <button type="button" className="link-button" onClick={clearFilters}>
                    Clear filters
                  </button>
                )}
              </div>
              {truncated && (
                <p className="docs-note">
                  <Icon name="info" size={13} />
                  Only the latest {RUN_LIST_LIMIT} runs are listed.
                </p>
              )}
            </div>
          )}

          <div className="panel docs-results">
            {runs ? (
              <ShipmentTable
                runs={results}
                empty={
                  <EmptyState
                    icon="search"
                    title={
                      q.trim()
                        ? `No documents match “${q.trim()}”`
                        : "No documents match these filters"
                    }
                    action={
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={clearFilters}
                      >
                        Clear filters
                      </button>
                    }
                  >
                    Try a different search term or widen the filters.
                  </EmptyState>
                }
              />
            ) : (
              <LoadingRows rows={6} />
            )}
          </div>
        </section>
      )}
    </div>
  );
}
