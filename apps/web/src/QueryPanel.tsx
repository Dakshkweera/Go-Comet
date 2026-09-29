import { useState, type FormEvent } from "react";
import type { QueryResponse } from "@nova/contracts";
import { api } from "./api.js";

const EXAMPLES = [
  "How many shipments were flagged for human review this week?",
  "Which shipments received an amendment request?",
  "Which fields had mismatches?",
];

export function QueryPanel() {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<QueryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setResult(await api.ask(question));
    } catch (err) {
      setResult(null);
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const rows = result?.data?.rows ?? [];
  const columns = result?.data?.columns ?? [];

  return (
    <section className="card">
      <h2>Ask about processed shipments</h2>
      <form onSubmit={submit} className="row">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={EXAMPLES[0]}
          list="examples"
        />
        <datalist id="examples">
          {EXAMPLES.map((q) => (
            <option key={q} value={q} />
          ))}
        </datalist>
        <button disabled={busy || !question.trim()}>{busy ? "Asking…" : "Ask"}</button>
      </form>
      {error && <p className="error">{error}</p>}
      {result && (
        <>
          <p className="answer">{result.answer}</p>
          {rows.length > 0 && (
            <table>
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i}>
                    {columns.map((c) => (
                      <td key={c}>{String(row[c] ?? "")}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {result.sql && (
            <details>
              <summary>SQL</summary>
              <pre>{result.sql}</pre>
            </details>
          )}
        </>
      )}
    </section>
  );
}
