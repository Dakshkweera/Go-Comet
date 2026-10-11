import type { ExtractionField } from "../../schemas/index.js";
import { normalizeHsCode } from "./reliability.js";
import { toKg } from "./validator.js";

const LEGAL_SUFFIXES = new Set([
  "pvt",
  "private",
  "ltd",
  "limited",
  "inc",
  "llc",
  "co",
  "company",
  "corp",
  "corporation",
]);

export function normalizeCustomerName(name: string): string {
  return name
    .split(/[,\n]/)[0]!
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((word) => word && !LEGAL_SUFFIXES.has(word))
    .join(" ");
}

const INCOTERM = /\b(EXW|FCA|FAS|FOB|CFR|CIF|CPT|CIP|DAP|DPU|DDP)\b/i;

/** Safe normalisation only: case, spacing, punctuation and equivalent formats. */
function textKey(field: ExtractionField, value: string): string {
  switch (field) {
    case "consignee_name":
      return normalizeCustomerName(value);
    case "hs_code":
      return normalizeHsCode(value).replace(/\D/g, "");
    case "incoterms":
      return (value.match(INCOTERM)?.[1] ?? value).trim().toUpperCase();
    case "invoice_number":
      return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    case "port_of_loading":
    case "port_of_discharge":
      return value.split(",")[0]!.trim().replace(/\s+/g, " ").toLowerCase();
    default:
      return value.trim().replace(/\s+/g, " ").toLowerCase();
  }
}

export type Reading = { value: string | number; unit?: string | null };

/** true or false when two readings can be compared; null when they cannot (e.g. unknown unit). */
export function sameValue(field: ExtractionField, a: Reading, b: Reading): boolean | null {
  if (field === "gross_weight") {
    if (typeof a.value !== "number" || typeof b.value !== "number") return null;
    const bothUnitless = !a.unit && !b.unit;
    const x = bothUnitless ? a.value : toKg(a.value, a.unit);
    const y = bothUnitless ? b.value : toKg(b.value, b.unit);
    if (x === null || y === null) return null;
    return Math.abs(x - y) <= Math.max(1, 0.001 * Math.max(x, y));
  }
  const x = textKey(field, String(a.value));
  const y = textKey(field, String(b.value));
  if (field === "hs_code" && x !== y) {
    const [short, long] = x.length <= y.length ? [x, y] : [y, x];
    return short.length >= 6 && long.startsWith(short);
  }
  return x === y;
}

export const formatValue = (value: string | number | null, unit?: string | null) =>
  value === null ? "—" : typeof value === "number" && unit ? `${value} ${unit}` : String(value);
