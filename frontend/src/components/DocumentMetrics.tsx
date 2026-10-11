import "../styles/overview.css";
import { RUN_LIST_LIMIT } from "../data.js";
import { isFinal, timeAgo, type RunRecord } from "../domain.js";
import { Icon } from "./Icon.js";
import { KpiCard } from "./KpiCard.js";

export function DocumentMetrics({ runs, truncated }: { runs: RunRecord[]; truncated: boolean }) {
  const inProgress = runs.filter((r) => !isFinal(r.status)).length;
  const failed = runs.filter((r) => r.status === "FAILED").length;
  const processed = runs.length - inProgress;
  const count = (decision: string) => runs.filter((r) => r.decision === decision).length;
  const share = (n: number) =>
    processed > 0 ? `${Math.round((n / processed) * 100)}% of processed` : "Awaiting first result";
  const approved = count("auto_approve");
  const review = count("human_review");
  const amendments = count("amendment_request");
  const activity = [
    inProgress > 0 ? `${inProgress} in progress` : null,
    failed > 0 ? `${failed} failed` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section className="ov-metrics" aria-label="Key metrics">
      <div className="ov-kpis">
        <KpiCard
          label="Processed"
          value={processed}
          icon="documents"
          tone="info"
          detail={activity || `Last upload ${timeAgo(runs[0]?.createdAt)}`}
          to="/documents"
        />
        <KpiCard
          label="Auto approved"
          value={approved}
          icon="checkCircle"
          tone="success"
          detail={share(approved)}
          to="/documents?decision=auto_approve"
        />
        <KpiCard
          label="Human review"
          value={review}
          icon="alert"
          tone="warning"
          detail={share(review)}
          to="/exceptions?view=documents&type=review"
        />
        <KpiCard
          label="Amendment requests"
          value={amendments}
          icon="xCircle"
          tone="danger"
          detail={share(amendments)}
          to="/exceptions?view=documents&type=amendment"
        />
      </div>
      {truncated && (
        <p className="ov-kpi-note">
          <Icon name="info" size={13} />
          Counts cover the latest {RUN_LIST_LIMIT} runs.
        </p>
      )}
    </section>
  );
}
