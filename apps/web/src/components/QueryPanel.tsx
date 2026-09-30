import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type {
  ExtractionField,
  QueryExecutionResult,
  QueryResponse,
  ValidationStatus,
  EvidenceStatus,
} from "@nova/contracts";
import { api, ApiError } from "../api.js";
import { useRuns } from "../data.js";
import {
  DECISIONS,
  EVIDENCE,
  FIELD_LABELS,
  RUN_STATUS,
  VALIDATION,
  fieldLabel,
  formatBytes,
  formatDateTime,
  plural,
  type RunRecord,
  type Tone,
} from "../domain.js";
import { Link } from "../router.js";
import { EmptyState } from "./EmptyState.js";
import { Icon, type IconName } from "./Icon.js";
import { DecisionBadge, EvidenceBadge, RunStatusBadge, ValidationBadge } from "./StatusBadge.js";

const MAX_LENGTH = 500;
const MAX_ROWS = 200;
const HISTORY_LIMIT = 10;

const SUGGESTIONS = [
  "Shipments awaiting human review",
  "Recent amendment requests",
  "Documents approved today",
  "Which customers have the most exceptions?",
];

const TOPICS: { icon: IconName; title: string; text: string }[] = [
  {
    icon: "documents",
    title: "Shipments & decisions",
    text: "File names, processing status, timestamps and the routing decision of every run.",
  },
  {
    icon: "file",
    title: "Extracted fields",
    text: "Consignee, HS code, ports, Incoterms, goods, gross weight and invoice number.",
  },
  {
    icon: "rules",
    title: "Rule validations",
    text: "Match, mismatch and uncertain results per field, with found and expected values.",
  },
  {
    icon: "customers",
    title: "Customers & rules",
    text: "Resolved customers and the validation rules configured for them.",
  },
];

type StepState = "idle" | "working" | "done" | "skipped" | "failed";

const FLOW: { label: string; icon: IconName }[] = [
  { label: "Natural language", icon: "queries" },
  { label: "SQL", icon: "code" },
  { label: "SQLite", icon: "database" },
  { label: "Answer", icon: "sparkle" },
];

const STEP_STATUS: Partial<Record<StepState, string>> = {
  working: "in progress",
  done: "done",
  skipped: "skipped",
  failed: "failed",
};

const FAILED_STEP: Record<string, number> = {
  INVALID_QUESTION: 0,
  SQL_INVALID: 1,
  SQL_EXECUTION_FAILED: 2,
};

type Failure = { status: number | null; code: string | null; message: string };

type Outcome =
  | { id: number; kind: "result"; question: string; response: QueryResponse; ms: number }
  | { id: number; kind: "error"; question: string; failure: Failure };

type HistoryEntry = { question: string; ok: boolean; summary: string; at: number };

type RunLinks = { byId: Map<string, RunRecord>; byFilename: Map<string, RunRecord> };

type FailureInfo = {
  tone: Tone;
  icon: IconName;
  title: string;
  short: string;
  text: string;
  detail?: string;
  retry: boolean;
};

function toFailure(err: unknown): Failure {
  if (err instanceof ApiError) return { status: err.status, code: err.code, message: err.message };
  return { status: null, code: null, message: (err as Error).message };
}

function describeFailure({ status, code, message }: Failure): FailureInfo {
  if (code === "QUERY_UNAVAILABLE" || status === 503) {
    return {
      tone: "neutral",
      icon: "lock",
      title: "Natural-language queries are not enabled on this server",
      short: "Not enabled",
      text: "Nova needs a configured language model to turn questions into SQL. The rest of the workspace is unaffected.",
      detail: message,
      retry: false,
    };
  }
  if (code === "INVALID_QUESTION") {
    return {
      tone: "warning",
      icon: "alert",
      title: "Question not accepted",
      short: "Not accepted",
      text: message,
      retry: false,
    };
  }
  if (code === "SQL_INVALID") {
    return {
      tone: "warning",
      icon: "shield",
      title: "The generated query was blocked",
      short: "Query blocked",
      text: "Nova only runs read-only SELECT queries, and the query generated for this question did not pass that check. Try rephrasing it.",
      retry: true,
    };
  }
  if (code === "SQL_EXECUTION_FAILED") {
    return {
      tone: "warning",
      icon: "database",
      title: "The database could not run the generated query",
      short: "Query failed",
      text: "Try rephrasing or narrowing the question.",
      retry: true,
    };
  }
  if (status === null) {
    return {
      tone: "danger",
      icon: "alert",
      title: "Nova API unreachable",
      short: "API unreachable",
      text: "The request did not reach the server. Check your connection and try again.",
      retry: true,
    };
  }
  return {
    tone: "danger",
    icon: "alert",
    title: "The question could not be answered right now",
    short: "Not answered",
    text:
      status === 502
        ? "The query service did not complete. This is often temporary — try again in a moment."
        : message,
    retry: true,
  };
}

