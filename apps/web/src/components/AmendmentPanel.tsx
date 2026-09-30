import { useEffect, useState } from "react";
import type { RunView } from "../api.js";
import { issueComparison, plural, type Issue } from "../domain.js";
import { Icon } from "./Icon.js";

export function Comparison({ found, expected }: { found: string; expected: string }) {
  return (
    <span className="dd-compare">
      <span className="dd-compare-found">
        <span className="sr-only">Found </span>
        {found}
      </span>
      <Icon name="arrowRight" size={13} className="dd-compare-arrow" />
      <span className="dd-compare-expected">
        <span className="sr-only">, expected </span>
        {expected}
      </span>
    </span>
  );
}

type CopyState = "idle" | "copied" | "failed";

function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<CopyState>("idle");

  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(timer);
  }, [state]);

  function fallbackCopy() {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    setState(ok ? "copied" : "failed");
  }

  function copy() {
    if (!navigator.clipboard) return fallbackCopy();
    navigator.clipboard.writeText(text).then(() => setState("copied"), fallbackCopy);
  }

  return (
    <>
      <button type="button" className="btn btn-secondary btn-sm" onClick={copy}>
        <Icon name={state === "copied" ? "check" : "copy"} size={14} />
        {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy"}
      </button>
      <span className="sr-only" aria-live="polite">
        {state === "copied"
          ? "Amendment request copied to clipboard"
          : state === "failed"
            ? "Could not copy to clipboard"
            : ""}
      </span>
    </>
  );
}

export function AmendmentPanel({ run, issues }: { run: RunView; issues: Issue[] }) {
  const draft = run.decision?.amendmentDraft ?? null;
  const customer = run.customer?.status === "resolved" ? run.customer.name : null;

  return (
    <section
      id="amendment"
      tabIndex={-1}
      className="panel dd-amendment tone-danger"
      aria-labelledby="dd-amendment-title"
    >
      <div className="panel-header">
        <div>
          <h2 className="panel-title" id="dd-amendment-title">
            Amendment required
          </h2>
          <p className="panel-subtitle">
            {plural(issues.length, "value")} must be corrected
            {customer ? ` to meet ${customer}'s rules` : ""}.
          </p>
        </div>
      </div>
      <div className="panel-body dd-amendment-body">
        {issues.length > 0 && (
          <ul className="dd-amend-list">
            {issues.map((issue) => {
              const { found, expected } = issueComparison(run, issue);
              return (
                <li key={issue.field ?? issue.title}>
                  <span className="dd-amend-field">{issue.title}</span>
                  <Comparison found={found} expected={expected} />
                </li>
              );
            })}
          </ul>
        )}
        {draft ? (
          <div className="dd-draft">
            <div className="dd-draft-head">
              <span className="dd-draft-label">Suggested request</span>
              <CopyButton text={draft} />
            </div>
            <pre className="dd-draft-text">{draft}</pre>
          </div>
        ) : (
          <p className="text-muted text-sm">No amendment draft was generated for this document.</p>
        )}
      </div>
    </section>
  );
}
