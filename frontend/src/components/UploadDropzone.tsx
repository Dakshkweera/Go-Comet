import { useEffect, useRef, useState, type HTMLAttributes } from "react";
import { api, ApiError } from "../api.js";
import { refreshRuns, useRun } from "../data.js";
import { fileKind, formatBytes, isFinal } from "../domain.js";
import { Link, navigate } from "../router.js";
import { Icon } from "./Icon.js";
import { ProcessingStepper } from "./ProcessingStepper.js";

const ACCEPTED_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
const ACCEPT = [...ACCEPTED_TYPES, ".pdf", ".png", ".jpg", ".jpeg", ".webp"].join(",");

type UploadState =
  | { phase: "idle" }
  | { phase: "selected"; file: File }
  | { phase: "uploading"; file: File; startedAt: number }
  | {
      phase: "processing";
      file: File;
      startedAt: number;
      runId: string;
      duplicateOf: string | null;
    }
  | { phase: "failed"; file: File; message: string };

function rejectionFor(file: File, count: number): string | null {
  if (count > 1) return "Select one document at a time.";
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return `“${file.name}” is not a supported file type. Upload a PDF, PNG, JPEG or WEBP document.`;
  }
  if (file.size === 0) return `“${file.name}” is empty.`;
  return null;
}

function uploadErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    return err.status === 413 ? "This file is larger than the server's upload limit." : err.message;
  }
  return "Could not reach the Nova API. Check your connection and try again.";
}

const formatElapsed = (seconds: number) =>
  seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;

