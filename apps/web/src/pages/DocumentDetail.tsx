import "../styles/detail.css";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { api, type RunView } from "../api.js";
import { AmendmentPanel } from "../components/AmendmentPanel.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { DecisionReasoning } from "../components/DecisionReasoning.js";
import { DecisionSummary } from "../components/DecisionSummary.js";
import { DocumentDrawer } from "../components/DocumentDrawer.js";
import { EmptyState, ErrorState, LoadingRows } from "../components/EmptyState.js";
import { ExtractionGrid } from "../components/ExtractionGrid.js";
import { Icon } from "../components/Icon.js";
import { PipelineStepper } from "../components/PipelineStepper.js";
import { RouteLabel } from "../components/ShipmentTable.js";
import { Badge, DecisionBadge, RunStatusBadge } from "../components/StatusBadge.js";
import { ValidationList } from "../components/ValidationList.js";
import { forgetRun, useRun } from "../data.js";
import {
  fileKind,
  formatBytes,
  formatDateTime,
  formatDuration,
  isFinal,
  pipelineSteps,
  plural,
  runIssues,
} from "../domain.js";
import { Link, navigate } from "../router.js";

function BackLink() {
  return (
    <Link to="/documents" className="back-link dd-back">
      <Icon name="arrowLeft" size={14} />
      Back to Documents
    </Link>
  );
}

function HeaderStatus({ run }: { run: RunView }) {
  if (run.decision) return <DecisionBadge decision={run.decision.decision} size="lg" />;
  if (!isFinal(run.status)) {
    return (
      <Badge tone="info" size="lg" icon={null}>
        <span className="spinner dd-badge-spinner" aria-hidden="true" />
        {run.status === "RECEIVED" ? "Queued" : "Processing"}
      </Badge>
    );
  }
  return (
    <Badge tone="danger" size="lg">
      Failed
    </Badge>
  );
}

function CustomerMeta({ customer }: { customer: RunView["customer"] }) {
  if (!customer) return null;
  if (customer.status === "resolved") {
    return (
      <span className="dd-meta-item">
        <Icon name="customers" size={14} className="text-faint" />
        {customer.name ?? "Resolved customer"}
      </span>
    );
  }
  return (
    <span className="dd-meta-item text-warning">
      <Icon name="alert" size={14} />
      {customer.status === "ambiguous" ? "Ambiguous customer" : "Customer not identified"}
    </span>
  );
}

function DeleteRunAction({ run }: { run: RunView }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const processing = !isFinal(run.status);

  async function remove() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await api.deleteRun(run.id);
      navigate("/documents");
      forgetRun(run.id);
    } catch (err) {
      busyRef.current = false;
      setBusy(false);
      setError((err as Error).message);
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-ghost btn-sm dd-delete"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        disabled={processing}
        title={processing ? "Runs can be deleted once processing finishes" : undefined}
      >
        <Icon name="trash" size={14} />
        Delete run
      </button>
      <ConfirmDialog
        open={open}
        title="Delete this run?"
        confirmLabel="Delete run"
        busyLabel="Deleting…"
        busy={busy}
        error={error}
        onConfirm={remove}
        onCancel={() => setOpen(false)}
      >
        <p>
          This will permanently remove the run for <strong>{run.document.filename}</strong>, its
          extracted data, validation results, decision, and stored document.
        </p>
        <p>This action cannot be undone.</p>
      </ConfirmDialog>
    </>
  );
}

