import { REQUIRED_FIELDS, type ValidationResult } from "@nova/contracts";
import type { RunView } from "./api.js";

const label = (field: string) => field.replaceAll("_", " ");
const pct = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n * 100)}%`);

function expected(v: ValidationResult) {
  const unit = v.unit ? ` ${v.unit}` : "";
  switch (v.ruleOperator) {
    case "MAX":
      return `≤ ${v.expectedMax}${unit}`;
    case "MIN":
      return `≥ ${v.expectedMin}${unit}`;
    case "RANGE":
      return `${v.expectedMin}–${v.expectedMax}${unit}`;
    default:
      return v.expectedText ?? String(v.expectedNumber ?? "—");
  }
}

export function RunDetail({ run, minConfidence }: { run: RunView; minConfidence: number }) {
  const done = run.status === "COMPLETED" || run.status === "FAILED";

  return (
    <section className="card">
      <h2>{run.document.filename}</h2>
      <p className="muted">
        {run.status} · stage {run.currentStage}
        {run.attempts.length > 0 && ` · extraction attempts: ${run.attempts.length}`}
      </p>
      {!done && <p className="pending">Processing… this page updates automatically.</p>}

      {run.decision && (
        <div className={`decision ${run.decision.decision}`}>
          <strong>{label(run.decision.decision).toUpperCase()}</strong>
          <p>{run.decision.reasoning}</p>
          {run.decision.amendmentDraft && <pre>{run.decision.amendmentDraft}</pre>}
        </div>
      )}
      {run.error && (
        <p className="error">
          {run.error.code}: {run.error.message}
        </p>
      )}

      {run.customer && (
        <p>
          <b>Customer:</b> {run.customer.name ?? "—"}{" "}
          <span className={`tag ${run.customer.status}`}>{run.customer.status}</span>{" "}
          <span className="muted">{run.customer.reason}</span>
        </p>
      )}

      {run.extraction && (
        <>
          <h3>Extracted fields</h3>
          <table>
            <thead>
              <tr>
                <th>Field</th>
                <th>Value</th>
                <th>Confidence</th>
                <th>Evidence</th>
              </tr>
            </thead>
            <tbody>
              {REQUIRED_FIELDS.map((field) => {
                const f = run.extraction![field];
                const unit = "unit" in f && f.unit ? ` ${f.unit}` : "";
                const conflict = f.candidates && f.candidates.length > 1;
                return (
                  <tr key={field}>
                    <td>{label(field)}</td>
                    <td className={f.value === null ? "missing" : ""}>
                      {f.value === null ? "not found" : `${f.value}${unit}`}
                      {conflict && (
                        <div className="warn">conflict: {f.candidates!.join(" / ")}</div>
                      )}
                    </td>
                    <td className={f.confidence < minConfidence ? "low" : ""}>
                      {pct(f.confidence)}
                    </td>
                    <td className="muted">{f.evidence ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      {run.validations.length > 0 && (
        <>
          <h3>Validation against customer rules</h3>
          <table>
            <thead>
              <tr>
                <th>Field</th>
                <th>Result</th>
                <th>Found</th>
                <th>Expected</th>
                <th>Confidence</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {run.validations.map((v) => (
                <tr key={v.ruleId ?? v.field}>
                  <td>{label(v.field)}</td>
                  <td>
                    <span className={`tag ${v.status}`}>{v.status}</span>
                  </td>
                  <td>
                    {v.foundText ??
                      (v.foundNumber != null ? `${v.foundNumber} ${v.unit ?? ""}` : "—")}
                  </td>
                  <td>{expected(v)}</td>
                  <td>{pct(v.confidence)}</td>
                  <td className="muted">{v.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
