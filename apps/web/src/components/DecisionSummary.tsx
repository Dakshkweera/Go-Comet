import type { ReactNode } from "react";
import { REQUIRED_FIELDS } from "@nova/contracts";
import type { RunView } from "../api.js";
import {
  capitalize,
  countValidations,
  fieldLabel,
  fieldReasons,
  formatFieldValue,
  isFinal,
  issueComparison,
  listText,
  plural,
  reasonPhrases,
  stageIndex,
  type Issue,
  type Tone,
} from "../domain.js";
import { Comparison } from "./AmendmentPanel.js";
import { AnchorLink, fieldAnchor, jumpTo, ruleAnchor } from "./ExtractionGrid.js";
import { Icon, type IconName } from "./Icon.js";

type Summary = {
  tone: Tone;
  icon: IconName | "spinner";
  eyebrow: string;
  title: string;
  text?: ReactNode;
  body?: ReactNode;
  action?: { label: string; target: string };
};

function ErrorLine({ error }: { error: NonNullable<RunView["error"]> }) {
  return (
    <p className="dd-summary-error">
      <span className="mono">{error.code}</span>
      {error.message && <span>{error.message}</span>}
    </p>
  );
}

function FieldIssues({ run, issues }: { run: RunView; issues: Issue[] }) {
  return (
    <ul className="dd-issues">
      {issues.map((issue) => {
        if (!issue.field) return null;
        const extracted = run.extraction?.[issue.field] ?? null;
        const value = extracted ? formatFieldValue(extracted) : null;
        const onCard = extracted && fieldReasons(run, issue.field).length > 0;
        return (
          <li key={issue.field} className="dd-issue">
            <AnchorLink
              target={onCard ? fieldAnchor(issue.field) : ruleAnchor(issue.field)}
              className="dd-issue-field"
            >
              {issue.title}
            </AnchorLink>
            <span className="dd-issue-detail">
              <span className={value === null ? "dd-issue-value is-empty" : "dd-issue-value"}>
                {value ?? "Not found"}
              </span>
              {reasonPhrases(issue.reasons, extracted).map((p) => (
                <span key={p} className="dd-chip">
                  {capitalize(p)}
                </span>
              ))}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function MismatchIssues({ run, issues }: { run: RunView; issues: Issue[] }) {
  return (
    <ul className="dd-issues">
      {issues.map((issue) => {
        const { found, expected } = issueComparison(run, issue);
        return (
          <li key={issue.field ?? issue.title} className="dd-issue">
            {issue.field ? (
              <AnchorLink target={ruleAnchor(issue.field)} className="dd-issue-field">
                {issue.title}
              </AnchorLink>
            ) : (
              <span className="dd-issue-field">{issue.title}</span>
            )}
            <span className="dd-issue-detail">
              <Comparison found={found} expected={expected} />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

const NOT_AUTO = "Why this was not auto-approved";

function summarize(run: RunView, issues: Issue[]): Summary {
  if (!isFinal(run.status)) {
    const extracted = stageIndex(run.currentStage) >= stageIndex("EXTRACTED");
    const attempt = run.attempts.filter((a) => a.stage === "EXTRACTING").length;
    return {
      tone: "info",
      icon: "spinner",
      eyebrow: run.status === "RECEIVED" ? "Queued" : "In progress",
      title: "Processing — this page updates automatically.",
      text:
        run.status === "RECEIVED"
          ? "The document was received and is waiting to be processed."
          : extracted
            ? "Fields are extracted. Nova is resolving the customer, validating rules and making a decision."
            : attempt > 1
              ? `Extracting fields from the document (attempt ${attempt}).`
              : "Extracting fields from the document.",
    };
  }

  if (run.status === "FAILED" || !run.decision) {
    return {
      tone: "danger",
      icon: "xCircle",
      eyebrow: "Processing failed",
      title: "Nova could not finish processing this document.",
      text: "No decision was recorded for this document.",
      body: run.error && <ErrorLine error={run.error} />,
    };
  }

  const customer = run.customer?.name ?? "the customer";
  const counts = countValidations(run.validations);
  const decision = run.decision.decision;

  if (decision === "auto_approve") {
    const uncovered = REQUIRED_FIELDS.filter(
      (f) => !run.validations.some((v) => v.field === f),
    ).map(fieldLabel);
    return {
      tone: "success",
      icon: "checkCircle",
      eyebrow: "Why this was auto-approved",
      title:
        "All required fields were extracted reliably and all configured customer rules matched.",
      text: `${counts.match} of ${plural(run.validations.length, "rule")} matched for ${customer}.`,
      body: uncovered.length > 0 && (
        <p className="dd-summary-note">
          <Icon name="info" size={14} />
          {listText(uncovered)} {uncovered.length === 1 ? "is" : "are"} not covered by customer
          rules and {uncovered.length === 1 ? "was" : "were"} not validated.
        </p>
      ),
    };
  }

  if (decision === "amendment_request") {
    const n = issues.length;
    return {
      tone: "danger",
      icon: "xCircle",
      eyebrow: "Why an amendment is requested",
      title: `${plural(n, "customer requirement")} ${n === 1 ? "does" : "do"} not match the document.`,
      text: `Every field was read reliably, but ${
        n === 1 ? "this value differs" : "these values differ"
      } from ${customer}'s rules.`,
      body: <MismatchIssues run={run} issues={issues} />,
      action: { label: "View amendment", target: "amendment" },
    };
  }

  const first = issues[0];
  if (first?.kind === "error") {
    return {
      tone: "warning",
      icon: "alert",
      eyebrow: NOT_AUTO,
      title: "Fields could not be extracted from this document.",
      text: "Without extracted fields no customer rules could be checked, so Nova routed it to human review.",
      body: run.error ? (
        <ErrorLine error={run.error} />
      ) : (
        <p className="dd-summary-error">{first.reasons[0]}</p>
      ),
    };
  }
  if (first?.kind === "customer") {
    return {
      tone: "warning",
      icon: "alert",
      eyebrow: NOT_AUTO,
      title:
        run.customer?.status === "ambiguous"
          ? "The consignee matches more than one customer."
          : "The customer could not be identified.",
      text: `${first.reasons[0] ?? ""} Without a customer no rules could be applied, so Nova routed this document to human review.`,
      action: run.extraction
        ? { label: "View consignee", target: fieldAnchor("consignee_name") }
        : undefined,
    };
  }
  if (first?.kind === "rules") {
    return {
      tone: "warning",
      icon: "alert",
      eyebrow: NOT_AUTO,
      title: `No customer rules are configured for ${customer}.`,
      text: "Compliance could not be checked automatically, so Nova routed this document to human review.",
    };
  }

  const fields = issues.filter((i) => i.field);
  const target = fields[0]?.field;
  return {
    tone: "warning",
    icon: "alert",
    eyebrow: NOT_AUTO,
    title: "Automatic compliance could not be established.",
    text:
      fields.length > 0
        ? `${plural(fields.length, "field")} ${
            fields.length === 1 ? "requires" : "require"
          } human verification, so Nova routed this document to review instead of approving it automatically.`
        : run.decision.reasoning,
    body: fields.length > 0 && (
      <>
        <FieldIssues run={run} issues={fields} />
        {counts.mismatch > 0 && (
          <p className="dd-summary-note">
            <Icon name="info" size={14} />
            {plural(counts.mismatch, "customer rule")} also did not match.
          </p>
        )}
      </>
    ),
    action: target
      ? {
          label: "View exceptions",
          target:
            run.extraction && fieldReasons(run, target).length > 0
              ? fieldAnchor(target)
              : ruleAnchor(target),
        }
      : undefined,
  };
}

export function DecisionSummary({ run, issues }: { run: RunView; issues: Issue[] }) {
  const s = summarize(run, issues);
  const action = s.action;
  return (
    <section
      className={`dd-summary tone-${s.tone}`}
      aria-labelledby="dd-summary-title"
      aria-live="polite"
    >
      <span className="dd-summary-icon" aria-hidden="true">
        {s.icon === "spinner" ? (
          <span className="spinner" />
        ) : (
          <Icon name={s.icon} size={20} strokeWidth={2} />
        )}
      </span>
      <div className="dd-summary-body">
        <p className="dd-summary-eyebrow">{s.eyebrow}</p>
        <h2 className="dd-summary-title" id="dd-summary-title">
          {s.title}
        </h2>
        {s.text && <p className="dd-summary-text">{s.text}</p>}
        {s.body}
      </div>
      {action && (
        <div className="dd-summary-actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => jumpTo(action.target)}
          >
            {action.label}
            <Icon name="chevronDown" size={14} />
          </button>
        </div>
      )}
    </section>
  );
}
