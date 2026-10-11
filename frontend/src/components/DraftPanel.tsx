import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { api } from "../api.js";
import { formatDateTime } from "../domain.js";
import { putDraft, refreshSentEmails, useSentEmails } from "../shipmentData.js";
import {
  draftEdits,
  isDraftDirty,
  isProcessing,
  outboundKindMeta,
  sendFailure,
  type DraftEdits,
} from "../shipmentDomain.js";
import { Link } from "../router.js";
import type { ShipmentView } from "../types/api.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { Icon } from "./Icon.js";
import { SectionHeader } from "./PageHeader.js";
import { Badge } from "./StatusBadge.js";

export type DraftPanelHandle = { requestSend: () => void };

type SaveState = "idle" | "saving" | "failed";

function SentReplies({ view }: { view: ShipmentView }) {
  const { sent } = useSentEmails();
  if (view.sent.length === 0) return null;
  return (
    <ul className="sd-sent">
      {view.sent.map((ref) => {
        const full = sent?.find((s) => s.id === ref.id);
        return (
          <li key={ref.id} className="panel sd-sent-item">
            <div className="sd-sent-head">
              <Badge tone={outboundKindMeta(ref.kind).tone} icon={null} size="sm">
                {outboundKindMeta(ref.kind).label}
              </Badge>
              <Badge tone="success" size="sm">
                Sent (simulated)
              </Badge>
              <time dateTime={ref.sentAt} className="text-muted text-sm">
                {formatDateTime(ref.sentAt)}
              </time>
              <Link to={`/sent-emails?open=${encodeURIComponent(ref.id)}`} className="link-button">
                View in Sent emails
                <Icon name="arrowRight" size={13} />
              </Link>
            </div>
            <dl className="kv sd-sent-kv">
              <dt>To</dt>
              <dd>{ref.to}</dd>
              <dt>Subject</dt>
              <dd>{ref.subject}</dd>
            </dl>
            {full && <pre className="sd-sent-body">{full.body}</pre>}
          </li>
        );
      })}
    </ul>
  );
}

