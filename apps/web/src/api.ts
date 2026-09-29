import type { QueryResponse } from "@nova/contracts";
import type { RunView } from "@nova/pipeline";

export type { RunView };
export type RunSummary = {
  id: string;
  filename: string;
  status: string;
  decision: string | null;
  createdAt: string;
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
  return body as T;
}

export const api = {
  listRuns: () => request<RunSummary[]>("/api/runs"),
  getRun: (id: string) => request<RunView>(`/api/runs/${id}`),
  upload: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ runId: string; duplicateOfRunId: string | null }>("/api/runs", {
      method: "POST",
      body: form,
    });
  },
  ask: (question: string) =>
    request<QueryResponse>("/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    }),
};
