import { useMemo } from "react";
import { EmptyState, ErrorState, LoadingRows } from "../components/EmptyState.js";
import { ExceptionCard } from "../components/ExceptionCard.js";
import { Icon } from "../components/Icon.js";
import { PageHeader } from "../components/PageHeader.js";
import { refreshRuns, RUN_LIST_LIMIT, useRuns } from "../data.js";
import { isFinal, plural, type RunRecord } from "../domain.js";
import { Link, useSearchParams } from "../router.js";
import "../styles/exceptions.css";

type Tab = "all" | "review" | "amendment";

const TABS: { key: Tab; label: string; to: string; hint: string }[] = [
  {
    key: "all",
    label: "All",
    to: "/exceptions",
    hint: "Nova auto-approves a document only when every required field is read reliably and every customer rule matches. Everything else is routed here for a person to check.",
  },
  {
    key: "review",
    label: "Human review",
    to: "/exceptions?type=review",
    hint: "Nova could not establish compliance automatically. Open a document to verify the flagged fields against their source evidence.",
  },
  {
    key: "amendment",
    label: "Amendment requests",
    to: "/exceptions?type=amendment",
    hint: "These documents were read reliably but do not meet the customer's rules. Open one to see the discrepancies and the suggested amendment request.",
  },
];

const newestFirst = (a: RunRecord, b: RunRecord) => b.createdAt.localeCompare(a.createdAt);

type Groups = Record<Tab, RunRecord[]> & { decided: number; processing: number; failed: number };

function EmptyTab({ tab, total, groups }: { tab: Tab; total: number; groups: Groups }) {
  if (total === 0) {
    return (
      <EmptyState
        icon="inbox"
        title="No documents processed yet"
        action={
          <Link to="/" className="btn btn-primary btn-sm">
            <Icon name="upload" size={14} />
            Upload document
          </Link>
        }
      >
        Exceptions appear here when Nova routes a document to human review or requests an amendment.
      </EmptyState>
    );
  }
  if (tab === "review") {
    return (
      <EmptyState
        icon="checkCircle"
        title="Nothing awaiting human review"
        action={
          groups.amendment.length > 0 && (
            <Link to="/exceptions?type=amendment" className="btn btn-secondary btn-sm">
              View amendment requests
            </Link>
          )
        }
      >
        Documents appear here when Nova cannot establish compliance automatically: uncertain fields,
        an unidentified customer, missing rules or a processing error.
      </EmptyState>
    );
  }
  if (tab === "amendment") {
    return (
      <EmptyState
        icon="checkCircle"
        title="No amendment requests"
        action={
          groups.review.length > 0 && (
            <Link to="/exceptions?type=review" className="btn btn-secondary btn-sm">
              View human review
            </Link>
          )
        }
      >
        Documents appear here when every field was read reliably but at least one customer rule does
        not match.
      </EmptyState>
    );
  }
  return (
    <EmptyState icon="checkCircle" title={groups.decided ? "No exceptions" : "No exceptions yet"}>
      {groups.decided
        ? "Every processed document was auto-approved."
        : "No document has reached a decision yet."}
    </EmptyState>
  );
}

export function ExceptionsPage() {
  const { runs, error, truncated } = useRuns();
  const type = useSearchParams().get("type");
  const tab: Tab = type === "review" || type === "amendment" ? type : "all";
  const active = TABS.find((t) => t.key === tab) ?? TABS[0]!;

  const groups = useMemo<Groups>(() => {
    const sorted = [...(runs ?? [])].sort(newestFirst);
    const review = sorted.filter((r) => r.decision === "human_review");
    const amendment = sorted.filter((r) => r.decision === "amendment_request");
    return {
      all: sorted.filter(
        (r) => r.decision === "human_review" || r.decision === "amendment_request",
      ),
      review,
      amendment,
      decided: sorted.filter((r) => r.decision !== null).length,
      processing: sorted.filter((r) => !isFinal(r.status)).length,
      failed: sorted.filter((r) => r.status === "FAILED").length,
    };
  }, [runs]);

  const list = groups[tab];

  return (
    <div className="page">
      <PageHeader title="Exceptions" description="Documents that require human attention." />

      <div className="section">
        <nav className="tabs" aria-label="Exception type">
          {TABS.map((t) => (
            <Link
              key={t.key}
              to={t.to}
              className={t.key === tab ? "tab is-active" : "tab"}
              aria-current={t.key === tab ? "page" : undefined}
            >
              {t.label}
              {runs && <span className="tab-count">{groups[t.key].length}</span>}
            </Link>
          ))}
        </nav>

        <div className="exc-hint-row">
          <p className="exc-hint">{active.hint}</p>
          {groups.processing > 0 && (
            <Link to="/documents?status=processing" className="status-dot tone-info exc-processing">
              <span className="dot dot-pulse" />
              {plural(groups.processing, "document")} processing
            </Link>
          )}
        </div>

        {tab === "all" && groups.failed > 0 && (
          <div className="callout tone-neutral">
            <Icon name="alert" size={16} />
            <p>
              <strong>{plural(groups.failed, "run")} failed</strong> before Nova could reach a
              decision, so {groups.failed === 1 ? "it is" : "they are"} not listed here.{" "}
              <Link to="/documents?status=failed">View failed runs</Link>
            </p>
          </div>
        )}

        <section className="panel exc-panel" aria-labelledby="exc-list-title">
          <h2 id="exc-list-title" className="sr-only">
            {active.label}
          </h2>
          {error ? (
            <ErrorState message={error} onRetry={() => void refreshRuns()} />
          ) : !runs ? (
            <LoadingRows rows={4} />
          ) : list.length === 0 ? (
            <EmptyTab tab={tab} total={runs.length} groups={groups} />
          ) : (
            <ul className="exc-list">
              {list.map((run) => (
                <li key={run.id}>
                  <ExceptionCard run={run} />
                </li>
              ))}
            </ul>
          )}
        </section>

        {truncated && (
          <p className="exc-footnote">
            <Icon name="info" size={13} />
            Counts cover the latest {RUN_LIST_LIMIT} runs.
          </p>
        )}
      </div>
    </div>
  );
}
