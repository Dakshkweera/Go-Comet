import type { HealthResponse, QueryResponse } from "../../../packages/contracts/src/index.js";
import type { RunView } from "../../../packages/pipeline/src/index.js";

export type { RunView };
export type RunSummary = {
  id: string;
  filename: string;
  status: string;
  decision: string | null;
  createdAt: string;
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(
      body?.error?.message ?? `Request failed (${res.status})`,
      res.status,
      body?.error?.code ?? null,
    );
  }
  return body as T;
}

export const api = {
  listRuns: () => request<RunSummary[]>("/api/runs"),
  getRun: (id: string) => request<RunView>(`/api/runs/${encodeURIComponent(id)}`),
  upload: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ runId: string; duplicateOfRunId: string | null }>("/api/runs", {
      method: "POST",
      body: form,
    });
  },
  deleteRun: (id: string) =>
    request<{ deleted: true; runId: string; documentId: string; fileDeleted: boolean }>(
      `/api/runs/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    ),
  ask: (question: string) =>
    request<QueryResponse>("/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    }),
  health: async (): Promise<HealthResponse | null> => {
    const res = await fetch("/api/health");
    return (await res.json().catch(() => null)) as HealthResponse | null;
  },
};
