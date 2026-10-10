import type { ReactNode } from "react";
import type { RunView } from "../api.js";
import {
  decisionMeta,
  formatDateTime,
  issueComparison,
  issueHeadline,
  issueSummary,
  runIssues,
  timeAgo,
  type Issue,
  type RunRecord,
} from "../domain.js";
import { Link } from "../router.js";
import { Icon } from "./Icon.js";
import { RouteLabel } from "./ShipmentTable.js";
import { DecisionBadge } from "./StatusBadge.js";

function IssueChip({ run, issue }: { run: RunView; issue: Issue }) {
  if (issue.kind === "mismatch") {
    const { found, expected } = issueComparison(run, issue);
    return (
      <li className="exc-chip tone-danger">
        <span className="dot" />
        <strong>{issue.title}:</strong>
        <span>{found}</span>
        <Icon name="arrowRight" size={12} className="text-faint" />
        <span>
          <span className="sr-only">expected </span>
          {expected}
        </span>
      </li>
    );
  }
  return (
    <li className="exc-chip tone-warning">
      <span className="dot" />
      <strong>{issue.title}</strong>
      <span className="exc-chip-sep" aria-hidden="true">
        ·
      </span>
      <span>{issueHeadline(run, issue)}</span>
    </li>
  );
}

function customerLabel(run: RunRecord): ReactNode {
  if (run.customer) return run.customer;
  if (run.customerStatus === "ambiguous") {
    return <span className="text-warning">Ambiguous customer</span>;
  }
  if (run.customerStatus === "not_found") {
    return <span className="text-warning">Unresolved customer</span>;
  }
  return null;
}

export function ExceptionCard({ run }: { run: RunRecord }) {
  const tone = decisionMeta(run.decision)?.tone ?? "neutral";
  const issues = run.detail ? runIssues(run.detail) : [];
  const chips = issues.filter((i) => i.kind === "field" || i.kind === "mismatch");
  const note = issues.find((i) => i.kind !== "field" && i.kind !== "mismatch")?.reasons[0];
  const customer = customerLabel(run);
  const meta: ReactNode[] = [
    customer,
    run.invoice && <span className="mono">{run.invoice}</span>,
    (run.origin || run.destination) && (
      <RouteLabel origin={run.origin} destination={run.destination} />
    ),
  ].filter(Boolean);

  return (
    <article className={`exc-card tone-${tone}`}>
      <div className="exc-main">
        <h3 className="exc-title">
          <Icon name="file" size={15} className="text-faint" />
          <Link to={`/documents/${run.id}`} className="exc-link">
            {run.filename}
          </Link>
        </h3>
        {meta.length > 0 && (
          <p className="exc-meta">
            {meta.map((part, i) => (
              <span key={i}>{part}</span>
            ))}
          </p>
        )}
        <div className="exc-issue">
          <p className={run.detail ? "exc-summary" : "exc-summary text-muted"}>
            {issueSummary(run.detail, run.decision)}
          </p>
          {chips.length > 0 && (
            <ul className="exc-chips" aria-label="Issues">
              {chips.map((issue) => (
                <IssueChip
                  key={`${issue.kind}-${issue.field ?? issue.title}`}
                  run={run.detail!}
                  issue={issue}
                />
              ))}
            </ul>
          )}
          {note && <p className="exc-note">{note}</p>}
        </div>
      </div>
      <div className="exc-side">
        <DecisionBadge decision={run.decision} size="sm" />
        <time className="exc-time" dateTime={run.createdAt} title={formatDateTime(run.createdAt)}>
          {timeAgo(run.createdAt)}
        </time>
        <span className="exc-open" aria-hidden="true">
          Open
          <Icon name="arrowRight" size={14} />
        </span>
      </div>
    </article>
  );
}
