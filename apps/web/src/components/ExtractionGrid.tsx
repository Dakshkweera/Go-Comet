import type { ReactNode } from "react";
import {
  REQUIRED_FIELDS,
  type ExtractionField as FieldKey,
  type ValidationResult,
} from "@nova/contracts";
import type { RunView } from "../api.js";
import {
  candidateList,
  capitalize,
  confidenceSignal,
  fieldLabel,
  formatExpected,
  fieldReasons,
  formatFieldValue,
  hasConflict,
  isFinal,
  minConfidence,
  reasonPhrases,
  type ExtractedField,
  type SignalLevel,
} from "../domain.js";
import { EmptyState } from "./EmptyState.js";
import { Icon } from "./Icon.js";
import { SectionHeader } from "./PageHeader.js";
import { EvidenceBadge, ValidationBadge } from "./StatusBadge.js";

export const fieldAnchor = (field: string) => `field-${field}`;
export const ruleAnchor = (field: string) => `rule-${field}`;

export function jumpTo(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  el.focus({ preventScroll: true });
  el.classList.remove("dd-flash");
  void el.offsetWidth;
  el.classList.add("dd-flash");
  el.addEventListener("animationend", () => el.classList.remove("dd-flash"), { once: true });
}

export function AnchorLink({
  target,
  className,
  children,
}: {
  target: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a
      href={`#${target}`}
      className={className}
      onClick={(e) => {
        e.preventDefault();
        jumpTo(target);
      }}
    >
      {children}
    </a>
  );
}

const SIGNAL: Record<SignalLevel, { bars: number; label: string }> = {
  high: { bars: 3, label: "High" },
  medium: { bars: 2, label: "Medium" },
  low: { bars: 1, label: "Low" },
};

function ConfidenceSignal({ confidence, threshold }: { confidence: number; threshold: number }) {
  const { level, tone } = confidenceSignal(confidence, threshold);
  const raw = confidence.toFixed(2);
  return (
    <span
      className={`dd-signal tone-${tone}`}
      title={`Model confidence signal ${raw}. Not a calibrated probability.`}
    >
      <span className="dd-signal-bars" aria-hidden="true">
        {[1, 2, 3].map((n) => (
          <span key={n} className={n <= SIGNAL[level].bars ? "is-on" : undefined} />
        ))}
      </span>
      <span className="dd-signal-level">{SIGNAL[level].label} confidence</span>
      <span className="dd-signal-raw">{raw}</span>
    </span>
  );
}

// Confidence, evidence status, conflicts and missing evidence already have their own UI on the card.
const SHOWN_ELSEWHERE =
  /^(below confidence|conflicting values|ambiguous source|contradicted|no supporting evidence)/;

