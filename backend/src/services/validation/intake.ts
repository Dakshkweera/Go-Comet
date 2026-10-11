import {
  DOC_TYPE_LABELS,
  REQUIRED_FIELDS,
  type CustomerResolution,
  type ShipmentDocument,
  type ShipmentIssue,
} from "../../schemas/index.js";
import {
  isTyped,
  NOT_CROSS_CHECKED,
  REQUIRED_DOCUMENTS,
  REQUIRED_FIELDS_BY_TYPE,
  TYPED_DOCUMENTS,
} from "./documentRules.js";
import { describeDoc, fieldLabel, lower, makeIssue, names } from "./issues.js";
import { formatValue, sameValue } from "./keys.js";
import { assessField } from "./reliability.js";

export type IntakeInput = {
  documents: ShipmentDocument[];
  customer: CustomerResolution;
  rulesCount: number;
  minConfidence: number;
};

const present = (doc: ShipmentDocument, field: (typeof REQUIRED_FIELDS)[number]) => {
  const value = doc.extraction?.[field].value;
  return value !== null && value !== undefined && value !== "";
};

/** Stage 1: is the set complete and readable enough to validate at all? */
export function checkIntake({
  documents,
  customer,
  rulesCount,
  minConfidence,
}: IntakeInput): ShipmentIssue[] {
  const issue = (i: Parameters<typeof makeIssue>[0]) => issues.push(makeIssue(i));
  const issues: ShipmentIssue[] = [];

  if (documents.length === 0) {
    issue({
      stage: "intake",
      severity: "amendment",
      kind: "no_attachments",
      field: null,
      documentIds: [],
      message: "The email had no documents attached.",
      request: "The email had no documents attached. Please send the shipment documents.",
      allowedActions: [],
    });
    return issues;
  }

  const failed = documents.filter((d) => d.status === "failed");
  const extracted = documents.filter((d) => d.status === "extracted" && d.extraction);
  const typed = extracted.filter((d) => isTyped(d.docType));
  const other = extracted.filter((d) => d.docType === "OTHER");

  for (const doc of failed) {
    issue({
      stage: "intake",
      severity: "amendment",
      kind: "attachment_failed",
      field: null,
      documentIds: [doc.id],
      message: `${doc.filename} could not be read: ${doc.error?.message ?? "unknown error"}`,
      request: `We could not open ${doc.filename}. Please resend it.`,
      allowedActions: ["clarify"],
    });
  }

  for (const type of REQUIRED_DOCUMENTS) {
    if (typed.some((d) => d.docType === type)) continue;
    const label = lower(DOC_TYPE_LABELS[type]);
    const base = { stage: "intake", kind: "missing_document", field: null } as const;
    if (other.length > 0) {
      issue({
        ...base,
        severity: "review",
        documentIds: other.map((d) => d.id),
        message: `No ${label} was identified. ${names(other)} could not be classified and may be it.`,
        request: `We did not find a ${label} among the documents. Please send it.`,
        allowedActions: ["clarify", "amend"],
      });
    } else if (failed.length > 0) {
      issue({
        ...base,
        severity: "amendment",
        documentIds: failed.map((d) => d.id),
        message: `No readable ${label} was found.`,
        request: `If ${names(failed)} was the ${label}, resending it is enough; otherwise please also send the ${label}.`,
        allowedActions: ["clarify"],
      });
    } else {
      issue({
        ...base,
        severity: "amendment",
        documentIds: [],
        message: `No ${label} was received.`,
        request: `We did not receive a ${label}. Please send it.`,
        allowedActions: ["clarify"],
      });
    }
  }

  for (const doc of typed) {
    for (const field of REQUIRED_FIELDS) {
      const extractedField = doc.extraction![field];
      const label = lower(fieldLabel(field));
      if (!present(doc, field)) {
        if (!isTyped(doc.docType) || !REQUIRED_FIELDS_BY_TYPE[doc.docType].includes(field))
          continue;
        issue({
          stage: "intake",
          severity: "review",
          kind: "missing_field",
          field,
          documentIds: [doc.id],
          message: `${fieldLabel(field)} was not found on the ${lower(describeDoc(doc))}.`,
          request: `The ${lower(describeDoc(doc))} does not show the ${label}. Please add it.`,
          allowedActions: ["clarify", "amend"],
        });
        continue;
      }
      const { reliable, reasons } = assessField(field, extractedField, minConfidence);
      if (reliable) continue;
      issue({
        stage: "intake",
        severity: "review",
        kind: "unreliable_value",
        field,
        documentIds: [doc.id],
        found: formatValue(
          extractedField.value,
          "unit" in extractedField ? extractedField.unit : null,
        ),
        message: `${fieldLabel(field)} on the ${lower(describeDoc(doc))} could not be read reliably: ${reasons.join("; ")}.`,
        request: `We could not read the ${label} clearly on ${doc.filename}. Please confirm it or send a clearer copy.`,
        allowedActions: ["clarify", "amend"],
      });
    }
  }

  for (const type of TYPED_DOCUMENTS) {
    const group = typed.filter((d) => d.docType === type);
    if (group.length < 2) continue;
    for (const field of REQUIRED_FIELDS) {
      if (NOT_CROSS_CHECKED.has(field)) continue;
      const readings = group.filter(
        (d) =>
          present(d, field) && assessField(field, d.extraction![field], minConfidence).reliable,
      );
      const read = (d: ShipmentDocument) => {
        const f = d.extraction![field];
        return { value: f.value!, unit: "unit" in f ? f.unit : null };
      };
      if (!readings.some((d) => sameValue(field, read(readings[0]!), read(d)) === false)) continue;
      const list = readings
        .map((d) => `${d.filename}: ${formatValue(read(d).value, read(d).unit)}`)
        .join("; ");
      const plural = `${lower(DOC_TYPE_LABELS[type])}s`;
      issue({
        stage: "intake",
        severity: "review",
        kind: "duplicate_type_conflict",
        field,
        documentIds: readings.map((d) => d.id),
        found: list,
        message: `Two ${plural} disagree on the ${lower(fieldLabel(field))} (${list}). It may be a corrected copy, a duplicate or a split shipment.`,
        request: `The ${plural} you sent show different ${lower(fieldLabel(field))} values (${list}). Please confirm which is correct.`,
        allowedActions: ["clarify", "amend"],
      });
    }
  }

  if (customer.status !== "resolved") {
    issue({
      stage: "intake",
      severity: "review",
      kind: "customer_unresolved",
      field: null,
      documentIds: [],
      message: `Customer could not be identified: ${customer.reason}`,
      request:
        "We could not match the consignee on the documents to a customer on file. Please confirm the consignee.",
      allowedActions: ["amend"],
    });
  } else if (rulesCount === 0) {
    issue({
      stage: "intake",
      severity: "review",
      kind: "no_rules",
      field: null,
      documentIds: [],
      message: `No validation rules are configured for ${customer.customerName}.`,
      request: `No validation rules are configured for ${customer.customerName}.`,
      allowedActions: ["clarify"],
    });
  }
  return issues;
}

/** One customer for the whole set: every typed document's consignee must point to the same one. */
export function resolveShipmentCustomer(
  documents: ShipmentDocument[],
  resolve: (consignee: string | null) => CustomerResolution,
): CustomerResolution {
  const consignees = documents
    .filter((d) => d.status === "extracted" && isTyped(d.docType))
    .map((d) => d.extraction?.consignee_name.value ?? null)
    .filter((v): v is string => Boolean(v));
  if (consignees.length === 0) return resolve(null);

  const results = consignees.map(resolve);
  const resolved = results.filter((r) => r.status === "resolved");
  const ids = new Set(resolved.map((r) => r.customerId));
  if (ids.size > 1) {
    return {
      status: "ambiguous",
      customerId: null,
      customerName: null,
      reason: `The documents name different customers (${[...new Set(resolved.map((r) => r.customerName))].join(", ")}).`,
    };
  }
  return resolved[0] ?? results[0]!;
}
