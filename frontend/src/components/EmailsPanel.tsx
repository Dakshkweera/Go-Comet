import { useState } from "react";
import { api } from "../api.js";
import { formatBytes, formatDateTime } from "../domain.js";
import { putShipment } from "../shipmentData.js";
import {
  docStatusMeta,
  DOC_TYPE_OPTIONS,
  documentTypeLabel,
  emailDocuments,
} from "../shipmentDomain.js";
import type { ShipmentDocument, ShipmentEmail, ShipmentView } from "../types/api.js";
import { Icon } from "./Icon.js";
import { SectionHeader } from "./PageHeader.js";
import { Badge } from "./StatusBadge.js";

function AttachmentRow({
  doc,
  shipmentId,
  onOpen,
}: {
  doc: ShipmentDocument;
  shipmentId: string;
  onOpen: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = docStatusMeta(doc.status);
  const canRetype = doc.current && doc.status === "extracted";

  async function retype(docType: string) {
    if (busy || docType === doc.docType) return setEditing(false);
    setBusy(true);
    setError(null);
    try {
      putShipment(await api.setDocumentType(shipmentId, doc.id, docType));
      setEditing(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={doc.current ? "sd-att" : "sd-att is-previous"}>
      <span className="sd-att-icon" aria-hidden="true">
        <Icon name="file" size={16} />
      </span>
      <div className="sd-att-main">
        <p className="sd-att-name">
          <span className="sd-att-filename">{doc.filename}</span>
          <span className="sd-att-size">{formatBytes(doc.size)}</span>
        </p>
        <p className="sd-att-tags">
          <Badge
            size="sm"
            tone={doc.docType === "OTHER" ? "warning" : "neutral"}
            icon={null}
            title={doc.docTypeReason ?? undefined}
          >
            {documentTypeLabel(doc)}
          </Badge>
          {doc.status !== "extracted" && (
            <Badge size="sm" tone={status.tone} icon={null}>
              {status.label}
            </Badge>
          )}
          {doc.unchangedFromCycle !== null && (
            <Badge size="sm" tone="info" icon={null}>
              Unchanged from cycle {doc.unchangedFromCycle}
            </Badge>
          )}
          {!doc.current && (
            <Badge size="sm" tone="neutral" icon={null}>
              Previous version
            </Badge>
          )}
        </p>
        {doc.error && <p className="sd-att-error">{doc.error.message}</p>}
        {error && (
          <p className="sd-att-error" role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="sd-att-actions">
        {editing ? (
          <>
            <select
              className="select sd-type-select"
              aria-label={`Document type for ${doc.filename}`}
              value={doc.docType ?? ""}
              disabled={busy}
              onChange={(e) => void retype(e.target.value)}
            >
              {doc.docType === null && <option value="">Choose a type</option>}
              {DOC_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setEditing(false)}
              disabled={busy}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            {canRetype && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setEditing(true)}
              >
                Change type
              </button>
            )}
            <button type="button" className="btn btn-secondary btn-sm" onClick={onOpen}>
              <Icon name="external" size={13} />
              Open original
            </button>
          </>
        )}
      </div>
    </li>
  );
}

function EmailCard({
  email,
  view,
  onOpenDocument,
}: {
  email: ShipmentEmail;
  view: ShipmentView;
  onOpenDocument: (documentId: string) => void;
}) {
  const documents = emailDocuments(view, email);
  return (
    <article className="panel sd-email">
      <header className="sd-email-head">
        <span className="sd-email-from">
          <Icon name="mail" size={15} className="text-faint" />
          {email.from}
        </span>
        <span className="sd-email-meta">
          {view.cycle > 1 && (
            <Badge size="sm" tone="neutral" icon={null}>
              Cycle {email.cycle}
            </Badge>
          )}
          <time dateTime={email.receivedAt}>{formatDateTime(email.receivedAt)}</time>
        </span>
      </header>
      <div className="sd-email-body" role="region" aria-label="Email message" tabIndex={0}>
        {email.bodyText.trim() || "This email has no message text."}
      </div>
      {documents.length > 0 ? (
        <ul className="sd-atts" aria-label="Attachments">
          {documents.map((doc) => (
            <AttachmentRow
              key={doc.id}
              doc={doc}
              shipmentId={view.id}
              onOpen={() => onOpenDocument(doc.id)}
            />
          ))}
        </ul>
      ) : (
        <p className="sd-email-empty">No attachments in this email.</p>
      )}
    </article>
  );
}

export function EmailsPanel({
  view,
  onOpenDocument,
}: {
  view: ShipmentView;
  onOpenDocument: (documentId: string) => void;
}) {
  const emails = [...view.emails].sort((a, b) => b.cycle - a.cycle);
  return (
    <section className="section" aria-labelledby="sd-emails-title">
      <SectionHeader
        id="sd-emails-title"
        title="Email and attachments"
        subtitle={
          view.cycle > 1
            ? `The supplier replied; the latest cycle is shown first.`
            : `From ${view.supplier.name}`
        }
      />
      {emails.map((email) => (
        <EmailCard key={email.id} email={email} view={view} onOpenDocument={onOpenDocument} />
      ))}
    </section>
  );
}
