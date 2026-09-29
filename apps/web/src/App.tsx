import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, type RunSummary, type RunView } from "./api.js";
import { QueryPanel } from "./QueryPanel.js";
import { RunDetail } from "./RunDetail.js";

const MIN_CONFIDENCE = 0.8;
const isDone = (status: string) => status === "COMPLETED" || status === "FAILED";

export function App() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selectedId, setSelectedId] = useState(() => location.hash.slice(1) || null);
  const [run, setRun] = useState<RunView | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const refreshRuns = useCallback(
    () =>
      api
        .listRuns()
        .then(setRuns)
        .catch(() => {}),
    [],
  );

  useEffect(() => {
    refreshRuns();
  }, [refreshRuns]);

  useEffect(() => {
    if (!selectedId) return;
    location.hash = selectedId;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const next = await api.getRun(selectedId);
        setRun(next);
        if (isDone(next.status)) refreshRuns();
        else timer = setTimeout(load, 1500);
      } catch (err) {
        setError((err as Error).message);
      }
    };
    load();
    return () => clearTimeout(timer);
  }, [selectedId, refreshRuns]);

  async function upload(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const { runId } = await api.upload(file);
      setRun(null);
      setSelectedId(runId);
      refreshRuns();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <main>
      <h1>Nova — Trade Document Pipeline</h1>
      <p className="muted">Extract → Validate → Decide. Uncertain fields always go to a human.</p>

      <div className="layout">
        <aside>
          <section className="card">
            <h2>Upload document</h2>
            <form onSubmit={upload}>
              <input
                type="file"
                accept="application/pdf,image/png,image/jpeg,image/webp"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <button disabled={!file || uploading}>{uploading ? "Uploading…" : "Process"}</button>
            </form>
            {error && <p className="error">{error}</p>}
          </section>

          <section className="card">
            <h2>Recent runs</h2>
            {runs.length === 0 && <p className="muted">No documents processed yet.</p>}
            <ul className="runs">
              {runs.map((r) => (
                <li key={r.id}>
                  <button
                    className={`link ${r.id === selectedId ? "active" : ""}`}
                    onClick={() => setSelectedId(r.id)}
                  >
                    {r.filename}
                    <span className={`tag ${r.decision ?? "pending"}`}>
                      {r.decision?.replaceAll("_", " ") ?? r.status.toLowerCase()}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </aside>

        <div>
          {run ? (
            <RunDetail run={run} minConfidence={MIN_CONFIDENCE} />
          ) : (
            <section className="card muted">
              Upload a document or pick a run to see its pipeline.
            </section>
          )}
          <QueryPanel />
        </div>
      </div>
    </main>
  );
}
