import { useState, type FormEvent } from "react";
import { api } from "../api.js";
import { formatDateTime } from "../domain.js";
import { putShipment } from "../shipmentData.js";
import {
  canSubmitClarify,
  clarifyForm,
  RESOLUTION_LABEL,
  reviewGroups,
} from "../shipmentDomain.js";
import type { ExtractionField, ReviewRequest, ShipmentIssue, ShipmentView } from "../types/api.js";
import { Comparison } from "./AmendmentPanel.js";
import { EmptyState } from "./EmptyState.js";
import { Icon } from "./Icon.js";
import { SectionHeader } from "./PageHeader.js";
import { ProgressBar } from "./ProgressBar.js";

type CardProps = {
  issue: ShipmentIssue;
  busy: boolean;
  error: string | null;
  onAct: (body: ReviewRequest) => Promise<boolean>;
  onOpenField: (field: ExtractionField) => void;
  onOpenDocument: (documentId: string) => void;
};

function resolutionText(issue: ShipmentIssue): string {
  const action = issue.resolution?.action;
  if (action === "clarify" && issue.severity === "amendment") {
    return "Waived. This will not be sent to the supplier";
  }
  return action ? RESOLUTION_LABEL[action] : "";
}

function IssueCard({ issue, busy, error, onAct, onOpenField, onOpenDocument }: CardProps) {
  const clarify = clarifyForm(issue);
  const resolution = issue.resolution;
  const isReview = issue.severity === "review";
  const canAmend = issue.allowedActions.includes("amend");
  const [formOpen, setFormOpen] = useState(false);
  const [changing, setChanging] = useState(false);
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const showActions = !resolution || changing;
  const tone = isReview ? "warning" : "danger";

  function openForm() {
    setValue(resolution?.value ?? clarify?.prefill ?? "");
    setNote(resolution?.note ?? "");
    setFormOpen(true);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!clarify || !canSubmitClarify(clarify, value, note) || busy) return;
    const ok = await onAct({
      issueKey: issue.key,
      action: "clarify",
      ...(clarify.showValue && value.trim() ? { value: value.trim() } : {}),
      ...(clarify.showNote && note.trim() ? { note: note.trim() } : {}),
    });
    if (ok) {
      setFormOpen(false);
      setChanging(false);
    }
  }

  async function amend() {
    if (await onAct({ issueKey: issue.key, action: "amend" })) setChanging(false);
  }

  return (
    <li className={`sd-issue tone-${tone}${resolution ? " is-resolved" : ""}`}>
      <div className="sd-issue-head">
        <h4 className="sd-issue-title">{issue.fieldLabel ?? "Attachment"}</h4>
        <span className="sd-issue-docs">
          {issue.documents.map((d) => (
            <button
              key={d.id}
              type="button"
              className="sd-doc-chip"
              onClick={() => onOpenDocument(d.id)}
              title="Open original"
            >
              <Icon name="file" size={12} />
              {d.filename}
            </button>
          ))}
        </span>
        {issue.field && (
          <button
            type="button"
            className="link-button sd-issue-details"
            onClick={() => onOpenField(issue.field!)}
          >
            Details
            <Icon name="chevronRight" size={13} />
          </button>
        )}
      </div>

      <p className="sd-issue-message">{issue.message}</p>

      {issue.found && (
        <p className="sd-issue-compare">
          {issue.expected ? (
            <Comparison found={issue.found} expected={issue.expected} />
          ) : (
            <>
              <span className="text-muted">Found</span> <span className="mono">{issue.found}</span>
            </>
          )}
        </p>
      )}

      {(!isReview || canAmend) && (
        <div className="sd-request">
          <span className="sd-request-label">Wording in the reply to the supplier</span>
          <p>{issue.request}</p>
        </div>
      )}

      {resolution && !changing && (
        <div className="sd-resolution">
          <Icon name="checkCircle" size={15} />
          <div>
            <p className="sd-resolution-title">{resolutionText(issue)}</p>
            <p className="sd-resolution-detail">
              {resolution.value && (
                <>
                  Value checked: <span className="mono">{resolution.value}</span>
                  {" · "}
                </>
              )}
              {resolution.note && <>“{resolution.note}” · </>}
              <time dateTime={resolution.at}>{formatDateTime(resolution.at)}</time>
            </p>
          </div>
          <button type="button" className="link-button" onClick={() => setChanging(true)}>
            Change decision
          </button>
        </div>
      )}

      {showActions && !formOpen && (
        <div className="sd-issue-actions">
          {clarify && (
            <button
              type="button"
              className={isReview ? "btn btn-secondary btn-sm" : "btn btn-ghost btn-sm"}
              onClick={openForm}
              disabled={busy}
            >
              {isReview ? "I checked the original and it's fine" : "Waive"}
            </button>
          )}
          {isReview && canAmend && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={amend}
              disabled={busy}
            >
              {busy && <span className="spinner" aria-hidden="true" />}
              Ask the supplier to fix this
            </button>
          )}
          {changing && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setChanging(false)}
            >
              Keep current decision
            </button>
          )}
        </div>
      )}

      {formOpen && clarify && (
        <form className="sd-clarify" onSubmit={submit}>
          {clarify.showValue && (
            <label className="sd-field-label">
              <span>
                Value on the original document{" "}
                <span className="text-muted">
                  ({clarify.valueRequired ? "required" : "optional"})
                </span>
              </span>
              <input
                className="input"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={
                  issue.field === "gross_weight" ? "e.g. 900 kg" : "What the document says"
                }
                autoFocus
              />
            </label>
          )}
          {clarify.showNote && (
            <label className="sd-field-label">
              <span>
                Note{" "}
                <span className="text-muted">
                  ({clarify.noteRequired ? "required" : "optional"})
                </span>
              </span>
              <input
                className="input"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Why this is fine"
                autoFocus={!clarify.showValue}
              />
            </label>
          )}
          <div className="sd-issue-actions">
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={busy || !canSubmitClarify(clarify, value, note)}
            >
              {busy && <span className="spinner" aria-hidden="true" />}
              {isReview ? "Confirm it's fine" : "Waive this correction"}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setFormOpen(false)}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && (
        <p className="sd-issue-error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

function Group({
  title,
  hint,
  issues,
  cardProps,
}: {
  title: string;
  hint: string;
  issues: ShipmentIssue[];
  cardProps: (issue: ShipmentIssue) => CardProps;
}) {
  if (issues.length === 0) return null;
  return (
    <div className="sd-group">
      <h3 className="sd-group-title">{title}</h3>
      <p className="sd-group-hint">{hint}</p>
      <ul className="sd-issues">
        {issues.map((issue) => (
          <IssueCard key={issue.key} {...cardProps(issue)} />
        ))}
      </ul>
    </div>
  );
}

export function ReviewPanel({
  view,
  onOpenField,
  onOpenDocument,
}: {
  view: ShipmentView;
  onOpenField: (field: ExtractionField) => void;
  onOpenDocument: (documentId: string) => void;
}) {
  const groups = reviewGroups(view);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

  async function act(body: ReviewRequest): Promise<boolean> {
    if (busyKey) return false;
    setBusyKey(body.issueKey);
    setErrors((e) => ({ ...e, [body.issueKey]: "" }));
    try {
      const next = await api.review(view.id, body);
      putShipment(next);
      if (next.stage !== view.stage)
        setNotice(`Intake complete, validation done. ${next.headline}`);
      return true;
    } catch (err) {
      setErrors((e) => ({ ...e, [body.issueKey]: (err as Error).message }));
      return false;
    } finally {
      setBusyKey(null);
    }
  }

  const cardProps = (issue: ShipmentIssue): CardProps => ({
    issue,
    busy: busyKey === issue.key,
    error: errors[issue.key] || null,
    onAct: act,
    onOpenField,
    onOpenDocument,
  });

  const total = groups.decisions.length;
  const empty =
    groups.decisions.length === 0 && groups.outgoing.length === 0 && groups.earlier.length === 0;

  return (
    <section className="section sd-review" id="sd-review" aria-labelledby="sd-review-title">
      <SectionHeader
        id="sd-review-title"
        title="Review"
        subtitle={
          total > 0
            ? `${groups.decided} of ${total} ${total === 1 ? "decision" : "decisions"} made`
            : undefined
        }
      />
      <div className="panel sd-review-panel">
        {notice && (
          <div className="callout tone-success sd-notice" role="status">
            <Icon name="checkCircle" size={16} />
            <span>{notice}</span>
            <button type="button" className="link-button" onClick={() => setNotice(null)}>
              Dismiss
            </button>
          </div>
        )}

        {total > 0 && (
          <ProgressBar
            percent={Math.round((groups.decided / total) * 100)}
            label="Review decisions made"
          />
        )}

        {empty ? (
          <EmptyState compact icon="checkCircle" title="Nothing needs your attention">
            No issues were found for this shipment.
          </EmptyState>
        ) : (
          <>
            <Group
              title="Needs your decision"
              hint="Nova could not settle these on its own. Check the original document, then decide."
              issues={groups.decisions}
              cardProps={cardProps}
            />
            <Group
              title="Will be sent to supplier"
              hint="These are in the reply draft. Waive one only if you have a reason."
              issues={groups.outgoing}
              cardProps={cardProps}
            />
            {groups.earlier.length > 0 && (
              <details className="sd-earlier">
                <summary>
                  <Icon name="chevronRight" size={14} />
                  Earlier stage ({groups.earlier.length})
                </summary>
                <ul className="sd-issues">
                  {groups.earlier.map((issue) => (
                    <IssueCard key={issue.key} {...cardProps(issue)} />
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </div>
    </section>
  );
}
