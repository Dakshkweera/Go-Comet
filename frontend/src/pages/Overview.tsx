import "../styles/overview.css";
import { ActivityList } from "../components/ActivityList.js";
import { EmptyState, ErrorState, LoadingRows } from "../components/EmptyState.js";
import { Icon } from "../components/Icon.js";
import { KpiCard } from "../components/KpiCard.js";
import { PageHeader, SectionHeader } from "../components/PageHeader.js";
import { ShipmentTable } from "../components/ShipmentTable.js";
import { UploadDropzone } from "../components/UploadDropzone.js";
import { refreshRuns, RUN_LIST_LIMIT, useRuns } from "../data.js";
import { isFinal, timeAgo, type RunRecord } from "../domain.js";
import { Link } from "../router.js";

const FLOW = ["Extract fields", "Resolve customer", "Validate rules", "Route decision"];

function Metrics({ runs, truncated }: { runs: RunRecord[]; truncated: boolean }) {
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
          to="/exceptions?type=review"
        />
        <KpiCard
          label="Amendment requests"
          value={amendments}
          icon="xCircle"
          tone="danger"
          detail={share(amendments)}
          to="/exceptions?type=amendment"
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

function MetricsSkeleton() {
  return (
    <div className="ov-kpis" aria-busy="true" aria-label="Loading metrics">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="ov-kpi">
          <span className="skeleton ov-sk-label" />
          <span className="skeleton ov-sk-value" />
          <span className="skeleton ov-sk-detail" />
        </div>
      ))}
    </div>
  );
}

function GetStarted() {
  return (
    <section className="panel ov-intro" aria-labelledby="ov-intro-title">
      <span className="ov-intro-icon">
        <Icon name="inbox" size={20} />
      </span>
      <div className="ov-intro-text">
        <h2 className="ov-intro-title" id="ov-intro-title">
          No documents processed yet
        </h2>
        <p>
          Upload a trade document to start your first pipeline run. Metrics, exceptions and
          shipments will appear here.
        </p>
      </div>
      <ol className="ov-flow" aria-label="Pipeline steps">
        {FLOW.map((step, i) => (
          <li key={step}>
            {i > 0 && <Icon name="chevronRight" size={13} className="text-faint" />}
            <span className="ov-flow-step">{step}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function OverviewPage() {
  const { runs, error, truncated } = useRuns();
  const inProgress = runs?.filter((r) => !isFinal(r.status)).length ?? 0;
  const showShipments = runs ? runs.length > 0 : !error;

  return (
    <div className="page">
      <PageHeader
        title="Trade Operations"
        description="Monitor document processing, validation and exceptions."
      />

      {error ? (
        <div className="panel">
          <ErrorState message={`Could not load pipeline runs: ${error}`} onRetry={refreshRuns} />
        </div>
      ) : !runs ? (
        <MetricsSkeleton />
      ) : runs.length === 0 ? (
        <GetStarted />
      ) : (
        <Metrics runs={runs} truncated={truncated} />
      )}

      <div className="ov-main">
        <UploadDropzone />

        <section className="panel ov-activity-panel" aria-labelledby="ov-activity-title">
          <div className="panel-header">
            <div>
              <h2 className="panel-title" id="ov-activity-title">
                Recent activity
              </h2>
              <p className="panel-subtitle">Latest pipeline results</p>
            </div>
            {inProgress > 0 && (
              <span className="status-dot tone-info">
                <span className="dot dot-pulse" />
                {inProgress} processing
              </span>
            )}
          </div>
          {runs ? (
            <ActivityList runs={runs} />
          ) : error ? (
            <EmptyState compact icon="alert" title="Activity unavailable">
              Recent activity appears once pipeline runs can be loaded.
            </EmptyState>
          ) : (
            <LoadingRows rows={5} />
          )}
        </section>
      </div>

      {showShipments && (
        <section className="section" aria-labelledby="ov-shipments-title">
          <SectionHeader
            id="ov-shipments-title"
            title="Recent shipments"
            subtitle="Latest documents processed by the pipeline"
            actions={
              <Link to="/documents" className="link-button">
                View all documents
                <Icon name="arrowRight" size={14} />
              </Link>
            }
          />
          <div className="panel ov-shipments">
            {runs ? <ShipmentTable runs={runs.slice(0, 5)} compact /> : <LoadingRows rows={3} />}
          </div>
        </section>
      )}
    </div>
  );
}
