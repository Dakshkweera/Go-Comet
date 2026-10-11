import type {
  CustomerResolution,
  CustomerRule,
  DocType,
  ExtractionResult,
  IssueResolution,
  ShipmentDocument,
} from "../../src/schemas/index.js";
import { FAKE_EXTRACTION } from "../../src/services/extraction/index.js";
import { assessShipment } from "../../src/services/shipment/assess.js";
import { createValidator, normalizeCustomerName } from "../../src/services/validation/index.js";

export const text = (value: string | null, confidence = 0.97) => ({
  value,
  confidence,
  evidence: value,
  candidates: null,
  evidenceStatus: "supported" as const,
});

export const weight = (value: number, unit = "kg", confidence = 0.97) => ({
  value,
  unit,
  confidence,
  evidence: `${value} ${unit}`,
  candidates: null,
  evidenceStatus: "supported" as const,
});

export function doc(
  id: string,
  docType: DocType | null,
  fields: Partial<ExtractionResult> = {},
  extra: Partial<ShipmentDocument> = {},
): ShipmentDocument {
  return {
    id,
    filename: `${id}.pdf`,
    docType,
    cycle: 1,
    status: "extracted",
    error: null,
    extraction: { ...FAKE_EXTRACTION, ...fields },
    unchanged: false,
    ...extra,
  };
}

export const failedDoc = (id: string): ShipmentDocument => ({
  id,
  filename: `${id}.pdf`,
  docType: null,
  cycle: 1,
  status: "failed",
  error: { code: "DOCUMENT_READ_ERROR", message: "The PDF could not be parsed." },
  extraction: null,
  unchanged: false,
});

export const cleanSet = () => [
  doc("ci", "COMMERCIAL_INVOICE"),
  doc("bl", "BOL"),
  doc("pl", "PACKING_LIST"),
];

export const BATA_RULES: CustomerRule[] = [
  ["hs_code", "EXACT", "640399"],
  ["port_of_loading", "EXACT", "Shanghai"],
  ["port_of_discharge", "EXACT", "Mumbai"],
  ["incoterms", "EXACT", "FOB"],
].map(([field, operator, expectedValue]) => ({
  id: `rule_${field}`,
  customerId: "cust_bata",
  field: field as CustomerRule["field"],
  operator: operator as CustomerRule["operator"],
  expectedValue: expectedValue!,
  minValue: null,
  maxValue: null,
  unit: null,
  isActive: true,
}));
BATA_RULES.push({
  id: "rule_gross_weight",
  customerId: "cust_bata",
  field: "gross_weight",
  operator: "MAX",
  expectedValue: null,
  minValue: null,
  maxValue: 1000,
  unit: "kg",
  isActive: true,
});

export function resolveBata(name: string | null): CustomerResolution {
  if (name && normalizeCustomerName(name) === "bata india") {
    return {
      status: "resolved",
      customerId: "cust_bata",
      customerName: "Bata India",
      reason: `"${name}" matched configured customer Bata India.`,
    };
  }
  return {
    status: "not_found",
    customerId: null,
    customerName: null,
    reason: name ? `No configured customer matches "${name}".` : "No consignee name was extracted.",
  };
}

const validator = createValidator({ minConfidence: 0.8 });

export const decide = (key: string, action: "clarify" | "amend", value?: string, note?: string) =>
  [key, { action, value: value ?? null, note: note ?? null, at: "2026-10-11T00:00:00Z" }] as [
    string,
    IssueResolution,
  ];

export function assess(
  documents: ShipmentDocument[],
  actions: [string, IssueResolution][] = [],
  rules: CustomerRule[] = BATA_RULES,
) {
  return assessShipment({
    documents,
    actions: new Map(actions),
    resolveCustomer: resolveBata,
    loadRules: () => rules,
    validator,
    minConfidence: 0.8,
  });
}