function DetailHeader({
  run,
  docOpen,
  onToggleDoc,
  docButtonRef,
}: {
  run: RunView;
  docOpen: boolean;
  onToggleDoc: () => void;
  docButtonRef: RefObject<HTMLButtonElement | null>;
}) {
  const ex = run.extraction;
  const invoice = ex?.invoice_number.value ?? null;
  const origin = ex?.port_of_loading.value ?? null;
  const destination = ex?.port_of_discharge.value ?? null;
  const attempts = run.attempts.filter((a) => a.stage === "EXTRACTING").length;
  const duration = formatDuration(run.createdAt, run.completedAt);
  const hasMeta = run.customer || invoice || origin || destination;

  return (
    <header className="dd-header">
      <BackLink />
      <div className="dd-header-row">
        <div className="dd-header-text">
          <h1 className="page-title">{run.document.filename}</h1>
          {hasMeta && (
            <p className="dd-meta">
              <CustomerMeta customer={run.customer} />
              {invoice && <span className="dd-meta-item mono">{invoice}</span>}
              {(origin || destination) && (
                <span className="dd-meta-item">
                  <RouteLabel origin={origin} destination={destination} />
                </span>
              )}
            </p>
          )}
          <p className="dd-submeta">
            <span className="dd-meta-item">
              <Icon name="calendar" size={13} />
              {run.completedAt
                ? `Processed ${formatDateTime(run.completedAt)}`
                : `Received ${formatDateTime(run.createdAt)}`}
            </span>
            <span className="dd-meta-item">
              <Icon name="file" size={13} />
              {fileKind(run.document.mimeType || run.document.filename)} ·{" "}
              {formatBytes(run.document.size)}
            </span>
            {attempts > 0 && (
              <span className="dd-meta-item">
                <Icon name="refresh" size={13} />
                {plural(attempts, "extraction attempt")}
              </span>
            )}
            {duration && (
              <span className="dd-meta-item">
                <Icon name="clock" size={13} />
                {duration} processing
              </span>
            )}
          </p>
        </div>
        <div className="dd-header-status">
          <HeaderStatus run={run} />
          <div className="dd-header-actions">
            <button
              ref={docButtonRef}
              type="button"
              className={
                docOpen ? "btn btn-secondary btn-sm is-active" : "btn btn-secondary btn-sm"
              }
              onClick={onToggleDoc}
              aria-expanded={docOpen}
            >
              <Icon name="file" size={14} />
              {docOpen ? "Hide original document" : "View original document"}
            </button>
            <DeleteRunAction run={run} />
          </div>
        </div>
      </div>
    </header>
  );
}

const ATTEMPT_TONE: Record<string, string> = {
  succeeded: "text-success",
  failed: "text-danger",
  running: "text-secondary",
};

function RunDetails({ run }: { run: RunView }) {
  return (
    <section className="panel" aria-labelledby="dd-run-title">
      <div className="panel-header">
        <h2 className="panel-title" id="dd-run-title">
          Run details
        </h2>
        <RunStatusBadge status={run.status} />
      </div>
      <div className="panel-body">
        <dl className="kv dd-kv">
          <dt>Run ID</dt>
          <dd className="mono">{run.id}</dd>
          <dt>Received</dt>
          <dd>{formatDateTime(run.createdAt)}</dd>
          <dt>Completed</dt>
          <dd>{run.completedAt ? formatDateTime(run.completedAt) : "—"}</dd>
          {run.attempts.length > 0 && (
            <>
              <dt>Attempts</dt>
              <dd>
                <ul className="dd-attempts">
                  {run.attempts.map((a) => (
                    <li key={`${a.stage}-${a.attempt}`}>
                      <span>
                        {a.stage === "EXTRACTING" ? "Extraction" : a.stage.toLowerCase()} #
                        {a.attempt}
                      </span>{" "}
                      <span className={ATTEMPT_TONE[a.status] ?? "text-secondary"}>{a.status}</span>
                      {a.errorMessage && <span className="dd-kv-sub">{a.errorMessage}</span>}
                    </li>
                  ))}
                </ul>
              </dd>
            </>
          )}
        </dl>
      </div>
    </section>
  );
}

const ANCHORS =
  ".dd-header, .dd-pipeline, .dd-summary, .section-header, .dd-field, .dd-rule, .dd-rail > *";

