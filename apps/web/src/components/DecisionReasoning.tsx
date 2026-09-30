import { REQUIRED_FIELDS } from "@nova/contracts";
import type { RunView } from "../api.js";
import {
  countValidations,
  fieldLabel,
  formatFieldValue,
  isFinal,
  issueComparison,
  plural,
  reasonPhrases,
  type Issue,
} from "../domain.js";
import { Icon } from "./Icon.js";
import { DecisionBadge } from "./StatusBadge.js";

export function reasonSentence(run: RunView, issues: Issue[]): string | null {
  if (!run.decision) return run.error?.message ?? null;
  const first = issues[0];
  if (!first) {
    return run.decision.decision === "auto_approve"
      ? `All ${plural(run.validations.length, "configured rule")} matched and every required field was read reliably.`
      : null;
  }
  if (first.kind === "field") {
    const parts = issues.map((i) => {
      const extracted = i.field && run.extraction ? run.extraction[i.field] : null;
      return `${i.title}: ${reasonPhrases(i.reasons, extracted).join(", ")}`;
    });
    return `${parts.join("; ")}.`;
  }
  if (first.kind === "mismatch") {
    const parts = issues.map((i) => {
      const { found, expected } = issueComparison(run, i);
      return `${i.title}: found ${found}, expected ${expected}`;
    });
    return `${parts.join("; ")}.`;
  }
  return first.reasons[0] ?? first.title;
}

function CustomerFact({ customer }: { customer: RunView["customer"] }) {
  if (!customer) return <span className="text-muted">Not resolved</span>;
  const resolved = customer.status === "resolved";
  return (
    <>
      {resolved ? (
        (customer.name ?? "Resolved")
      ) : (
        <span className="text-warning">
          {customer.status === "ambiguous" ? "Ambiguous match" : "Not identified"}
        </span>
      )}
      {customer.reason && <span className="dd-kv-sub">{customer.reason}</span>}
    </>
  );
}

const countClass = (n: number, tone: string) => (n > 0 ? `tabular text-${tone}` : "tabular");

export function DecisionReasoning({ run, issues }: { run: RunView; issues: Issue[] }) {
  const final = isFinal(run.status);
  const ex = run.extraction;
  const found = ex ? REQUIRED_FIELDS.filter((f) => formatFieldValue(ex[f]) !== null).length : 0;
  const counts = countValidations(run.validations);
  const hasRules = run.validations.length > 0;
  const uncovered = hasRules
    ? REQUIRED_FIELDS.filter((f) => !run.validations.some((v) => v.field === f)).map(fieldLabel)
    : [];
  const reason = reasonSentence(run, issues);

  return (
    <section className="panel dd-reasoning" aria-labelledby="dd-reasoning-title">
      <div className="panel-header">
        <h2 className="panel-title" id="dd-reasoning-title">
          Decision reasoning
        </h2>
      </div>
      <div className="panel-body">
        {!final ? (
          <p className="text-muted text-sm">Available once processing completes.</p>
        ) : (
          <>
            <dl className="kv dd-kv">
              <dt>Customer</dt>
              <dd>
                <CustomerFact customer={run.customer} />
              </dd>
              <dt>Required fields</dt>
              <dd>
                {ex ? (
                  `${found} / ${REQUIRED_FIELDS.length} extracted`
                ) : run.status === "FAILED" ? (
                  <span className="text-muted">Not available</span>
                ) : (
                  <span className="text-danger">Extraction failed</span>
                )}
              </dd>
              <dt>Configured rules</dt>
              <dd>
                {hasRules ? (
                  <span className="tabular">{run.validations.length}</span>
                ) : (
                  <span className="text-muted">
                    {run.customer?.status === "resolved" ? "None configured" : "Not applied"}
                  </span>
                )}
              </dd>
              {hasRules && (
                <>
                  <dt>Matched</dt>
                  <dd className={countClass(counts.match, "success")}>{counts.match}</dd>
                  <dt>Uncertain</dt>
                  <dd className={countClass(counts.uncertain, "warning")}>{counts.uncertain}</dd>
                  <dt>Mismatched</dt>
                  <dd className={countClass(counts.mismatch, "danger")}>{counts.mismatch}</dd>
                </>
              )}
              {uncovered.length > 0 && (
                <>
                  <dt>Not covered by rules</dt>
                  <dd className="text-secondary">{uncovered.join(", ")}</dd>
                </>
              )}
              <dt>Final decision</dt>
              <dd>
                {run.decision ? (
                  <DecisionBadge decision={run.decision.decision} size="sm" />
                ) : (
                  <span className="text-danger">No decision recorded</span>
                )}
              </dd>
              {reason && (
                <>
                  <dt>Reason</dt>
                  <dd>{reason}</dd>
                </>
              )}
            </dl>
            {run.decision?.reasoning && (
              <details className="dd-disclosure">
                <summary>
                  <Icon name="chevronRight" size={14} />
                  Full pipeline reasoning
                </summary>
                <p>{run.decision.reasoning}</p>
              </details>
            )}
          </>
        )}
      </div>
    </section>
  );
}
