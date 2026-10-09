import type {
  RuleOperator,
  ValidationResult,
  ValidationStatus,
} from "../../../../packages/contracts/src/index.js";
import type { RunView } from "../api.js";
import {
  countValidations,
  fieldLabel,
  formatExpected,
  formatFound,
  isFinal,
  plural,
  reasonPhrases,
  stageIndex,
  VALIDATION,
  type ExtractedField,
} from "../domain.js";
import { EmptyState } from "./EmptyState.js";
import { AnchorLink, fieldAnchor, ruleAnchor } from "./ExtractionGrid.js";
import { Icon, type IconName } from "./Icon.js";
import { SectionHeader } from "./PageHeader.js";
import { Badge, ValidationBadge } from "./StatusBadge.js";

const ORDER: Record<ValidationStatus, number> = { mismatch: 0, uncertain: 1, match: 2 };

const STATUS_ICON: Record<ValidationStatus, IconName> = {
  match: "checkCircle",
  mismatch: "xCircle",
  uncertain: "alert",
};

const OPERATOR_HINT: Record<RuleOperator, string> = {
  EXACT: "Must equal the expected value",
  MAX: "Must not exceed the maximum",
  MIN: "Must be at least the minimum",
  RANGE: "Must fall within the range",
};

export function ValidationRule({
  validation: v,
  anchorId,
  extracted,
}: {
  validation: ValidationResult;
  anchorId?: string;
  extracted: ExtractedField | null;
}) {
  const reason =
    v.status === "uncertain"
      ? `Not checked, the value is not reliable enough: ${reasonPhrases([v.reason], extracted).join(" · ")}`
      : v.status === "mismatch" && v.ruleOperator !== "EXACT"
        ? v.reason.replace(/\.$/, "")
        : null;

  return (
    <li
      id={anchorId}
      tabIndex={anchorId ? -1 : undefined}
      className={`dd-rule is-${v.status} tone-${VALIDATION[v.status].tone}`}
    >
      <span className="dd-rule-icon" aria-hidden="true">
        <Icon name={STATUS_ICON[v.status]} size={18} strokeWidth={2} />
      </span>
      <div className="dd-rule-field">
        <span className="dd-rule-name">{fieldLabel(v.field)}</span>
        {v.ruleOperator && (
          <span className="dd-op" title={OPERATOR_HINT[v.ruleOperator]}>
            {v.ruleOperator}
          </span>
        )}
      </div>
      <dl className="dd-rule-values">
        <div>
          <dt>Found</dt>
          <dd className="dd-rule-found">{formatFound(v, extracted)}</dd>
        </div>
        <div>
          <dt>Expected</dt>
          <dd>{formatExpected(v)}</dd>
        </div>
      </dl>
      <span className="dd-rule-status">
        <ValidationBadge status={v.status} />
      </span>
      {v.status !== "match" && (reason || extracted) && (
        <p className="dd-rule-reason">
          {reason && <span>{reason}</span>}
          {extracted && (
            <AnchorLink target={fieldAnchor(v.field)} className="dd-jump">
              View extraction
            </AnchorLink>
          )}
        </p>
      )}
    </li>
  );
}

function EmptyReason({ run }: { run: RunView }) {
  if (!isFinal(run.status)) {
    const extracted = stageIndex(run.currentStage) >= stageIndex("EXTRACTED");
    return (
      <EmptyState
        icon="clock"
        title={extracted ? "Validating customer rules…" : "Waiting for extraction"}
        compact
      >
        {extracted
          ? "Nova is resolving the customer and checking the extracted fields against their rules."
          : "Customer rules are checked once the document's fields have been extracted."}
      </EmptyState>
    );
  }
  if (run.status === "FAILED") {
    return (
      <EmptyState icon="xCircle" title="Validation did not complete" compact>
        Processing failed before customer rules were checked.
      </EmptyState>
    );
  }
  if (!run.extraction) {
    return (
      <EmptyState icon="minusCircle" title="Validation did not run" compact>
        Customer rules are checked against extracted fields, and extraction failed for this
        document.
      </EmptyState>
    );
  }
  const customer = run.customer;
  if (!customer || customer.status !== "resolved") {
    return (
      <EmptyState
        icon="user"
        title={
          customer?.status === "ambiguous" ? "Customer is ambiguous" : "Customer not identified"
        }
        compact
      >
        {customer?.reason ? `${customer.reason} ` : ""}
        Rules can only be applied once the consignee resolves to a single configured customer.
      </EmptyState>
    );
  }
  return (
    <EmptyState
      icon="rules"
      title={`No rules configured for ${customer.name ?? "this customer"}`}
      compact
    >
      There are no active validation rules for this customer, so compliance could not be checked
      automatically.
    </EmptyState>
  );
}

export function ValidationList({ run }: { run: RunView }) {
  const counts = countValidations(run.validations);
  const total = run.validations.length;
  const customer = run.customer?.status === "resolved" ? (run.customer.name ?? "Customer") : null;
  const sorted = [...run.validations].sort((a, b) => ORDER[a.status] - ORDER[b.status]);
  const anchored = new Set<string>();

  const subtitle = !isFinal(run.status)
    ? "Runs after extraction"
    : customer
      ? `${customer} · ${total ? plural(total, "configured rule") : "no rules configured"}`
      : "No customer resolved";

  return (
    <section className="section" aria-labelledby="dd-validation-title">
      <SectionHeader
        id="dd-validation-title"
        title="Customer Rule Validation"
        subtitle={subtitle}
        actions={
          total > 0 && (
            <>
              {counts.mismatch > 0 && (
                <Badge tone="danger" size="sm">
                  {counts.mismatch} mismatched
                </Badge>
              )}
              {counts.uncertain > 0 && (
                <Badge tone="warning" size="sm">
                  {counts.uncertain} uncertain
                </Badge>
              )}
              {counts.match > 0 && (
                <Badge tone="success" size="sm">
                  {counts.match} matched
                </Badge>
              )}
            </>
          )
        }
      />
      <div className="panel dd-rules-panel">
        {total > 0 ? (
          <ul className="dd-rules">
            {sorted.map((v, i) => {
              const anchorId = anchored.has(v.field) ? undefined : ruleAnchor(v.field);
              anchored.add(v.field);
              return (
                <ValidationRule
                  key={v.ruleId ?? `${v.field}-${i}`}
                  validation={v}
                  anchorId={anchorId}
                  extracted={run.extraction?.[v.field] ?? null}
                />
              );
            })}
          </ul>
        ) : (
          <EmptyReason run={run} />
        )}
      </div>
    </section>
  );
}
