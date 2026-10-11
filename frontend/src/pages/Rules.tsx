import "../styles/config.css";
import { useId, useMemo, type ReactNode } from "react";
import type { RuleOperator, ValidationStatus } from "../types/api.js";
import { EmptyState, ErrorState, LoadingRows } from "../components/EmptyState.js";
import { Icon } from "../components/Icon.js";
import { PageHeader } from "../components/PageHeader.js";
import { refreshRuns, useRuns } from "../data.js";
import {
  deriveCustomers,
  outcomeSegments,
  totalOutcomes,
  type DerivedCustomer,
} from "../derived.js";
import { fieldLabel, formatDateTime, plural, timeAgo, VALIDATION } from "../domain.js";
import { Link, setSearchParams, useSearchParams } from "../router.js";
import { Breakdown, DerivedNotice, Legend } from "./Customers.js";

const OPERATORS: Record<RuleOperator, string> = {
  EXACT:
    "Value must equal the expected value, compared after light normalization (e.g. HS code punctuation).",
  MIN: "Number must be at least the minimum.",
  MAX: "Number must not exceed the maximum.",
  RANGE: "Number must fall between the minimum and maximum, inclusive.",
};

const OUTCOME_LEGEND = (Object.keys(VALIDATION) as ValidationStatus[]).map((key) => ({
  key,
  ...VALIDATION[key],
}));

function CustomerRules({ customer }: { customer: DerivedCustomer }) {
  const headingId = useId();
  const { latest } = customer;

  return (
    <section className="panel" aria-labelledby={headingId}>
      <div className="panel-header cfg-group-header">
        <div>
          <h2 className="panel-title" id={headingId}>
            {customer.name}
          </h2>
          <p className="panel-subtitle">
            {plural(customer.activeRules, "active rule")} ·{" "}
            {plural(customer.validatedRuns, "document")} validated
          </p>
        </div>
        <Link
          to={`/documents?customer=${encodeURIComponent(customer.name)}`}
          className="row-action"
        >
          Documents
          <Icon name="arrowRight" size={14} />
        </Link>
      </div>

      {customer.rules.length === 0 ? (
        <EmptyState compact icon="rules" title="No active rules">
          No active validation rules were returned for {customer.name}, so its documents cannot be
          validated automatically and are routed to human review.
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table cfg-rules">
            <thead>
              <tr>
                <th>Field</th>
                <th>Operator</th>
                <th>Expected</th>
                <th>Outcomes</th>
              </tr>
            </thead>
            <tbody>
              {customer.rules.map((rule) => (
                <tr key={rule.id} className={rule.active ? undefined : "cfg-inactive"}>
                  <td>
                    <span className="cell-stack">
                      <span className="cfg-field">{fieldLabel(rule.field)}</span>
                      {!rule.active && (
                        <span className="cell-secondary">No longer active · seen in past runs</span>
                      )}
                    </span>
                  </td>
                  <td>
                    {rule.operator ? (
                      <span className="cfg-op" title={OPERATORS[rule.operator]}>
                        {rule.operator}
                      </span>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </td>
                  <td className="cfg-expected">{rule.expectation}</td>
                  <td>
                    {totalOutcomes(rule.outcomes) > 0 ? (
                      <Breakdown segments={outcomeSegments(rule.outcomes)} />
                    ) : (
                      <span className="text-faint text-sm">Not evaluated yet</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="panel-footer cfg-source">
        <Icon name="info" size={14} />
        <span>Active rules as returned with the latest document,</span>
        <Link to={`/documents/${latest.id}`}>{latest.filename}</Link>
        <span title={formatDateTime(latest.createdAt)}>· {timeAgo(latest.createdAt)}</span>
      </div>
    </section>
  );
}

function OperatorLegend() {
  return (
    <section className="cfg-guide" aria-labelledby="cfg-guide-title">
      <h2 className="cfg-guide-title" id="cfg-guide-title">
        How rules are evaluated
      </h2>
      <dl className="cfg-ops">
        {(Object.keys(OPERATORS) as RuleOperator[]).map((op) => (
          <div key={op}>
            <dt>
              <span className="cfg-op">{op}</span>
            </dt>
            <dd>{OPERATORS[op]}</dd>
          </div>
        ))}
      </dl>
      <div className="cfg-outcomes-note">
        <Legend segments={OUTCOME_LEGEND} />
        <p>
          When a rule has a unit, the extracted weight is converted to it before comparing. A rule
          is uncertain when it could not be checked, usually because the field was not read
          reliably.
        </p>
      </div>
    </section>
  );
}

export function RulesPage() {
  const { runs, loading, error, truncated } = useRuns();
  const selected = useSearchParams().get("customer") ?? "";
  const customers = useMemo(() => (runs ? deriveCustomers(runs) : []), [runs]);
  const known = customers.some((c) => c.name === selected);
  const shown = selected ? customers.filter((c) => c.name === selected) : customers;
  const ruleCount = shown.reduce((sum, c) => sum + c.activeRules, 0);

  let body: ReactNode;
  if (loading) {
    body = (
      <div className="panel">
        <LoadingRows rows={5} />
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
  } else if (customers.length === 0) {
    body = (
      <div className="panel">
        <EmptyState
          icon="rules"
          title="No customer rules to show yet"
          action={
            runs.length === 0 ? (
              <Link to="/documents" className="btn btn-primary btn-sm">
                <Icon name="upload" size={14} />
                Upload document
              </Link>
            ) : (
              <Link to="/customers" className="btn btn-secondary btn-sm">
                View unresolved consignees
              </Link>
            )
          }
        >
          Rules appear once a processed document resolves to a configured customer.
        </EmptyState>
      </div>
    );
  } else {
    body = (
      <>
        <div className="cfg-toolbar">
          <div className="filter-bar">
            <label className="sr-only" htmlFor="cfg-customer">
              Customer
            </label>
            <select
              id="cfg-customer"
              className="select"
              value={selected}
              onChange={(e) => setSearchParams({ customer: e.target.value || null })}
            >
              <option value="">All customers</option>
              {customers.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
              {selected && !known && <option value={selected}>{selected}</option>}
            </select>
          </div>
          <span className="text-muted text-sm">
            {plural(shown.length, "customer")} · {plural(ruleCount, "active rule")}
          </span>
        </div>

        {shown.length === 0 ? (
          <div className="panel">
            <EmptyState
              icon="filter"
              title={`No processed documents for “${selected}”`}
              action={
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setSearchParams({ customer: null })}
                >
                  Show all customers
                </button>
              }
            >
              Rules are listed only for customers that processed documents resolved to.
            </EmptyState>
          </div>
        ) : (
          shown.map((c) => <CustomerRules key={c.name} customer={c} />)
        )}

        <OperatorLegend />
      </>
    );
  }

  return (
    <div className="page">
      <PageHeader
        title="Rules"
        description="Customer validation rules applied to processed documents, and how each one performed."
        actions={
          <Link to="/customers" className="btn btn-secondary btn-sm">
            <Icon name="customers" size={14} />
            View customers
          </Link>
        }
      />
      <DerivedNotice truncated={truncated}>
        Rules are the active rules returned with each customer's most recent document, and outcomes
        are counted from recorded validations. This is not the rule configuration source; rules
        cannot be edited here.
      </DerivedNotice>
      {body}
    </div>
  );
}
