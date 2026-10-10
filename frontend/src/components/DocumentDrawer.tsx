import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { RunView } from "../api.js";
import { apiUrl } from "../config.js";
import {
  fileKind,
  formatBytes,
  formatFieldValue,
  runIssues,
  type ExtractedField,
} from "../domain.js";
import { EmptyState } from "./EmptyState.js";
import { fieldAnchor, jumpTo } from "./ExtractionGrid.js";
import { Icon } from "./Icon.js";

export const documentUrl = (runId: string) =>
  apiUrl(`/api/runs/${encodeURIComponent(runId)}/document`);

type Source =
  | { state: "loading" }
  | { state: "ready"; url: string; type: string }
  | { state: "error"; code: string | null; message: string };

// Fetched once per page visit and kept as an object URL, so reopening the drawer is instant.
export function useDocumentSource(runId: string, enabled: boolean) {
  const [source, setSource] = useState<Source>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [requested, setRequested] = useState(false);

  useEffect(() => {
    if (enabled) setRequested(true);
  }, [enabled]);

  useEffect(() => {
    if (!requested) return;
    let url: string | null = null;
    let cancelled = false;
    setSource({ state: "loading" });
    fetch(documentUrl(runId))
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw Object.assign(new Error(body?.error?.message ?? `Request failed (${res.status})`), {
            code: body?.error?.code ?? null,
          });
        }
        const blob = await res.blob();
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setSource({
          state: "ready",
          url,
          type: blob.type || res.headers.get("content-type") || "",
        });
      })
      .catch((err: Error & { code?: string | null }) => {
        if (!cancelled) setSource({ state: "error", code: err.code ?? null, message: err.message });
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [runId, requested, attempt]);

  return { source, retry: () => setAttempt((n) => n + 1) };
}

function ImageViewer({ url, filename }: { url: string; filename: string }) {
  const [zoom, setZoom] = useState<number | null>(null);
  const step = (delta: number) => setZoom((z) => Math.min(400, Math.max(50, (z ?? 100) + delta)));

  return (
    <>
      <div className="dd-doc-tools" role="toolbar" aria-label="Zoom">
        <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => step(-25)}>
          <span aria-hidden="true">−</span>
          <span className="sr-only">Zoom out</span>
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm dd-doc-zoom"
          onClick={() => setZoom(null)}
          aria-pressed={zoom === null}
        >
          {zoom === null ? "Fit width" : `${zoom}%`}
        </button>
        <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => step(25)}>
          <span aria-hidden="true">+</span>
          <span className="sr-only">Zoom in</span>
        </button>
      </div>
      <div className="dd-doc-canvas">
        <img
          src={url}
          alt={`Original document ${filename}`}
          className="dd-doc-image"
          style={zoom === null ? undefined : { width: `${zoom}%`, maxWidth: "none" }}
        />
      </div>
    </>
  );
}

function Viewer({
  source,
  filename,
  openUrl,
  hasEvidence,
  onRetry,
}: {
  source: Source;
  filename: string;
  openUrl: string;
  hasEvidence: boolean;
  onRetry: () => void;
}) {
  if (source.state === "loading") {
    return (
      <div className="dd-doc-state" role="status">
        <span className="spinner" aria-hidden="true" />
        Loading original document…
      </div>
    );
  }
  if (source.state === "error") {
    const missing = source.code === "DOCUMENT_MISSING" || source.code === "RUN_NOT_FOUND";
    return (
      <div className="dd-doc-state">
        <EmptyState
          icon={missing ? "file" : "alert"}
          title={missing ? "Original document unavailable" : "Could not load the document"}
          action={
            !missing && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>
                <Icon name="refresh" size={14} />
                Try again
              </button>
            )
          }
        >
          {missing
            ? `The uploaded file for this run is no longer stored on the server.${
                hasEvidence ? " The source text Nova captured is still shown with each field." : ""
              }`
            : source.message}
        </EmptyState>
      </div>
    );
  }
  if (source.type === "application/pdf" && navigator.pdfViewerEnabled === false) {
    return (
      <div className="dd-doc-state">
        <EmptyState
          icon="file"
          title="PDF preview is not supported in this browser"
          action={
            <a className="btn btn-primary btn-sm" href={openUrl} target="_blank" rel="noreferrer">
              <Icon name="external" size={14} />
              Open PDF
            </a>
          }
        >
          Open the original in your device’s PDF viewer, then come back to compare it with the
          findings.
        </EmptyState>
      </div>
    );
  }
  if (source.type === "application/pdf") {
    return (
      <iframe
        className="dd-doc-frame"
        src={`${source.url}#view=FitH&navpanes=0`}
        title={`Original document ${filename}`}
      />
    );
  }
  if (source.type.startsWith("image/")) return <ImageViewer url={source.url} filename={filename} />;
  return (
    <div className="dd-doc-state">
      <EmptyState icon="file" title="Preview not available">
        This file type cannot be previewed in the browser. Use “Open in new tab” to view it.
      </EmptyState>
    </div>
  );
}

