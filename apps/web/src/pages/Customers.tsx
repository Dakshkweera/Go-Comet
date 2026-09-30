import "../styles/config.css";
import { useMemo, type ReactNode } from "react";
import { EmptyState, ErrorState, LoadingRows } from "../components/EmptyState.js";
import { Icon } from "../components/Icon.js";
import { PageHeader, SectionHeader } from "../components/PageHeader.js";
import { Badge, DecisionBadge } from "../components/StatusBadge.js";
import { refreshRuns, RUN_LIST_LIMIT, useRuns } from "../data.js";
import {
  decisionSegments,
  deriveCustomers,
  deriveUnresolved,
  type DerivedCustomer,
  type Segment,
  type UnresolvedRun,
} from "../derived.js";
import { DECISIONS, formatDateTime, plural, timeAgo } from "../domain.js";
import { Link } from "../router.js";

const rulesHref = (customer: string) => `/rules?customer=${encodeURIComponent(customer)}`;

export function DerivedNotice({
  truncated,
  children,
}: {
  truncated: boolean;
  children: ReactNode;
}) {
  return (
    <div className="callout cfg-notice" role="note">
      <Icon name="lock" size={16} />
      <div>
        <strong>Derived from processed documents · read-only.</strong> {children}
        {truncated && ` Figures cover the latest ${RUN_LIST_LIMIT} runs only.`}
      </div>
    </div>
  );
}

export function Breakdown({ segments }: { segments: Segment[] }) {
  return (
    <div className="cfg-breakdown">
      <span className="cfg-bar" aria-hidden="true">
        {segments.map(
          (s) =>
            s.count > 0 && (
              <span key={s.key} className={`tone-${s.tone}`} style={{ flexGrow: s.count }} />
            ),
        )}
      </span>
      <span className="cfg-counts">
        {segments.map((s) => (
          <span
            key={s.key}
            className={`cfg-count tone-${s.tone}${s.count > 0 ? "" : " is-zero"}`}
            title={`${s.label}: ${s.count}`}
          >
            <span className="dot" />
            {s.count}
            <span className="sr-only"> {s.label.toLowerCase()}</span>
          </span>
        ))}
      </span>
    </div>
  );
}

export function Legend({ segments }: { segments: Pick<Segment, "key" | "label" | "tone">[] }) {
  return (
    <div className="cfg-legend" aria-hidden="true">
      {segments.map((s) => (
        <span key={s.key} className={`cfg-legend-item tone-${s.tone}`}>
          <span className="dot" />
          {s.label}
        </span>
      ))}
    </div>
  );
}

const DECISION_LEGEND = Object.entries(DECISIONS).map(([key, meta]) => ({ key, ...meta }));

