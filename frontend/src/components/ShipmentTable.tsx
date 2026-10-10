import type { ReactNode } from "react";
import { formatDateTime, timeAgo, type RunRecord } from "../domain.js";
import { Link, navigate } from "../router.js";
import { Icon } from "./Icon.js";
import { DecisionBadge, RunStatusBadge } from "./StatusBadge.js";

export function RouteLabel({
  origin,
  destination,
}: {
  origin: string | null;
  destination: string | null;
}) {
  if (!origin && !destination) return <span className="text-faint">—</span>;
  return (
    <span className="route">
      <span>{origin ?? "—"}</span>
      <Icon name="arrowRight" size={12} className="text-faint" />
      <span>{destination ?? "—"}</span>
    </span>
  );
}

export function CustomerLabel({ run }: { run: RunRecord }) {
  if (run.customer) return <span>{run.customer}</span>;
  if (!run.detail) return <span className="text-faint">—</span>;
  if (run.customerStatus === "not_found" || run.customerStatus === "ambiguous") {
    return (
      <span className="cell-stack">
        <span className="text-warning">
          {run.customerStatus === "ambiguous" ? "Ambiguous" : "Unresolved"}
        </span>
        {run.consignee && <span className="cell-secondary">{run.consignee}</span>}
      </span>
    );
  }
  return <span className="text-faint">—</span>;
}

export function ShipmentTable({
  runs,
  empty,
  compact = false,
}: {
  runs: RunRecord[];
  empty?: ReactNode;
  compact?: boolean;
}) {
  if (runs.length === 0) return <>{empty}</>;

  const open = (id: string) => navigate(`/documents/${id}`);

  return (
    <div className="table-wrap">
      <table className={compact ? "table table-compact" : "table"}>
        <thead>
          <tr>
            <th>Document</th>
            <th>Customer</th>
            <th>Invoice</th>
            <th>Route</th>
            <th>Status</th>
            <th>Decision</th>
            <th>Processed</th>
            <th className="col-action">
              <span className="sr-only">Open</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id} className="is-clickable" onClick={() => open(run.id)}>
              <td>
                <span className="cell-doc">
                  <Icon name="file" size={16} className="text-faint" />
                  <Link
                    to={`/documents/${run.id}`}
                    className="cell-primary"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {run.filename}
                  </Link>
                </span>
              </td>
              <td>
                <CustomerLabel run={run} />
              </td>
              <td className="mono">{run.invoice ?? <span className="text-faint">—</span>}</td>
              <td>
                <RouteLabel origin={run.origin} destination={run.destination} />
              </td>
              <td>
                <RunStatusBadge status={run.status} />
              </td>
              <td>
                <DecisionBadge decision={run.decision} size="sm" />
              </td>
              <td className="text-muted nowrap" title={formatDateTime(run.createdAt)}>
                {timeAgo(run.createdAt)}
              </td>
              <td className="col-action">
                <span className="row-action">
                  View
                  <Icon name="arrowRight" size={14} />
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
