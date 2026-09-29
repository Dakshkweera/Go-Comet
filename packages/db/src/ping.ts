import type { NovaDb } from "./client.js";

export function pingDb(db: NovaDb): boolean {
  try {
    return (db.$client.prepare("SELECT 1 AS ok").get() as { ok: number }).ok === 1;
  } catch {
    return false;
  }
}