function FindingsStrip({ run, onJump }: { run: RunView; onJump: (id: string) => void }) {
  const issues = runIssues(run).filter((i) => i.field);
  if (!issues.length || !run.extraction) return null;
  return (
    <div className="dd-doc-findings">
      <span className="dd-doc-findings-label">Compare with findings</span>
      <ul>
        {issues.map((issue) => {
          const field = run.extraction![issue.field!] as ExtractedField;
          return (
            <li key={issue.field}>
              <button
                type="button"
                className={`dd-doc-chip tone-${issue.kind === "mismatch" ? "danger" : "warning"}`}
                onClick={() => onJump(fieldAnchor(issue.field!))}
              >
                <strong>{issue.title}</strong>
                <span className="mono">{formatFieldValue(field) ?? "Not found"}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function DocumentDrawer({
  run,
  open,
  onClose,
}: {
  run: RunView;
  open: boolean;
  onClose: () => void;
}) {
  const { source, retry } = useDocumentSource(run.id, open);
  const closeRef = useRef<HTMLButtonElement>(null);
  const { filename, mimeType, size } = run.document;

  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("dialog[open]")) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const jump = (id: string) => {
    if (!window.matchMedia("(max-width: 767px)").matches) return jumpTo(id);
    onClose();
    setTimeout(() => jumpTo(id), 0);
  };

  return createPortal(
    <aside
      className="dd-doc-drawer"
      role="dialog"
      aria-modal="false"
      aria-labelledby="dd-doc-title"
    >
      <header className="dd-doc-header">
        <button
          type="button"
          className="btn btn-ghost btn-sm dd-doc-back"
          onClick={onClose}
          aria-label="Back to analysis"
        >
          <Icon name="arrowLeft" size={16} />
          Analysis
        </button>
        <span className="dd-doc-icon" aria-hidden="true">
          <Icon name="file" size={16} />
        </span>
        <div className="dd-doc-heading">
          <p className="dd-doc-eyebrow">Original document</p>
          <h2 className="dd-doc-title" id="dd-doc-title" title={filename}>
            {filename}
          </h2>
          <p className="dd-doc-meta">
            {fileKind(mimeType || filename)} · {formatBytes(size)}
          </p>
        </div>
        <div className="dd-doc-actions">
          {source.state === "ready" && (
            <a
              className="btn btn-ghost btn-sm"
              href={documentUrl(run.id)}
              target="_blank"
              rel="noreferrer"
              aria-label="Open in new tab"
            >
              <Icon name="external" size={14} />
              <span className="dd-doc-action-label">Open in new tab</span>
            </a>
          )}
          <button
            ref={closeRef}
            type="button"
            className="btn btn-ghost btn-sm btn-icon"
            onClick={onClose}
            title="Close (Esc)"
          >
            <Icon name="x" size={18} />
            <span className="sr-only">Close document</span>
          </button>
        </div>
      </header>
      <FindingsStrip run={run} onJump={jump} />
      <div className="dd-doc-body">
        <Viewer
          source={source}
          filename={filename}
          openUrl={documentUrl(run.id)}
          hasEvidence={!!run.extraction}
          onRetry={retry}
        />
      </div>
    </aside>,
    document.body,
  );
}
