import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { formatBytes } from "../domain.js";
import {
  cellTone,
  confidenceMeta,
  confidenceTitle,
  currentDocuments,
  documentTypeLabel,
  fieldExpectation,
  fieldResult,
  formatObservation,
  issuesForField,
  observationAt,
} from "../shipmentDomain.js";
import type {
  ExtractionField,
  ShipmentDocument,
  ShipmentField,
  ShipmentView,
} from "../types/api.js";
import { documentUrl, useDocumentSource, Viewer } from "./DocumentDrawer.js";
import { Icon } from "./Icon.js";
import { Badge, EvidenceBadge } from "./StatusBadge.js";

export type DrawerPanel =
  | { kind: "field"; field: ExtractionField }
  | { kind: "document"; documentId: string; from: ExtractionField | null };

function Shell({
  eyebrow,
  title,
  meta,
  onBack,
  onClose,
  actions,
  children,
}: {
  eyebrow: string;
  title: string;
  meta?: string;
  onBack: (() => void) | null;
  onClose: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("dialog[open]")) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <aside
      className="dd-doc-drawer"
      role="dialog"
      aria-modal="false"
      aria-labelledby="sd-drawer-title"
    >
      <header className="dd-doc-header">
        {onBack ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>
            <Icon name="arrowLeft" size={16} />
            Details
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-ghost btn-sm dd-doc-back"
            onClick={onClose}
            aria-label="Back to shipment"
          >
            <Icon name="arrowLeft" size={16} />
            Shipment
          </button>
        )}
        <div className="dd-doc-heading">
          <p className="dd-doc-eyebrow">{eyebrow}</p>
          <h2 className="dd-doc-title" id="sd-drawer-title" title={title}>
            {title}
          </h2>
          {meta && <p className="dd-doc-meta">{meta}</p>}
        </div>
        <div className="dd-doc-actions">
          {actions}
          <button
            ref={closeRef}
            type="button"
            className="btn btn-ghost btn-sm btn-icon"
            onClick={onClose}
            title="Close (Esc)"
          >
            <Icon name="x" size={18} />
            <span className="sr-only">Close</span>
          </button>
        </div>
      </header>
      {children}
    </aside>,
    document.body,
  );
}

