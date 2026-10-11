import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { api, ApiError } from "./api.js";
import { isProcessing, mailRows } from "./shipmentDomain.js";
import type { Draft, Metrics, SentEmail, ShipmentSummary, ShipmentView } from "./types/api.js";

const POLL_MS = 2000;
const IDLE_POLL_MS = 5000;
// An email dropped in the inbox is ingested by the backend within ~2 s; keep looking for a while.
const ARRIVAL_MS = 8000;
const ARRIVAL_POLL_MS = 1000;

type Store = {
  summaries: ShipmentSummary[] | null;
  details: ReadonlyMap<string, ShipmentView>;
  sent: SentEmail[] | null;
  error: string | null;
  sentError: string | null;
};

let store: Store = {
  summaries: null,
  details: new Map(),
  sent: null,
  error: null,
  sentError: null,
};
const listeners = new Set<() => void>();

function update(patch: Partial<Store>) {
  store = { ...store, ...patch };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const summaryOf = (v: ShipmentView): ShipmentSummary => ({
  id: v.id,
  reference: v.reference,
  subject: v.subject,
  supplier: v.supplier,
  customer: v.customer,
  status: v.status,
  stage: v.stage,
  decision: v.decision,
  headline: v.headline,
  cycle: v.cycle,
  attachments: v.attachments,
  openReviewItems: v.openReviewItems,
  amendmentItems: v.amendmentItems,
  receivedAt: v.receivedAt,
  updatedAt: v.updatedAt,
});

// Mutations return the new ShipmentView, so the page and the list both take it as is.
export function putShipment(view: ShipmentView) {
  const details = new Map(store.details);
  details.set(view.id, view);
  const summaries =
    store.summaries?.map((s) => (s.id === view.id ? summaryOf(view) : s)) ?? store.summaries;
  update({ details, summaries });
}

export function putDraft(id: string, draft: Draft) {
  const view = store.details.get(id);
  if (view) putShipment({ ...view, draft });
}

// A 404 means it is already gone, which is what the caller wanted.
export async function removeShipment(id: string) {
  try {
    await api.deleteShipment(id);
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 404)) throw err;
  }
  const details = new Map(store.details);
  details.delete(id);
  update({
    details,
    summaries: store.summaries?.filter((s) => s.id !== id) ?? null,
    sent: store.sent?.filter((e) => e.shipmentId !== id) ?? null,
  });
}

let inflight: Promise<void> | null = null;

export function refreshShipments(): Promise<void> {
  inflight ??= (async () => {
    try {
      const listed = await api.listShipments();
      const processing = listed.filter((s) => isProcessing(s.status));
      const fetched = await Promise.all(
        processing.map((s) => api.getShipment(s.id).catch(() => null)),
      );
      const details = new Map(store.details);
      for (const view of fetched) if (view) details.set(view.id, view);
      // A mutation made while this request was in flight is newer than the list.
      const summaries = listed.map((s) => {
        const known = details.get(s.id);
        return known && known.updatedAt > s.updatedAt ? summaryOf(known) : s;
      });
      update({ summaries, details, error: null });
    } catch (err) {
      update({ error: (err as Error).message });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

const arrivalKey = (s: ShipmentSummary) => `${s.id}:${s.cycle}`;

// A new email either creates a shipment or adds a cycle to one. Resolves with that shipment, or
// null when the inbox did not change (the backend ignores an email it has already received).
export async function sendAndAwaitArrival(
  send: () => Promise<unknown>,
): Promise<ShipmentSummary | null> {
  if (!store.summaries) await refreshShipments();
  if (!store.summaries) throw new Error(store.error ?? "Could not load the Inbox.");
  const before = new Set(store.summaries.map(arrivalKey));
  await send();
  for (const deadline = Date.now() + ARRIVAL_MS; Date.now() < deadline;) {
    await new Promise((resolve) => setTimeout(resolve, ARRIVAL_POLL_MS));
    await refreshShipments();
    const arrived = store.summaries?.find((s) => !before.has(arrivalKey(s)));
    if (arrived) return arrived;
  }
  return null;
}

// Pages that list shipments also look for new mail while idle; the sidebar only follows work in progress.
export function useShipments({ watchForMail = true } = {}) {
  const snap = useSyncExternalStore(subscribe, () => store);
  const active = snap.summaries?.some((s) => isProcessing(s.status)) ?? false;

  useEffect(() => {
    void refreshShipments();
  }, []);

  useEffect(() => {
    const interval = active ? POLL_MS : watchForMail ? IDLE_POLL_MS : 0;
    if (!interval) return;
    const timer = setInterval(() => {
      if (!document.hidden) void refreshShipments();
    }, interval);
    return () => clearInterval(timer);
  }, [active, watchForMail]);

  return {
    shipments: snap.summaries,
    details: snap.details,
    loading: snap.summaries === null && !snap.error,
    error: snap.summaries === null ? snap.error : null,
    refresh: refreshShipments,
  };
}

// A failed refresh keeps the list on screen, so its error is reported separately.
export function useRefreshError() {
  const snap = useSyncExternalStore(subscribe, () => store);
  return snap.summaries === null ? null : snap.error;
}

// The list has no emails, so each shipment is opened once; later polls only fetch what changed.
async function loadMissingDetails() {
  const stale = (store.summaries ?? []).filter((s) => {
    const known = store.details.get(s.id);
    return !known || known.updatedAt < s.updatedAt;
  });
  if (stale.length === 0) return;
  const fetched = await Promise.all(stale.map((s) => api.getShipment(s.id).catch(() => null)));
  const details = new Map(store.details);
  for (const view of fetched) if (view) details.set(view.id, view);
  update({ details });
}

export function useMail() {
  const { shipments, details, loading, error, refresh } = useShipments();

  useEffect(() => {
    if (shipments) void loadMissingDetails();
  }, [shipments]);

  const rows = useMemo(
    () => mailRows(shipments?.flatMap((s) => details.get(s.id) ?? []) ?? []),
    [shipments, details],
  );
  const opening = shipments?.some((s) => !details.has(s.id)) ?? false;

  return { rows, loading: loading || (opening && rows.length === 0), error, refresh };
}

export function useShipment(id: string) {
  const snap = useSyncExternalStore(subscribe, () => store);
  const view = snap.details.get(id) ?? null;
  const [error, setError] = useState<{ id: string; message: string; notFound: boolean } | null>(
    null,
  );
  const processing = view ? isProcessing(view.status) : false;

  const reload = useCallback(async () => {
    try {
      putShipment(await api.getShipment(id));
      setError(null);
    } catch (err) {
      setError({
        id,
        message: (err as Error).message,
        notFound: err instanceof ApiError && err.status === 404,
      });
    }
  }, [id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!processing) return;
    const timer = setInterval(() => void reload(), POLL_MS);
    return () => clearInterval(timer);
  }, [processing, reload]);

  return { view, error: view || error?.id !== id ? null : error, reload };
}

export async function refreshSentEmails() {
  try {
    update({ sent: await api.listSentEmails(), sentError: null });
  } catch (err) {
    update({ sentError: (err as Error).message });
  }
}

export function useSentEmails() {
  const snap = useSyncExternalStore(subscribe, () => store);

  useEffect(() => {
    void refreshSentEmails();
  }, []);

  return {
    sent: snap.sent,
    loading: snap.sent === null && !snap.sentError,
    error: snap.sent === null ? snap.sentError : null,
    refresh: refreshSentEmails,
  };
}

export function useMetrics() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .metrics()
      .then((m) => !cancelled && setMetrics(m))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return metrics;
}