export function UploadDropzone() {
  const [state, setState] = useState<UploadState>({ phase: "idle" });
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const inputRef = useRef<HTMLInputElement>(null);
  const browseRef = useRef<HTMLButtonElement>(null);
  const processRef = useRef<HTMLButtonElement>(null);
  const focusNext = useRef<"browse" | "process" | null>(null);
  const dragDepth = useRef(0);

  const { run, error: runError } = useRun(state.phase === "processing" ? state.runId : null);
  const failure =
    state.phase === "failed"
      ? state.message
      : runError?.notFound
        ? "This pipeline run could not be found on the server."
        : null;
  const busy = (state.phase === "uploading" || state.phase === "processing") && !failure;
  const finishedId = run && isFinal(run.status) ? run.id : null;
  const elapsed =
    "startedAt" in state ? Math.max(0, Math.floor((now - state.startedAt) / 1000)) : 0;

  useEffect(() => {
    const block = (e: DragEvent) => {
      if (e.defaultPrevented || !e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "none";
    };
    window.addEventListener("dragover", block);
    window.addEventListener("drop", block);
    return () => {
      window.removeEventListener("dragover", block);
      window.removeEventListener("drop", block);
    };
  }, []);

  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  useEffect(() => {
    if (!finishedId) return;
    refreshRuns();
    navigate(`/documents/${finishedId}`);
  }, [finishedId]);

  useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    (target === "browse" ? browseRef : processRef).current?.focus();
  });

  function choose(files: File[]) {
    const [file] = files;
    if (!file) return;
    const rejection = rejectionFor(file, files.length);
    setNotice(rejection);
    if (rejection) return;
    setState({ phase: "selected", file });
    focusNext.current = "process";
  }

  function reset() {
    setNotice(null);
    setState({ phase: "idle" });
    focusNext.current = "browse";
  }

  async function process(file: File) {
    const startedAt = Date.now();
    setNotice(null);
    setState({ phase: "uploading", file, startedAt });
    try {
      const { runId, duplicateOfRunId } = await api.upload(file);
      setState({ phase: "processing", file, startedAt, runId, duplicateOf: duplicateOfRunId });
      refreshRuns();
    } catch (err) {
      setState({ phase: "failed", file, message: uploadErrorMessage(err) });
    }
  }

  const openPicker = () => inputRef.current?.click();

  const dropProps: HTMLAttributes<HTMLDivElement> = busy
    ? {}
    : {
        onDragEnter: (e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          dragDepth.current += 1;
          setDragging(true);
        },
        onDragOver: (e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        },
        onDragLeave: () => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragging(false);
        },
        onDrop: (e) => {
          e.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          choose(Array.from(e.dataTransfer.files));
        },
      };

  const file = state.phase === "idle" ? null : state.file;
  const editable = state.phase === "selected" || !!failure;

  return (
    <section className="panel ov-upload" aria-labelledby="ov-upload-title">
      <div className="panel-header">
        <div>
          <h2 className="panel-title" id="ov-upload-title">
            Upload trade document
          </h2>
          <p className="panel-subtitle">
            Fields are extracted, checked against customer rules and routed automatically.
          </p>
        </div>
      </div>

      <div className={dragging ? "ov-upload-body is-dragging" : "ov-upload-body"} {...dropProps}>
        {!file ? (
          <div className="ov-dropzone" onClick={openPicker}>
            <span className="ov-dropzone-icon">
              <Icon name="upload" size={20} />
            </span>
            <p className="ov-dropzone-title">
              {dragging ? "Release to add this document" : "Drop a PDF or image here"}
            </p>
            {!dragging && <p className="ov-dropzone-sub">or browse your files</p>}
            <button
              ref={browseRef}
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={(e) => {
                e.stopPropagation();
                openPicker();
              }}
            >
              Browse files
            </button>
            <p className="ov-dropzone-hint">PDF, PNG, JPEG, WEBP</p>
          </div>
        ) : (
          <>
            <div className="ov-file">
              <span className="ov-file-icon">
                <Icon name="file" size={18} />
              </span>
              <span className="ov-file-meta">
                <span className="ov-file-name">{file.name}</span>
                <span className="ov-file-sub">
                  {fileKind(file.type || file.name)} · {formatBytes(file.size)}
                </span>
              </span>
              {editable && (
                <span className="ov-file-actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={openPicker}>
                    Change
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm btn-icon"
                    onClick={reset}
                    aria-label="Remove file"
                  >
                    <Icon name="x" size={15} />
                  </button>
                </span>
              )}
            </div>

            {failure ? (
              <div className="callout tone-danger" role="alert">
                <Icon name="alert" size={16} />
                <div className="ov-failure-body">
                  <strong>
                    {state.phase === "failed" ? "Upload failed" : "Processing status unavailable"}
                  </strong>
                  <span>{failure}</span>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => process(file)}
                  >
                    <Icon name="refresh" size={14} />
                    Try again
                  </button>
                </div>
              </div>
            ) : (
              <div className="ov-progress">
                <div className="ov-progress-head">
                  <span className="ov-progress-title">
                    {state.phase === "selected" ? "Ready to process" : "Processing document"}
                  </span>
                  {busy && (
                    <span className="ov-elapsed">
                      <Icon name="clock" size={13} />
                      <span className="sr-only">Elapsed time</span>
                      {formatElapsed(elapsed)}
                    </span>
                  )}
                </div>
                <ProcessingStepper
                  phase={
                    state.phase === "uploading" || state.phase === "processing"
                      ? state.phase
                      : "ready"
                  }
                  run={run}
                />
              </div>
            )}

            {(state.phase === "selected" || state.phase === "uploading") && (
              <div className="ov-upload-actions">
                <button
                  ref={processRef}
                  type="button"
                  className="btn btn-primary"
                  disabled={state.phase === "uploading"}
                  onClick={() => process(file)}
                >
                  {state.phase === "uploading" ? (
                    <>
                      <span className="spinner ov-btn-spinner" aria-hidden="true" />
                      Uploading…
                    </>
                  ) : (
                    <>
                      Process document
                      <Icon name="arrowRight" size={15} />
                    </>
                  )}
                </button>
              </div>
            )}

            {state.phase === "processing" && !failure && (
              <div className="ov-notes">
                {state.duplicateOf && (
                  <p className="ov-note">
                    <Icon name="copy" size={14} />
                    <span>
                      This file matches an earlier upload.{" "}
                      <Link to={`/documents/${state.duplicateOf}`}>View earlier run</Link> — it is
                      being processed again as a new run.
                    </span>
                  </p>
                )}
                {runError && (
                  <p className="ov-note is-warning">
                    <Icon name="alert" size={14} />
                    <span>Having trouble reaching the server. Retrying…</span>
                  </p>
                )}
                <p className="ov-note">
                  <Icon name="info" size={14} />
                  <span>
                    Results open automatically when processing finishes.{" "}
                    <Link to={`/documents/${state.runId}`}>Open document now</Link>
                  </span>
                </p>
              </div>
            )}
          </>
        )}

        {notice && (
          <p className="ov-notice" role="alert">
            <Icon name="alert" size={14} />
            <span>{notice}</span>
          </p>
        )}

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          hidden
          onChange={(e) => {
            choose(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </div>
    </section>
  );
}
