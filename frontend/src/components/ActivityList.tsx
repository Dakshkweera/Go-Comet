import { useEffect, useState, type ReactNode } from "react";
import {
  decisionMeta,
  formatDateTime,
  isFinal,
  issueSummary,
  stageIndex,
  timeAgo,
  type RunRecord,
  type Tone,
} from "../domain.js";
import { toneIcon } from "../shipmentDomain.js";
import { Link } from "../router.js";
import { EmptyState } from "./EmptyState.js";
import { Icon, type IconName } from "./Icon.js";

const OUTCOME: Record<string, string> = {
  auto_approve: "auto-approved",
  human_review: "routed to human review",
  amendment_request: "flagged for amendment",
};

type Entry = { tone: Tone; busy: boolean; outcome: string; meta: string; at: string };

function describe(run: RunRecord): Entry {
  if (!isFinal(run.status)) {
    const stage = run.detail?.currentStage;
    return {
      tone: "info",
      busy: true,
      outcome: "is being processed",
      meta:
        run.status === "RECEIVED"
          ? "Queued"
          : stage && stageIndex(stage) >= stageIndex("EXTRACTED")
            ? "Validating customer rules"
            : "Extracting fields",
      at: run.createdAt,
    };
  }
  const at = run.completedAt ?? run.createdAt;
  if (run.status === "FAILED") {
    return {
      tone: "danger",
      busy: false,
      outcome: "failed to process",
      meta: run.detail?.error?.message ?? "Pipeline error",
      at,
    };
  }
  const who = run.customer ?? run.consignee;
  return {
    tone: decisionMeta(run.decision)?.tone ?? "neutral",
    busy: false,
    outcome: (run.decision && OUTCOME[run.decision]) ?? "processed",
    meta: [who, issueSummary(run.detail, run.decision)].filter(Boolean).join(" · "),
    at,
  };
}

export type FeedItem = {
  key: string;
  tone: Tone;
  icon: IconName;
  busy?: boolean;
  title: ReactNode;
  meta?: string;
  at: string;
  to?: string;
};

export function ActivityFeed({
  items,
  absoluteTime = false,
}: {
  items: FeedItem[];
  absoluteTime?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (absoluteTime) return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [absoluteTime]);

  return (
    <ul className="ov-activity">
      {items.map((item) => {
        const content = (
          <>
            <span className={`ov-activity-icon tone-${item.tone}`}>
              {item.busy ? (
                <span className="spinner ov-activity-spinner" />
              ) : (
                <Icon name={item.icon} size={14} strokeWidth={2} />
              )}
            </span>
            <span className="ov-activity-main">
              <span className="ov-activity-line">
                <span className="ov-activity-text">{item.title}</span>
                <time
                  className="ov-activity-time"
                  dateTime={item.at}
                  title={formatDateTime(item.at)}
                >
                  {absoluteTime ? formatDateTime(item.at) : timeAgo(item.at, now)}
                </time>
              </span>
              {item.meta && <span className="ov-activity-meta">{item.meta}</span>}
            </span>
          </>
        );
        return (
          <li key={item.key}>
            {item.to ? (
              <Link to={item.to} className="ov-activity-item">
                {content}
              </Link>
            ) : (
              <div className="ov-activity-item">{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function ActivityList({ runs, limit = 6 }: { runs: RunRecord[]; limit?: number }) {
  if (runs.length === 0) {
    return (
      <EmptyState compact icon="clock" title="No activity yet">
        Routing decisions appear here as documents are processed.
      </EmptyState>
    );
  }

  return (
    <ActivityFeed
      items={runs.slice(0, limit).map((run) => {
        const entry = describe(run);
        return {
          key: run.id,
          tone: entry.tone,
          icon: toneIcon(entry.tone),
          busy: entry.busy,
          title: (
            <>
              <strong>{run.filename}</strong> {entry.outcome}
            </>
          ),
          meta: entry.meta,
          at: entry.at,
          to: `/documents/${run.id}`,
        };
      })}
    />
  );
}
