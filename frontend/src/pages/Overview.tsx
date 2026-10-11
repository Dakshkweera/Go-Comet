import "../styles/overview.css";
import { EmptyState, ErrorState } from "../components/EmptyState.js";
import { Icon, type IconName } from "../components/Icon.js";
import { KpiCard } from "../components/KpiCard.js";
import { PageHeader, SectionHeader } from "../components/PageHeader.js";
import { RefreshButton } from "../components/RefreshButton.js";
import { ShipmentFeed } from "../components/ShipmentFeed.js";
import type { Tone } from "../domain.js";
import { useMetrics, useShipments } from "../shipmentData.js";
import {
  attentionShipments,
  formatMinutes,
  pipelineCounts,
  recentShipments,
  type PipelineKey,
} from "../shipmentDomain.js";
import { Link } from "../router.js";

const STAGES: {
  key: PipelineKey;
  label: string;
  detail: string;
  icon: IconName;
  tone: Tone;
  to: string;
}[] = [
  {
    key: "processing",
    label: "Processing",
    detail: "Being read right now",
    icon: "clock",
    tone: "info",
    to: "/processing",
  },
  {
    key: "review",
    label: "Needs review",
    detail: "Waiting for your decision",
    icon: "alert",
    tone: "warning",
    to: "/exceptions?filter=review",
  },
  {
    key: "amendment",
    label: "Amendment ready",
    detail: "Reply drafted for the supplier",
    icon: "xCircle",
    tone: "danger",
    to: "/exceptions?filter=amendment",
  },
  {
    key: "approval",
    label: "Ready to approve",
    detail: "All checks passed",
    icon: "checkCircle",
    tone: "success",
    to: "/shipments?filter=approval",
  },
  {
    key: "waiting",
    label: "Waiting for supplier",
    detail: "Amendment sent, no answer yet",
    icon: "send",
    tone: "neutral",
    to: "/shipments?filter=waiting",
  },
  {
    key: "done",
    label: "Done",
    detail: "Approved and sent",
    icon: "check",
    tone: "success",
    to: "/shipments?filter=done",
  },
];

const FLOW = [
  "Email received",
  "Attachments read",
  "Checked against rules",
  "You review",
  "Reply sent",
];

function Results() {
  const metrics = useMetrics();
  if (!metrics) return null;

  return (
    <section className="section" aria-labelledby="ov-results-title">
      <SectionHeader
        id="ov-results-title"
        title="Results"
        subtitle="How the replies to suppliers are going"
      />
      <div className="ov-kpis ov-kpis-three">
        <KpiCard
          label="Replies sent"
          value={metrics.replies.sent}
          icon="send"
          tone="success"
          detail={
            metrics.replies.sent > 0
              ? `${metrics.replies.unedited} unedited · ${metrics.replies.edited} edited`
              : "Simulated, after your review"
          }
          to="/sent-emails"
        />
        <KpiCard
          label="Median time to reply"
          value={formatMinutes(metrics.northStar.value)}
          icon="clock"
          tone="neutral"
          detail="From supplier email to reply sent"
        />
        <KpiCard
          label="Emails per shipment"
          value={metrics.averageCycles === null ? "—" : metrics.averageCycles.toFixed(1)}
          icon="mail"
          tone="neutral"
          detail="Back-and-forth with the supplier"
        />
      </div>
    </section>
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
          No supplier emails yet
        </h2>
        <p>
          When a supplier emails shipment documents, Nova reads them, checks them against the
          customer’s rules and prepares a reply for you to review.
        </p>
        <p>
          <Link to="/simulate" className="btn btn-secondary btn-sm">
            Simulate a supplier email
          </Link>
        </p>
      </div>
      <ol className="ov-flow" aria-label="How an email is handled">
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

function PipelineSkeleton() {
  return (
    <div className="ov-kpis ov-kpis-pipeline" aria-busy="true" aria-label="Loading">
      {STAGES.map((stage) => (
        <div key={stage.key} className="ov-kpi">
          <span className="skeleton ov-sk-label" />
          <span className="skeleton ov-sk-value" />
          <span className="skeleton ov-sk-detail" />
        </div>
      ))}
    </div>
  );
}

export function OverviewPage() {
  const { shipments, loading, error, refresh } = useShipments();
  const all = shipments ?? [];
  const counts = pipelineCounts(all);
  const failed = all.filter((s) => s.status === "FAILED").length;
  const attention = attentionShipments(all, 6);
  const recent = recentShipments(all, 6);

  return (
    <div className="page">
      <PageHeader
        title="Overview"
        description="Where every supplier email stands, from received to replied."
        actions={<RefreshButton />}
      />

      {error ? (
        <div className="panel">
          <ErrorState message={`Could not load shipments: ${error}`} onRetry={refresh} />
        </div>
      ) : loading ? (
        <PipelineSkeleton />
      ) : all.length === 0 ? (
        <GetStarted />
      ) : (
        <>
          <section className="section" aria-labelledby="ov-pipeline-title">
            <SectionHeader
              id="ov-pipeline-title"
              title="Where shipments are now"
              subtitle="From a new email to a reply. Select a card to see those shipments."
            />
            <div className="ov-kpis ov-kpis-pipeline">
              {STAGES.map((stage) => (
                <KpiCard
                  key={stage.key}
                  label={stage.label}
                  value={counts[stage.key]}
                  icon={stage.icon}
                  tone={stage.tone}
                  detail={stage.detail}
                  to={stage.to}
                />
              ))}
            </div>
            {failed > 0 && (
              <div className="callout tone-danger">
                <Icon name="alert" size={16} />
                <p>
                  <strong>
                    {failed === 1 ? "1 shipment" : `${failed} shipments`} could not be processed.
                  </strong>{" "}
                  <Link to="/shipments">Open Shipments</Link>
                </p>
              </div>
            )}
          </section>

          <div className="ov-main ov-main-even">
            <section className="panel ov-activity-panel" aria-labelledby="ov-attention-title">
              <div className="panel-header">
                <div>
                  <h2 className="panel-title" id="ov-attention-title">
                    Needs your attention
                  </h2>
                  <p className="panel-subtitle">Longest waiting first</p>
                </div>
                <Link to="/exceptions" className="link-button">
                  Exceptions
                  <Icon name="arrowRight" size={14} />
                </Link>
              </div>
              {attention.length === 0 ? (
                <EmptyState compact icon="checkCircle" title="Nothing is waiting for you">
                  Shipments that need a decision or a reply show up here.
                </EmptyState>
              ) : (
                <ShipmentFeed shipments={attention} from="overview" />
              )}
            </section>

            <section className="panel ov-activity-panel" aria-labelledby="ov-recent-title">
              <div className="panel-header">
                <div>
                  <h2 className="panel-title" id="ov-recent-title">
                    Recent activity
                  </h2>
                  <p className="panel-subtitle">Latest changes across all shipments</p>
                </div>
                <Link to="/shipments" className="link-button">
                  Shipments
                  <Icon name="arrowRight" size={14} />
                </Link>
              </div>
              <ShipmentFeed shipments={recent} from="overview" />
            </section>
          </div>

          <Results />
        </>
      )}
    </div>
  );
}
