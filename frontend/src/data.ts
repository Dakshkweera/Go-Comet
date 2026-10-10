import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { api, ApiError, type RunSummary, type RunView } from "./api.js";
import { isFinal, toRecord, type RunRecord } from "./domain.js";

type Store = {
  summaries: RunSummary[] | null;
  details: ReadonlyMap<string, RunView>;
  error: string | null;
};

let store: Store = { summaries: null, details: new Map(), error: null };
const listeners = new Set<() => void>();

function update(patch: Partial<Store>) {
  store = { ...store, ...patch };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function putDetail(run: RunView) {
  const details = new Map(store.details);
  details.set(run.id, run);
  update({ details });
}

export const RUN_LIST_LIMIT = 50;

// Deleted ids stay filtered out, so a list request already in flight cannot bring a run back.
const deleted = new Set<string>();

export function forgetRun(id: string) {
  deleted.add(id);
  const details = new Map(store.details);
  details.delete(id);
  update({ summaries: store.summaries?.filter((s) => s.id !== id) ?? null, details });
  void refreshRuns();
}

let inflight: Promise<void> | null = null;

export function refreshRuns(): Promise<void> {
  inflight ??= (async () => {
    try {
      const summaries = (await api.listRuns()).filter((s) => !deleted.has(s.id));
      const stale = summaries.filter((s) => {
        const cached = store.details.get(s.id);
        return !cached || !isFinal(cached.status) || cached.status !== s.status;
      });
      const fetched = await Promise.all(stale.map((s) => api.getRun(s.id).catch(() => null)));
      const details = new Map(store.details);
      for (const run of fetched) if (run && !deleted.has(run.id)) details.set(run.id, run);
      update({ summaries, details, error: null });
    } catch (err) {
      update({ error: (err as Error).message });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function useRuns() {
  const snap = useSyncExternalStore(subscribe, () => store);
  const processing = snap.summaries?.some((s) => !isFinal(s.status)) ?? false;

  useEffect(() => {
    refreshRuns();
  }, []);

  useEffect(() => {
    if (!processing) return;
    const timer = setInterval(refreshRuns, 2500);
    return () => clearInterval(timer);
  }, [processing]);

  const runs = useMemo<RunRecord[] | null>(
    () => snap.summaries?.map((s) => toRecord(s, snap.details.get(s.id) ?? null)) ?? null,
    [snap.summaries, snap.details],
  );

  return {
    runs,
    loading: snap.summaries === null && !snap.error,
    error: snap.summaries === null ? snap.error : null,
    truncated: (snap.summaries?.length ?? 0) >= RUN_LIST_LIMIT,
  };
}

export function useRun(id: string | null) {
  const snap = useSyncExternalStore(subscribe, () => store);
  const [error, setError] = useState<{ id: string; message: string; notFound: boolean } | null>(
    null,
  );

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const next = await api.getRun(id);
        if (cancelled) return;
        const wasFinal = isFinal(store.details.get(id)?.status ?? "");
        putDetail(next);
        if (!isFinal(next.status)) timer = setTimeout(load, 1500);
        else if (!wasFinal) refreshRuns();
      } catch (err) {
        if (cancelled) return;
        const notFound = err instanceof ApiError && err.status === 404;
        setError({ id, message: (err as Error).message, notFound });
        if (!notFound) timer = setTimeout(load, 3000);
      }
    };
    const cached = store.details.get(id);
    if (!cached || !isFinal(cached.status)) load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id]);

  const run = id ? (snap.details.get(id) ?? null) : null;
  const currentError = error && error.id === id && !run ? error : null;
  return { run, error: currentError };
}