function summarize(outcome: Outcome): string {
  if (outcome.kind === "error") return describeFailure(outcome.failure).short;
  const { type, data } = outcome.response;
  if (type === "general_question") return "General answer";
  return data ? plural(data.rows.length, "row") : "Answered";
}

function flowStates(pending: boolean, outcome: Outcome | null): StepState[] {
  if (pending) return FLOW.map(() => "working");
  if (!outcome) return FLOW.map(() => "idle");
  if (outcome.kind === "result") {
    return outcome.response.type === "general_question"
      ? ["done", "skipped", "skipped", "done"]
      : FLOW.map(() => "done");
  }
  const at = FAILED_STEP[outcome.failure.code ?? ""];
  if (at === undefined) return FLOW.map(() => "idle");
  return FLOW.map((_, i) => (i < at ? "done" : i === at ? "failed" : "idle"));
}

function indexRuns(runs: RunRecord[] | null): RunLinks {
  const byId = new Map<string, RunRecord>();
  const byFilename = new Map<string, RunRecord>();
  for (const run of runs ?? []) {
    byId.set(run.id, run);
    const seen = byFilename.get(run.filename);
    if (!seen || run.createdAt > seen.createdAt) byFilename.set(run.filename, run);
  }
  return { byId, byFilename };
}

const RUN_ID = /^run_[\w-]+$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
const ACRONYMS = new Set(["id", "hs", "sql", "pol", "pod"]);
const AGGREGATES: Record<string, string> = {
  avg: "Average",
  count: "Count",
  sum: "Total",
  min: "Min",
  max: "Max",
};

const sentenceCase = (s: string) => {
  const text = s.replaceAll("_", " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
};

function humanizeColumn(column: string): string {
  const call = column.match(/^(\w+)\s*\(\s*(?:distinct\s+)?([^)]*)\)$/i);
  if (call) {
    const fn = AGGREGATES[call[1]!.toLowerCase()] ?? sentenceCase(call[1]!);
    const inner = call[2]!.trim();
    if (!inner || inner === "*") return fn;
    const label = humanizeColumn(inner)
      .split(" ")
      .map((w) => (/^[A-Z]{2,}$/.test(w) ? w : w.toLowerCase()))
      .join(" ");
    return `${fn} ${label}`;
  }
  const name = column.replace(/^.*\./, "");
  const field = FIELD_LABELS[name as ExtractionField];
  if (field) return field;
  const words = name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w.toLowerCase()));
  const text = words.join(" ");
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : column;
}