export function DraftPanel({
  view,
  reload,
  onReviewIncomplete,
  ref,
}: {
  view: ShipmentView;
  reload: () => Promise<void>;
  onReviewIncomplete: () => void;
  ref?: Ref<DraftPanelHandle>;
}) {
  const draft = view.draft;
  const [edits, setEdits] = useState<DraftEdits | null>(draft ? draftEdits(draft) : null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const sendingRef = useRef(false);
  const sectionRef = useRef<HTMLElement>(null);

  // A regenerated draft (new version) replaces whatever is being edited.
  const identity = draft ? `${draft.id}:${draft.version}` : null;
  useEffect(() => {
    setEdits(draft ? draftEdits(draft) : null);
    setSaveError(null);
  }, [identity]);

  const dirty = !!draft && !!edits && isDraftDirty(draft, edits);

  async function persist(next: DraftEdits): Promise<boolean> {
    if (!draft) return false;
    setSaveState("saving");
    setSaveError(null);
    try {
      putDraft(view.id, await api.saveDraft(view.id, { version: draft.version, ...next }));
      setSaveState("idle");
      return true;
    } catch (err) {
      setSaveState("failed");
      setSaveError((err as Error).message);
      return false;
    }
  }

  async function requestSend() {
    if (!draft?.canSend || sendingRef.current) return;
    setSendError(null);
    setNotice(null);
    sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (dirty && edits && !(await persist(edits))) return;
    setConfirmOpen(true);
  }

  useImperativeHandle(ref, () => ({ requestSend: () => void requestSend() }));

  async function confirmSend() {
    if (!draft || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setSendError(null);
    try {
      await api.sendDraft(view.id, draft.version);
      setConfirmOpen(false);
      await reload();
      void refreshSentEmails();
    } catch (err) {
      const code = (err as { code?: string | null }).code ?? null;
      const failure = sendFailure(code);
      if (failure.action === "show") {
        setSendError((err as Error).message);
      } else {
        setConfirmOpen(false);
        setNotice(failure.message ?? (err as Error).message);
        if (failure.action === "reload") await reload();
        else onReviewIncomplete();
      }
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  const kind = draft ? outboundKindMeta(draft.kind) : null;
  const processing = isProcessing(view.status);

  return (
    <section
      className="section sd-draft"
      id="sd-draft"
      ref={sectionRef}
      aria-labelledby="sd-draft-title"
    >
      <SectionHeader
        id="sd-draft-title"
        title="Reply to supplier"
        subtitle="Nothing is sent until you send it. Sending is simulated: no real email leaves the system."
        actions={
          kind && (
            <Badge tone={kind.tone} icon={null}>
              {kind.label}
            </Badge>
          )
        }
      />

      {notice && (
        <div className="callout tone-warning sd-notice" role="alert">
          <Icon name="alert" size={16} />
          <span>{notice}</span>
        </div>
      )}

      {draft && edits ? (
        <div className="panel sd-draft-panel">
          {draft.previousVersionEdited && (
            <div className="callout tone-warning" role="status">
              <Icon name="alert" size={16} />
              <span>
                The draft was regenerated after your last decision; your earlier edits are not in
                this version.
              </span>
            </div>
          )}

          <div className="sd-draft-fields">
            <label className="sd-field-label">
              <span>To</span>
              <input
                className="input"
                type="email"
                value={edits.to}
                onChange={(e) => setEdits({ ...edits, to: e.target.value })}
                onBlur={() => dirty && void persist(edits)}
              />
            </label>
            <label className="sd-field-label">
              <span>Subject</span>
              <input
                className="input"
                value={edits.subject}
                onChange={(e) => setEdits({ ...edits, subject: e.target.value })}
                onBlur={() => dirty && void persist(edits)}
              />
            </label>
            <label className="sd-field-label">
              <span className="sd-body-label">
                Message
                {draft.edited && (
                  <Badge size="sm" tone="info" icon={null}>
                    Edited
                  </Badge>
                )}
              </span>
              <textarea
                className="input sd-draft-body"
                value={edits.body}
                rows={14}
                spellCheck={false}
                onChange={(e) => setEdits({ ...edits, body: e.target.value })}
                onBlur={() => dirty && void persist(edits)}
              />
            </label>
          </div>

          <div className="sd-draft-bar">
            <div className="sd-draft-status" role="status">
              {saveState === "saving" ? (
                <>
                  <span className="spinner" aria-hidden="true" /> Saving…
                </>
              ) : saveState === "failed" ? (
                <span className="text-danger">Not saved. {saveError}</span>
              ) : dirty ? (
                <span className="text-muted">Unsaved changes</span>
              ) : (
                <span className="text-muted">Changes are saved when you leave a field.</span>
              )}
            </div>
            <div className="sd-draft-buttons">
              {draft.edited && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    const next = { ...edits, body: draft.generatedBody };
                    setEdits(next);
                    void persist(next);
                  }}
                >
                  <Icon name="refresh" size={13} />
                  Reset to generated
                </button>
              )}
              {!draft.canSend && draft.sendBlockedReason && (
                <span className="sd-blocked">{draft.sendBlockedReason}</span>
              )}
              <button
                type="button"
                className="btn btn-primary"
                disabled={!draft.canSend || saveState === "saving" || sending}
                onClick={() => void requestSend()}
              >
                <Icon name="send" size={15} />
                {draft.kind === "approval" ? "Send approval" : "Send amendment"}
              </button>
            </div>
          </div>

          <ConfirmDialog
            open={confirmOpen}
            title={`Send this ${draft.kind}?`}
            icon="send"
            tone="info"
            errorTitle="Could not send."
            confirmLabel={`Send ${draft.kind}`}
            busyLabel="Sending…"
            busy={sending}
            error={sendError}
            onConfirm={() => void confirmSend()}
            onCancel={() => setConfirmOpen(false)}
          >
            <p>
              Send this {draft.kind} to <strong>{edits.to}</strong>? (Simulated: no real email is
              sent.)
            </p>
            <p className="text-muted">Subject: {edits.subject}</p>
          </ConfirmDialog>
        </div>
      ) : view.sent.length === 0 ? (
        <div className="panel sd-draft-empty">
          <Icon name="mail" size={18} className="text-faint" />
          <p>
            {processing
              ? "The reply is prepared once all attachments have been read."
              : "Make the review decisions above to prepare the reply."}
          </p>
        </div>
      ) : null}

      <SentReplies view={view} />
    </section>
  );
}
