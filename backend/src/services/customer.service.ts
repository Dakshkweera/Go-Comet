import { and, eq } from "drizzle-orm";
import type { CustomerResolution, CustomerRule } from "../schemas/index.js";
import { customerRules, customers, type NovaDb } from "../db/index.js";

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

export function resolveCustomer(db: NovaDb, consigneeName: string | null): CustomerResolution {
  const notFound = (reason: string): CustomerResolution => ({
    status: "not_found",
    customerId: null,
    customerName: null,
    reason,
  });
  if (!consigneeName) return notFound("No consignee name was extracted from the document.");

  const matches = db
    .select()
    .from(customers)
    .where(eq(customers.normalizedName, normalizeCustomerName(consigneeName)))
    .all();
  if (matches.length > 1) {
    return {
      status: "ambiguous",
      customerId: null,
      customerName: null,
      reason: `"${consigneeName}" matches ${matches.length} customers.`,
    };
  }
  const [match] = matches;
  if (!match) return notFound(`No configured customer matches "${consigneeName}".`);
  return {
    status: "resolved",
    customerId: match.id,
    customerName: match.name,
    reason: `"${consigneeName}" matched configured customer ${match.name}.`,
  };
}

export function loadRules(db: NovaDb, customerId: string): CustomerRule[] {
  return db
    .select()
    .from(customerRules)
    .where(and(eq(customerRules.customerId, customerId), eq(customerRules.isActive, true)))
    .all()
    .map((r) => ({
      id: r.id,
      customerId: r.customerId,
      field: r.field as CustomerRule["field"],
      operator: r.operator as CustomerRule["operator"],
      expectedValue: r.expectedValue,
      minValue: r.minValue,
      maxValue: r.maxValue,
      unit: r.unit,
      isActive: r.isActive,
    }));
}