function Observation({
  doc,
  field,
  onOpen,
}: {
  doc: ShipmentDocument;
  field: ShipmentField;
  onOpen: () => void;
}) {
  const o = observationAt(field, doc.id);
  const tone = o ? cellTone(o) : null;
  return (
    <li className={tone ? `sd-obs is-flagged tone-${tone}` : "sd-obs"}>
      <div className="sd-obs-head">
        <div>
          <p className="sd-obs-type">
            {documentTypeLabel(doc)}
            {o?.isOwner && (
              <Badge size="sm" tone="info" icon={null} title="The document that decides this field">
                Owner
              </Badge>
            )}
          </p>
          <p className="sd-obs-file">{doc.filename}</p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onOpen}>
          <Icon name="external" size={13} />
          Open original
        </button>
      </div>
      {!o ? (
        <p className="sd-obs-none">Not on this document.</p>
      ) : (
        <>
          <p className="sd-obs-value">{formatObservation(o)}</p>
          <p className="sd-obs-tags">
            <span
              className={`sd-conf tone-${confidenceMeta(o.confidenceLevel).tone}`}
              title={confidenceTitle(o)}
            >
              <span className="dot" aria-hidden="true" />
              {confidenceMeta(o.confidenceLevel).label} confidence
            </span>
            {o.agrees === false && (
              <Badge size="sm" tone="danger" icon={null}>
                Does not match
              </Badge>
            )}
            {!o.reliable && (
              <Badge size="sm" tone="warning" icon={null}>
                Not reliable
              </Badge>
            )}
            {o.verifiedByCg && (
              <Badge size="sm" tone="success" icon={null}>
                Verified by you
              </Badge>
            )}
          </p>
          {o.reasons.length > 0 && (
            <ul className="sd-obs-reasons">
              {o.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
          {o.evidence && (
            <div className="sd-snippet">
              <span className="sd-snippet-label">
                Source text
                <EvidenceBadge status={o.evidenceStatus ?? undefined} />
              </span>
              <blockquote>{o.evidence}</blockquote>
            </div>
          )}
        </>
      )}
    </li>
  );
}

function FieldDetail({
  view,
  field,
  onOpenDocument,
}: {
  view: ShipmentView;
  field: ShipmentField;
  onOpenDocument: (documentId: string) => void;
}) {
  const issues = issuesForField(view.issues, field.field);
  const expectation = fieldExpectation(view, field);
  return (
    <div className="sd-drawer-body">
      <div className="sd-drawer-result">
        <Badge tone={fieldResult(field).tone}>{fieldResult(field).label}</Badge>
      </div>

      {issues.map((issue) => (
        <div
          key={issue.key}
          className={`callout tone-${issue.severity === "amendment" ? "danger" : "warning"}`}
        >
          <Icon name="alert" size={16} />
          <span>{issue.message}</span>
        </div>
      ))}

      <section className="sd-expect" aria-labelledby="sd-expect-title">
        <h3 className="sd-drawer-heading" id="sd-expect-title">
          Expected
        </h3>
        {expectation.value ? (
          <>
            <p className="sd-expect-value">{expectation.value}</p>
            {expectation.source && <p className="sd-expect-source">Source: {expectation.source}</p>}
            {expectation.rule && (
              <p className="sd-expect-source">Customer rule: {expectation.rule}</p>
            )}
          </>
        ) : (
          <p className="text-muted">No expected value</p>
        )}
      </section>

      <section aria-labelledby="sd-docs-title">
        <h3 className="sd-drawer-heading" id="sd-docs-title">
          What each document says
        </h3>
        <ul className="sd-obs-list">
          {currentDocuments(view).map((doc) => (
            <Observation
              key={doc.id}
              doc={doc}
              field={field}
              onOpen={() => onOpenDocument(doc.id)}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}

function DocumentView({
  doc,
  onBack,
  onClose,
}: {
  doc: ShipmentDocument;
  onBack: (() => void) | null;
  onClose: () => void;
}) {
  const { source, retry } = useDocumentSource(doc.runId, true);
  return (
    <Shell
      eyebrow="Original document"
      title={doc.filename}
      meta={`${documentTypeLabel(doc)} · ${formatBytes(doc.size)}`}
      onBack={onBack}
      onClose={onClose}
      actions={
        source.state === "ready" && (
          <a
            className="btn btn-ghost btn-sm"
            href={documentUrl(doc.runId)}
            target="_blank"
            rel="noreferrer"
          >
            <Icon name="external" size={14} />
            <span className="dd-doc-action-label">Open in new tab</span>
          </a>
        )
      }
    >
      <div className="dd-doc-body">
        <Viewer
          source={source}
          filename={doc.filename}
          openUrl={documentUrl(doc.runId)}
          hasEvidence
          onRetry={retry}
        />
      </div>
    </Shell>
  );
}

export function ShipmentDrawer({
  view,
  panel,
  onClose,
  onOpenField,
  onOpenDocument,
}: {
  view: ShipmentView;
  panel: DrawerPanel;
  onClose: () => void;
  onOpenField: (field: ExtractionField) => void;
  onOpenDocument: (documentId: string, from: ExtractionField | null) => void;
}) {
  if (panel.kind === "document") {
    const doc = view.documents.find((d) => d.id === panel.documentId);
    if (!doc) return null;
    const from = panel.from;
    return (
      <DocumentView doc={doc} onBack={from ? () => onOpenField(from) : null} onClose={onClose} />
    );
  }

  const field = view.fields.find((f) => f.field === panel.field);
  if (!field) return null;
  return (
    <Shell
      eyebrow={field.state === "ok" ? "Field detail" : "Discrepancy detail"}
      title={field.label}
      onBack={null}
      onClose={onClose}
    >
      <FieldDetail
        view={view}
        field={field}
        onOpenDocument={(id) => onOpenDocument(id, field.field)}
      />
    </Shell>
  );
}
