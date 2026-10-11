import type {
  DeleteShipmentResult,
  Draft,
  EmailUploadResult,
  HealthResponse,
  Metrics,
  QueryResponse,
  ReviewRequest,
  SampleEmail,
  SentEmail,
  ShipmentStatus,
  ShipmentSummary,
  ShipmentView,
} from "./types/api.js";
import { apiUrl } from "./config.js";
import type { RunView } from "./types/api.js";

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), init);
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

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const shipmentPath = (id: string, rest = "") => `/api/shipments/${encodeURIComponent(id)}${rest}`;

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
  listShipments: () => request<ShipmentSummary[]>("/api/shipments"),
  getShipment: (id: string) => request<ShipmentView>(shipmentPath(id)),
  deleteShipment: (id: string) =>
    request<DeleteShipmentResult>(shipmentPath(id), { method: "DELETE" }),
  review: (id: string, body: ReviewRequest) =>
    request<ShipmentView>(shipmentPath(id, "/review"), jsonInit("POST", body)),
  setDocumentType: (id: string, documentId: string, docType: string) =>
    request<ShipmentView>(
      shipmentPath(id, `/documents/${encodeURIComponent(documentId)}/type`),
      jsonInit("PUT", { docType }),
    ),
  saveDraft: (id: string, body: { version: number; to: string; subject: string; body: string }) =>
    request<Draft>(shipmentPath(id, "/draft"), jsonInit("PUT", body)),
  sendDraft: (id: string, version: number) =>
    request<{ sentEmail: SentEmail; status: ShipmentStatus }>(
      shipmentPath(id, "/draft/send"),
      jsonInit("POST", { version }),
    ),
  listSentEmails: () => request<SentEmail[]>("/api/sent-emails"),
  listSamples: () => request<SampleEmail[]>("/api/inbox/samples"),
  deliverSample: (name: string) =>
    request<{ file: string }>(`/api/inbox/samples/${encodeURIComponent(name)}/deliver`, {
      method: "POST",
    }),
  uploadEmail: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<EmailUploadResult>("/api/inbox/emails", { method: "POST", body: form });
  },
  metrics: () => request<Metrics>("/api/metrics"),
  health: async (): Promise<HealthResponse | null> => {
    const res = await fetch(apiUrl("/api/health"));
    return (await res.json().catch(() => null)) as HealthResponse | null;
  },
};