export function ExtractionField({
  fieldKey,
  field,
  reasons,
  threshold,
  validation,
  showRule,
}: {
  fieldKey: FieldKey;
  field: ExtractedField;
  reasons: string[];
  threshold: number;
  validation: ValidationResult | null;
  showRule: boolean;
}) {
  const value = formatFieldValue(field);
  const conflict = hasConflict(field);
  const phrases = reasonPhrases(reasons, field).filter((p) => !SHOWN_ELSEWHERE.test(p));
  const flag = reasons.length
    ? { tone: "warning", label: "Needs review" }
    : validation?.status === "mismatch"
      ? { tone: "danger", label: "Rule mismatch" }
      : validation?.status === "uncertain"
        ? { tone: "warning", label: "Rule uncertain" }
        : null;
  const id = fieldAnchor(fieldKey);

  return (
    <article
      id={id}
      tabIndex={-1}
      aria-labelledby={`${id}-label`}
      className={flag ? `dd-field is-flagged tone-${flag.tone}` : "dd-field"}
    >
      <div className="dd-field-head">
        <h3 className="dd-field-label" id={`${id}-label`}>
          {fieldLabel(fieldKey)}
        </h3>
        {flag && (
          <span className="dd-field-flag">
            <Icon name="alert" size={13} strokeWidth={2} />
            {flag.label}
          </span>
        )}
      </div>
      <p className={value === null ? "dd-field-value is-empty" : "dd-field-value"}>
        {value ?? "Not found"}
      </p>
      {conflict && <p className="dd-field-note">Document shows {candidateList(field)}</p>}
      {phrases.length > 0 && <p className="dd-field-note">{phrases.map(capitalize).join(" · ")}</p>}
      {!reasons.length && validation?.status === "mismatch" && (
        <p className="dd-field-note">
          Read correctly, but the document breaks the rule (expected {formatExpected(validation)})
        </p>
      )}
      <div className="dd-field-meta">
        <ConfidenceSignal confidence={field.confidence} threshold={threshold} />
        <EvidenceBadge status={field.evidenceStatus} />
      </div>
      {field.evidence ? (
        <blockquote className="dd-evidence">{field.evidence}</blockquote>
      ) : (
        <p className="dd-evidence is-empty">No source text captured</p>
      )}
      {showRule && (
        <div className="dd-field-rule">
          {validation ? (
            <>
              <span>Customer rule</span>
              <ValidationBadge status={validation.status} />
              <AnchorLink target={ruleAnchor(fieldKey)} className="dd-jump">
                View rule
              </AnchorLink>
            </>
          ) : (
            <span className="text-faint">Not covered by a customer rule</span>
          )}
        </div>
      )}
    </article>
  );
}

export function ExtractionGrid({ run }: { run: RunView }) {
  const ex = run.extraction;
  const final = isFinal(run.status);
  const rules = new Map<FieldKey, ValidationResult>();
  for (const v of run.validations) if (!rules.has(v.field)) rules.set(v.field, v);

  let subtitle = final ? "Extraction did not produce a result" : "Reading the document…";
  if (ex) {
    const found = REQUIRED_FIELDS.filter((f) => formatFieldValue(ex[f]) !== null).length;
    const flagged = REQUIRED_FIELDS.filter((f) => fieldReasons(run, f).length > 0).length;
    subtitle = `${found} of ${REQUIRED_FIELDS.length} required fields found · ${
      flagged ? `${flagged} flagged for review` : "all read reliably"
    }`;
  }

  return (
    <section className="section" aria-labelledby="dd-extraction-title">
      <SectionHeader id="dd-extraction-title" title="Extracted Information" subtitle={subtitle} />
      {ex ? (
        <>
          <p className="dd-legend">
            <Icon name="info" size={14} />
            Confidence shows how reliably each value was read from the document, not whether it
            meets customer rules. It is a model signal, not a probability; fields below{" "}
            {minConfidence(run).toFixed(2)} are sent to review.
          </p>
          <div className="dd-fields">
            {REQUIRED_FIELDS.map((key) => (
              <ExtractionField
                key={key}
                fieldKey={key}
                field={ex[key]}
                reasons={fieldReasons(run, key)}
                threshold={minConfidence(run)}
                validation={rules.get(key) ?? null}
                showRule={run.validations.length > 0}
              />
            ))}
          </div>
        </>
      ) : !final ? (
        <div className="dd-fields" aria-busy="true">
          {REQUIRED_FIELDS.map((key) => (
            <div key={key} className="dd-field">
              <span className="dd-field-label">{fieldLabel(key)}</span>
              <span className="skeleton dd-skel-value" />
              <span className="skeleton dd-skel-meta" />
            </div>
          ))}
        </div>
      ) : (
        <div className="panel">
          <EmptyState icon="alert" title="No fields were extracted" compact>
            {run.status === "FAILED" || !run.error?.message
              ? "Processing stopped before any fields were extracted."
              : `Extraction failed: ${run.error.message}`}
          </EmptyState>
        </div>
      )}
    </section>
  );
}