// The page reflows narrower beside the drawer; keep whatever the reader was looking at in place.
function visibleAnchor() {
  const top = document.querySelector(".topbar")?.getBoundingClientRect().bottom ?? 0;
  for (const el of document.querySelectorAll(ANCHORS)) {
    const rect = el.getBoundingClientRect();
    if (rect.bottom > top + 8) return { el, top: rect.top };
  }
  return null;
}

function RunDetail({ run }: { run: RunView }) {
  const issues = runIssues(run);
  const [docOpen, setDocOpen] = useState(false);
  const docButtonRef = useRef<HTMLButtonElement>(null);
  const anchorRef = useRef<ReturnType<typeof visibleAnchor>>(null);

  const openDoc = () => {
    anchorRef.current = visibleAnchor();
    setDocOpen(true);
  };
  const closeDoc = useCallback(() => {
    anchorRef.current = visibleAnchor();
    setDocOpen(false);
    docButtonRef.current?.focus({ preventScroll: true });
  }, []);

  useLayoutEffect(() => {
    document.body.classList.toggle("doc-drawer-open", docOpen);
    const anchor = anchorRef.current;
    anchorRef.current = null;
    if (anchor) window.scrollBy(0, anchor.el.getBoundingClientRect().top - anchor.top);
  }, [docOpen]);

  useEffect(() => () => document.body.classList.remove("doc-drawer-open"), []);

  return (
    <div className="page dd-page">
      <DetailHeader
        run={run}
        docOpen={docOpen}
        onToggleDoc={() => (docOpen ? closeDoc() : openDoc())}
        docButtonRef={docButtonRef}
      />
      <DocumentDrawer run={run} open={docOpen} onClose={closeDoc} />
      <div className="dd-overview">
        <div className="panel dd-pipeline">
          <PipelineStepper steps={pipelineSteps(run)} />
        </div>
        <DecisionSummary run={run} issues={issues} />
      </div>
      <div className="dd-layout">
        <div className="dd-main">
          <ExtractionGrid run={run} />
          <ValidationList run={run} />
        </div>
        <aside className="dd-rail" aria-label="Decision details">
          <DecisionReasoning run={run} issues={issues} />
          {run.decision?.decision === "amendment_request" && (
            <AmendmentPanel run={run} issues={issues} />
          )}
          <RunDetails run={run} />
        </aside>
      </div>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="page dd-page" aria-busy="true">
      <span className="sr-only" role="status">
        Loading document…
      </span>
      <div className="dd-header">
        <BackLink />
        <div className="skeleton dd-skel-title" />
        <div className="skeleton dd-skel-line" />
      </div>
      <div className="panel dd-pipeline">
        <div className="skeleton dd-skel-block" />
      </div>
      <div className="panel">
        <LoadingRows rows={3} />
      </div>
      <div className="dd-fields">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="dd-field">
            <span className="skeleton dd-skel-meta" />
            <span className="skeleton dd-skel-value" />
            <span className="skeleton dd-skel-meta" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function DocumentDetailPage({ id }: { id: string }) {
  const { run, error } = useRun(id);
  const filename = run?.document.filename;

  useEffect(() => {
    document.title = `${filename ?? "Document"} · Nova`;
  }, [filename]);

  if (run) return <RunDetail run={run} />;

  if (error?.notFound) {
    return (
      <div className="page dd-page">
        <BackLink />
        <div className="panel">
          <EmptyState
            icon="documents"
            title="Document not found"
            action={
              <Link to="/documents" className="btn btn-secondary btn-sm">
                View all documents
              </Link>
            }
          >
            No pipeline run matches <span className="mono">{id}</span>. Check the link or open the
            document from the list.
          </EmptyState>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page dd-page">
        <BackLink />
        <div className="panel">
          <ErrorState
            message={`${error.message.replace(/\.?$/, ".")} Nova will retry automatically.`}
          />
        </div>
      </div>
    );
  }

  return <DetailSkeleton />;
}