function CustomerTable({ customers }: { customers: DerivedCustomer[] }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Customer</th>
            <th className="num">Documents</th>
            <th>Decisions</th>
            <th className="num">Active rules</th>
            <th>Last document</th>
            <th className="col-action">
              <span className="sr-only">Rules</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {customers.map((c) => (
            <tr key={c.name}>
              <td>
                <span className="cfg-name">
                  <Icon name="customers" size={16} className="text-faint" />
                  <span className="cfg-wrap">{c.name}</span>
                </span>
              </td>
              <td className="num">
                <Link
                  to={`/documents?customer=${encodeURIComponent(c.name)}`}
                  title={`View documents for ${c.name}`}
                >
                  {c.runs.length}
                </Link>
              </td>
              <td>
                <Breakdown segments={decisionSegments(c.decisions)} />
              </td>
              <td className="num">
                {c.activeRules > 0 ? (
                  c.activeRules
                ) : (
                  <span
                    className="text-warning"
                    title="No active rules were returned; documents cannot be validated automatically."
                  >
                    None
                  </span>
                )}
              </td>
              <td>
                <span className="cell-stack">
                  <Link to={`/documents/${c.latest.id}`} className="cell-primary">
                    {c.latest.filename}
                  </Link>
                  <span className="cell-secondary" title={formatDateTime(c.latest.createdAt)}>
                    {timeAgo(c.latest.createdAt)}
                  </span>
                </span>
              </td>
              <td className="col-action">
                <Link to={rulesHref(c.name)} className="row-action">
                  View rules
                  <Icon name="arrowRight" size={14} />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UnresolvedTable({ items }: { items: UnresolvedRun[] }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Consignee</th>
            <th>Resolution</th>
            <th>Reason</th>
            <th>Document</th>
            <th>Decision</th>
          </tr>
        </thead>
        <tbody>
          {items.map(({ run, status, consignee, reason }) => (
            <tr key={run.id}>
              <td>
                {consignee ? (
                  <span className="cfg-name cfg-wrap">{consignee}</span>
                ) : (
                  <span className="text-faint">Not extracted</span>
                )}
              </td>
              <td>
                <Badge tone="warning" size="sm" icon={null}>
                  {status === "ambiguous" ? "Ambiguous" : "Not found"}
                </Badge>
              </td>
              <td>
                <span className="cfg-reason">{reason ?? "No reason recorded."}</span>
              </td>
              <td>
                <span className="cell-stack">
                  <Link to={`/documents/${run.id}`} className="cell-primary">
                    {run.filename}
                  </Link>
                  <span className="cell-secondary" title={formatDateTime(run.createdAt)}>
                    {timeAgo(run.createdAt)}
                  </span>
                </span>
              </td>
              <td>
                <DecisionBadge decision={run.decision} size="sm" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CustomersPage() {
  const { runs, loading, error, truncated } = useRuns();
  const customers = useMemo(() => (runs ? deriveCustomers(runs) : []), [runs]);
  const unresolved = useMemo(() => (runs ? deriveUnresolved(runs) : []), [runs]);
  const resolvedDocs = customers.reduce((sum, c) => sum + c.runs.length, 0);

  let body: ReactNode;
  if (loading) {
    body = (
      <div className="panel">
        <LoadingRows rows={4} />
      </div>
    );
  } else if (error || !runs) {
    body = (
      <div className="panel">
        <ErrorState
          message={error ?? "Processed documents could not be loaded."}
          onRetry={() => void refreshRuns()}
        />
      </div>
    );
  } else if (runs.length === 0) {
    body = (
      <div className="panel">
        <EmptyState
          icon="customers"
          title="No customers yet"
          action={
            <Link to="/" className="btn btn-primary btn-sm">
              <Icon name="upload" size={14} />
              Upload document
            </Link>
          }
        >
          Customers appear once a processed trade document resolves to a configured customer.
        </EmptyState>
      </div>
    );
  } else {
    body = (
      <>
        <section className="section" aria-labelledby="cfg-customers-title">
          <SectionHeader
            id="cfg-customers-title"
            title="Resolved customers"
            subtitle={`${plural(customers.length, "customer")} · ${plural(resolvedDocs, "document")} resolved`}
            actions={customers.length > 0 && <Legend segments={DECISION_LEGEND} />}
          />
          <div className="panel">
            {customers.length > 0 ? (
              <CustomerTable customers={customers} />
            ) : (
              <EmptyState compact icon="customers" title="No customers resolved yet">
                No processed document has been matched to a configured customer so far.
              </EmptyState>
            )}
          </div>
        </section>

        <section className="section" aria-labelledby="cfg-unresolved-title">
          <SectionHeader
            id="cfg-unresolved-title"
            title="Unresolved consignees"
            subtitle="Consignees that matched no configured customer, or more than one. These documents are routed to human review."
          />
          <div className="panel">
            {unresolved.length > 0 ? (
              <UnresolvedTable items={unresolved} />
            ) : (
              <EmptyState compact icon="checkCircle" title="No unresolved consignees">
                No processed document has an unmatched or ambiguous consignee.
              </EmptyState>
            )}
          </div>
        </section>
      </>
    );
  }

  return (
    <div className="page">
      <PageHeader
        title="Customers"
        description="Customers identified in processed trade documents."
        actions={
          <Link to="/rules" className="btn btn-secondary btn-sm">
            <Icon name="rules" size={14} />
            View rules
          </Link>
        }
      />
      <DerivedNotice truncated={truncated}>
        Customers appear here once a document resolves to them; this is not the customer
        configuration source.
      </DerivedNotice>
      {body}
    </div>
  );
}