function toIso(value: string): string | null {
  let iso = value.replace(" ", "T");
  if (!/(z|[+-]\d{2}:?\d{2})$/i.test(iso)) iso += "Z";
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

function formatNumber(column: string, n: number): string {
  if (/(^|_)id$/i.test(column)) return String(n);
  if (/^(is|has)_/i.test(column) && (n === 0 || n === 1)) return n ? "Yes" : "No";
  if (/(^|_)size$|bytes$/i.test(column)) return formatBytes(n);
  return n.toLocaleString(undefined, {
    maximumFractionDigits: /confidence/i.test(column) ? 2 : 3,
  });
}

function fileTarget(value: string, column: string, rowRun: string | null, links: RunLinks) {
  if (rowRun) {
    const rowFile = links.byId.get(rowRun)?.filename;
    if (rowFile === value || (!rowFile && /file/i.test(column))) return rowRun;
  }
  return links.byFilename.get(value)?.id ?? null;
}

function renderCell(
  column: string,
  value: unknown,
  rowRun: string | null,
  links: RunLinks,
): ReactNode {
  if (value === null || value === undefined || value === "") {
    return <span className="text-faint">—</span>;
  }
  if (typeof value === "number") return formatNumber(column, value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value !== "string") return JSON.stringify(value);

  if (RUN_ID.test(value)) {
    const run = links.byId.get(value);
    return (
      <Link
        to={`/documents/${encodeURIComponent(value)}`}
        className="q-link mono"
        title={run ? `${run.filename} · ${value}` : value}
      >
        {value.length > 14 ? `${value.slice(0, 12)}…` : value}
      </Link>
    );
  }
  const target = fileTarget(value, column, rowRun, links);
  if (target) {
    return (
      <Link to={`/documents/${encodeURIComponent(target)}`} className="q-link">
        <Icon name="file" size={14} />
        {value}
      </Link>
    );
  }
  if (Object.hasOwn(DECISIONS, value)) return <DecisionBadge decision={value} size="sm" />;
  if (/status/i.test(column)) {
    if (Object.hasOwn(RUN_STATUS, value)) return <RunStatusBadge status={value} />;
    if (Object.hasOwn(VALIDATION, value)) {
      return <ValidationBadge status={value as ValidationStatus} />;
    }
    if (/evidence/i.test(column) && Object.hasOwn(EVIDENCE, value)) {
      return <EvidenceBadge status={value as EvidenceStatus} />;
    }
    if (/^[a-z_]+$/.test(value)) return sentenceCase(value);
  }
  if (Object.hasOwn(FIELD_LABELS, value)) return fieldLabel(value);
  if (TIMESTAMP.test(value)) {
    const iso = toIso(value);
    if (iso) {
      return (
        <span className="nowrap" title={value}>
          {formatDateTime(iso)}
        </span>
      );
    }
  }
  return value.length > 60 ? <span className="q-cell-long">{value}</span> : value;
}

function FlowIndicator({ states }: { states: StepState[] }) {
  return (
    <ol className="q-flow" aria-label="How Nova answers">
      {FLOW.map((step, i) => {
        const state = states[i] ?? "idle";
        return (
          <li key={step.label} className={`q-flow-step is-${state}`}>
            {i > 0 && <Icon name="chevronRight" size={12} className="q-flow-sep" />}
            <Icon name={step.icon} size={13} />
            <span className="q-flow-label">{step.label}</span>
            {STEP_STATUS[state] && <span className="sr-only">({STEP_STATUS[state]})</span>}
          </li>
        );
      })}
    </ol>
  );
}

function QuestionEcho({ question, meta }: { question: string; meta?: ReactNode }) {
  return (
    <div className="q-result-head">
      <p className="q-result-question">
        <Icon name="queries" size={14} />
        <span>{question}</span>
      </p>
      {meta && <span className="q-result-meta">{meta}</span>}
    </div>
  );
}

function QueryIntro() {
  return (
    <section className="panel q-intro" aria-labelledby="q-intro-title">
      <div>
        <h2 id="q-intro-title" className="q-intro-title">
          What you can ask about
        </h2>
        <p className="q-intro-text">
          Nova answers from the same database that records every pipeline run.
        </p>
      </div>
      <ul className="q-topics">
        {TOPICS.map((topic) => (
          <li key={topic.title} className="q-topic">
            <span className="q-topic-icon">
              <Icon name={topic.icon} size={16} />
            </span>
            <div>
              <p className="q-topic-title">{topic.title}</p>
              <p className="q-topic-text">{topic.text}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function QueryLoading({ question, startedAt }: { question: string; startedAt: number }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  return (
    <section className="panel q-result" aria-busy="true" aria-label="Working on your question">
      <QuestionEcho
        question={question}
        meta={
          <span className="q-working">
            <span className="spinner" aria-hidden="true" />
            Working · {elapsed}s
          </span>
        }
      />
      <div className="q-loading">
        <p className="q-loading-text">
          Interpreting your question, generating a read-only SQL query when data is needed and
          summarizing the result. This can take several seconds.
        </p>
        <div className="skeleton q-skel q-skel-1" />
        <div className="skeleton q-skel q-skel-2" />
        <div className="skeleton q-skel q-skel-3" />
      </div>
    </section>
  );
}

function ResultsTable({ data, links }: { data: QueryExecutionResult; links: RunLinks }) {
  const { columns, rows } = data;

  if (rows.length === 0) {
    return (
      <div className="q-results-empty">
        <EmptyState compact icon="search" title="The query returned no rows">
          The SQL ran successfully but matched nothing. Try broadening the question or check the
          generated SQL below.
        </EmptyState>
      </div>
    );
  }

  const numeric = columns.map(
    (c) =>
      rows.some((r) => typeof r[c] === "number") &&
      rows.every((r) => r[c] == null || typeof r[c] === "number"),
  );

  return (
    <div className="q-results">
      <div className="q-results-bar">
        <h2 className="q-results-title">Results</h2>
        <span className="q-results-count">
          {plural(rows.length, "row")}
          {rows.length >= MAX_ROWS && ` · limited to the first ${MAX_ROWS}`}
        </span>
      </div>
      <div className="table-wrap q-table-wrap">
        <table className="table table-compact q-table">
          <thead>
            <tr>
              {columns.map((c, j) => (
                <th key={j} scope="col" className={numeric[j] ? "num" : undefined} title={c}>
                  {humanizeColumn(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const rowRun =
                Object.values(row).find(
                  (v): v is string => typeof v === "string" && RUN_ID.test(v),
                ) ?? null;
              return (
                <tr key={i}>
                  {columns.map((c, j) => (
                    <td key={j} className={numeric[j] ? "num" : undefined}>
                      {renderCell(c, row[c], rowRun, links)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SqlDisclosure({ sql }: { sql: string }) {
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    if (copy === "idle") return;
    const timer = setTimeout(() => setCopy("idle"), 2000);
    return () => clearTimeout(timer);
  }, [copy]);

  async function copySql() {
    try {
      await navigator.clipboard.writeText(sql);
      setCopy("copied");
    } catch {
      setCopy("failed");
    }
  }

  return (
    <details className="q-sql">
      <summary className="q-sql-summary">
        <Icon name="chevronRight" size={14} className="q-sql-chevron" />
        View generated SQL
      </summary>
      <div className="q-sql-body">
        <div className="q-sql-block">
          <div className="q-sql-toolbar">
            <span className="q-sql-lang">SQLite · read-only</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={copySql}>
              <Icon name={copy === "copied" ? "check" : "copy"} size={14} />
              <span aria-live="polite">
                {copy === "copied" ? "Copied" : copy === "failed" ? "Copy failed" : "Copy SQL"}
              </span>
            </button>
          </div>
          <pre className="q-sql-code">
            <code>{sql}</code>
          </pre>
        </div>
      </div>
    </details>
  );
}

function QueryAnswer({
  outcome,
  links,
}: {
  outcome: Extract<Outcome, { kind: "result" }>;
  links: RunLinks;
}) {
  const { question, response, ms } = outcome;
  const general = response.type === "general_question";

  return (
    <section className="panel q-result" aria-label="Answer">
      <QuestionEcho
        question={question}
        meta={`${general ? "General answer" : "Database query"} · ${(ms / 1000).toFixed(1)}s`}
      />
      <div className="q-answer">
        <span className="q-answer-mark" aria-hidden="true">
          <Icon name="sparkle" size={16} />
        </span>
        <div className="q-answer-body">
          <p className="q-answer-text">{response.answer}</p>
          {general && (
            <p className="q-answer-note">
              General explanation — no database query was run for this question.
            </p>
          )}
        </div>
      </div>
      {response.data && <ResultsTable data={response.data} links={links} />}
      {response.sql && <SqlDisclosure sql={response.sql} />}
    </section>
  );
}

function QueryFailureView({
  question,
  failure,
  onRetry,
}: {
  question: string;
  failure: Failure;
  onRetry: () => void;
}) {
  const info = describeFailure(failure);
  return (
    <section className="panel q-result" aria-label="Query error">
      <QuestionEcho question={question} />
      <div className={`q-failure tone-${info.tone}`}>
        <span className="q-failure-icon" aria-hidden="true">
          <Icon name={info.icon} size={18} />
        </span>
        <div className="q-failure-body">
          <p className="q-failure-title">{info.title}</p>
          <p className="q-failure-text">{info.text}</p>
          {info.detail && (
            <p className="q-failure-detail">
              Server message: <span className="mono">{info.detail}</span>
            </p>
          )}
          {info.retry && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>
              <Icon name="refresh" size={14} />
              Try again
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function QueryHistory({
  entries,
  active,
  disabled,
  onRun,
}: {
  entries: HistoryEntry[];
  active: string | null;
  disabled: boolean;
  onRun: (question: string) => void;
}) {
  return (
    <section className="panel q-history" aria-labelledby="q-history-title">
      <div className="q-history-head">
        <h2 id="q-history-title" className="q-rail-title">
          This session
        </h2>
        {entries.length > 0 && <span className="q-history-count">{entries.length}</span>}
      </div>
      {entries.length === 0 ? (
        <p className="q-history-empty">
          Questions you ask appear here so you can run them again. They are not saved and clear when
          you leave this page.
        </p>
      ) : (
        <ul className="q-history-list">
          {entries.map((entry) => (
            <li key={entry.question}>
              <button
                type="button"
                className={
                  entry.question === active ? "q-history-item is-active" : "q-history-item"
                }
                onClick={() => onRun(entry.question)}
                disabled={disabled}
                title="Run again"
              >
                <Icon
                  name={entry.ok ? "checkCircle" : "alert"}
                  size={14}
                  className={entry.ok ? "q-history-ok" : "q-history-err"}
                />
                <span className="q-history-text">
                  <span className="q-history-q">
                    <span className="sr-only">Run again: </span>
                    {entry.question}
                  </span>
                  <span className="q-history-meta">
                    {entry.summary} ·{" "}
                    {new Date(entry.at).toLocaleTimeString(undefined, {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </span>
                <Icon name="refresh" size={13} className="q-history-rerun" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function QueryPanel() {
  const { runs } = useRuns();
  const links = useMemo(() => indexRuns(runs), [runs]);
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState<{ question: string; startedAt: number } | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const busy = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [question]);

  async function run(text: string) {
    const q = text.trim();
    if (!q || busy.current) return;
    busy.current = true;
    const startedAt = Date.now();
    setQuestion(q);
    setPending({ question: q, startedAt });

    let next: Outcome;
    try {
      const response = await api.ask(q);
      if (!response?.answer) {
        throw new ApiError("The query service returned an unexpected response.", 200, null);
      }
      next = { id: startedAt, kind: "result", question: q, response, ms: Date.now() - startedAt };
    } catch (err) {
      next = { id: startedAt, kind: "error", question: q, failure: toFailure(err) };
    }
    const entry: HistoryEntry = {
      question: q,
      ok: next.kind === "result",
      summary: summarize(next),
      at: Date.now(),
    };

    busy.current = false;
    setPending(null);
    setOutcome(next);
    setHistory((prev) => [entry, ...prev.filter((h) => h.question !== q)].slice(0, HISTORY_LIMIT));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    run(question);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      run(question);
    }
  }

  const announcement = pending
    ? "Working on your question."
    : outcome?.kind === "result"
      ? outcome.response.answer
      : outcome
        ? describeFailure(outcome.failure).title
        : "";

  return (
    <div className="q-layout">
      <div className="q-main">
        <form className="q-composer" onSubmit={submit} aria-busy={pending !== null}>
          <label htmlFor="q-input" className="sr-only">
            Ask a question about your trade operations
          </label>
          <div className="q-input-row">
            <Icon name="sparkle" size={18} className="q-input-icon" />
            <textarea
              id="q-input"
              ref={inputRef}
              className="q-input"
              rows={2}
              value={question}
              maxLength={MAX_LENGTH}
              placeholder="Which shipments are waiting for human review?"
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={onKeyDown}
              aria-describedby="q-input-hint"
            />
          </div>
          <div className="q-composer-footer">
            <FlowIndicator states={flowStates(pending !== null, outcome)} />
            <div className="q-composer-actions">
              <span id="q-input-hint" className="q-hint">
                {question.length > MAX_LENGTH - 100 ? (
                  `${question.length} / ${MAX_LENGTH}`
                ) : (
                  <>
                    <kbd>Enter</kbd> to ask · <kbd>Shift</kbd> + <kbd>Enter</kbd> for a new line
                  </>
                )}
              </span>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!question.trim() || pending !== null}
              >
                {pending ? (
                  <>
                    <span className="spinner q-btn-spinner" aria-hidden="true" />
                    Asking…
                  </>
                ) : (
                  <>
                    Ask
                    <Icon name="arrowRight" size={15} />
                  </>
                )}
              </button>
            </div>
          </div>
        </form>

        <div className="q-suggestions" role="group" aria-labelledby="q-suggestions-label">
          <span id="q-suggestions-label" className="q-suggestions-label">
            Suggested
          </span>
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              className="q-chip"
              onClick={() => run(s)}
              disabled={pending !== null}
            >
              {s}
            </button>
          ))}
        </div>

        {pending ? (
          <QueryLoading
            key={pending.startedAt}
            question={pending.question}
            startedAt={pending.startedAt}
          />
        ) : outcome?.kind === "result" ? (
          <QueryAnswer key={outcome.id} outcome={outcome} links={links} />
        ) : outcome ? (
          <QueryFailureView
            key={outcome.id}
            question={outcome.question}
            failure={outcome.failure}
            onRetry={() => run(outcome.question)}
          />
        ) : (
          <QueryIntro />
        )}
        <p className="sr-only" aria-live="polite">
          {announcement}
        </p>
      </div>

      <aside className="q-rail" aria-label="Query history">
        <QueryHistory
          entries={history}
          active={pending?.question ?? outcome?.question ?? null}
          disabled={pending !== null}
          onRun={run}
        />
        <div className="callout q-safety">
          <Icon name="shield" size={16} />
          <p>
            <strong>Read-only by design.</strong> Each question becomes a single SELECT query on
            Nova&apos;s database; anything that could modify data is rejected and results are capped
            at {MAX_ROWS} rows. Answers are summarized by a language model — the table and SQL show
            the exact data.
          </p>
        </div>
      </aside>
    </div>
  );
}
