import { useEffect, useState } from "react";
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
import { Link } from "../router.js";
import { EmptyState } from "./EmptyState.js";
import { Icon, type IconName } from "./Icon.js";

const OUTCOME: Record<string, string> = {
  auto_approve: "auto-approved",
  human_review: "routed to human review",
  amendment_request: "flagged for amendment",
};

const TONE_ICON: Record<Tone, IconName> = {
  success: "checkCircle",
  warning: "alert",
  danger: "xCircle",
  info: "clock",
  neutral: "file",
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

export function ActivityList({ runs, limit = 6 }: { runs: RunRecord[]; limit?: number }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  if (runs.length === 0) {
    return (
      <EmptyState compact icon="clock" title="No activity yet">
        Routing decisions appear here as documents are processed.
      </EmptyState>
    );
  }

  return (
    <ul className="ov-activity">
      {runs.slice(0, limit).map((run) => {
        const entry = describe(run);
        return (
          <li key={run.id}>
            <Link to={`/documents/${run.id}`} className="ov-activity-item">
              <span className={`ov-activity-icon tone-${entry.tone}`}>
                {entry.busy ? (
                  <span className="spinner ov-activity-spinner" />
                ) : (
                  <Icon name={TONE_ICON[entry.tone]} size={14} strokeWidth={2} />
                )}
              </span>
              <span className="ov-activity-main">
                <span className="ov-activity-line">
                  <span className="ov-activity-text">
                    <strong>{run.filename}</strong> {entry.outcome}
                  </span>
                  <time
                    className="ov-activity-time"
                    dateTime={entry.at}
                    title={formatDateTime(entry.at)}
                  >
                    {timeAgo(entry.at, now)}
                  </time>
                </span>
                {entry.meta && <span className="ov-activity-meta">{entry.meta}</span>}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
