import {
  REQUIRED_FIELDS,
  type CustomerRule,
  type ExtractionField,
  type FieldObservation,
  type FieldResult,
  type IssueReference,
  type ShipmentDocument,
  type ShipmentIssue,
  type ValidationResult,
  type Validator,
} from "../../schemas/index.js";
import { FIELD_OWNERS, isTyped, NOT_CROSS_CHECKED } from "./documentRules.js";
import { describeDoc, fieldLabel, lower, makeIssue, typeLabel } from "./issues.js";
import { formatValue, sameValue, type Reading } from "./keys.js";
import { assessField } from "./reliability.js";

export type ConsistencyInput = {
  documents: ShipmentDocument[];
  rules: CustomerRule[];
  customer: { id: string; name: string };
  validator: Validator;
  minConfidence: number;
};

type Reference = Reading & {
  label: string;
  short: string;
  reference: IssueReference;
  documentId: string | null;
};

export type FieldCheck = {
  ruleStatus: FieldResult["ruleStatus"];
  consistency: FieldResult["consistency"];
  reference: Reference | null;
  rule: ValidationResult | null;
};

const reading = (doc: ShipmentDocument, field: ExtractionField): Reading | null => {
  const f = doc.extraction?.[field];
  if (!f || f.value === null || f.value === "") return null;
  return { value: f.value, unit: "unit" in f ? f.unit : null };
};

function expectedLabel(v: ValidationResult): string {
  const unit = v.unit ? ` ${v.unit}` : "";
  switch (v.ruleOperator) {
    case "MIN":
      return `at least ${v.expectedMin}${unit}`;
    case "MAX":
      return `at most ${v.expectedMax}${unit}`;
    case "RANGE":
      return `${v.expectedMin}–${v.expectedMax}${unit}`;
    default: {
      const expected = v.expectedText ?? String(v.expectedNumber);
      // Rules store HS codes as bare digits; documents print them as 6403.99.
      return v.field === "hs_code" && /^\d{6,10}$/.test(expected)
        ? `${expected.slice(0, 4)}.${expected.slice(4)}`
        : expected;
    }
  }
}

/** Stage 2: each document against the customer rules, then the documents against each other. */
export function checkConsistency(input: ConsistencyInput) {
  const { documents, rules, customer, validator } = input;
  const typed = documents.filter((d) => d.status === "extracted" && isTyped(d.docType));
  const others = documents.filter((d) => d.status === "extracted" && d.docType === "OTHER");
  const results = new Map(
    typed.map((d) => [
      d.id,
      new Map(
        validator
          .validate({ runId: d.id, extraction: d.extraction!, customer, rules })
          .map((v) => [v.field, v]),
      ),
    ]),
  );

  const issues: ShipmentIssue[] = [];
  const checks = new Map<ExtractionField, FieldCheck>();
  const issue = (i: Parameters<typeof makeIssue>[0]) => issues.push(makeIssue(i));

  for (const field of REQUIRED_FIELDS) {
    const label = fieldLabel(field);
    const carrying = typed.filter((d) => reading(d, field));
    const rule = rules.find((r) => r.field === field && r.isActive) ?? null;
    const ruleResults = carrying.map((d) => [d, results.get(d.id)!.get(field)] as const);
    const excluded = new Set<string>();
    let ruleStatus: FieldCheck["ruleStatus"] = rule ? "match" : "no_rule";
    if (rule && carrying.length === 0) {
      ruleStatus = "uncertain";
      issue({
        stage: "validation",
        severity: "review",
        kind: "cannot_verify",
        field,
        documentIds: [],
        message: `No document shows the ${lower(label)}, so ${customer.name}'s rule for it could not be checked.`,
        request: `None of the documents shows the ${lower(label)}. Please add it.`,
        allowedActions: ["clarify", "amend"],
      });
    }

    const mismatches = new Map<string, { docs: ShipmentDocument[]; result: ValidationResult }>();
    for (const [doc, result] of ruleResults) {
      if (!result || result.status === "match") continue;
      excluded.add(doc.id);
      if (result.status === "uncertain") {
        ruleStatus = ruleStatus === "mismatch" ? ruleStatus : "uncertain";
        issue({
          stage: "validation",
          severity: "review",
          kind: "cannot_verify",
          field,
          documentIds: [doc.id],
          message: `${label} on the ${lower(describeDoc(doc))} could not be checked: ${result.reason}`,
          request: `We could not check the ${lower(label)} on ${doc.filename} against ${customer.name}'s requirements. Please confirm it.`,
          allowedActions: ["clarify", "amend"],
        });
        continue;
      }
      ruleStatus = "mismatch";
      const r = reading(doc, field)!;
      const found = formatValue(r.value, r.unit);
      const group = mismatches.get(found) ?? { docs: [], result };
      group.docs.push(doc);
      mismatches.set(found, group);
    }
    for (const [found, { docs, result }] of mismatches) {
      const expected = expectedLabel(result);
      const where = docs.map((d) => lower(describeDoc(d))).join(", ");
      const agreeing = carrying.filter((d) => !excluded.has(d.id));
      issue({
        stage: "validation",
        severity: "amendment",
        kind: "rule_mismatch",
        field,
        documentIds: docs.map((d) => d.id),
        found,
        expected,
        reference: { source: "rule", ruleId: result.ruleId! },
        message: `${label} on the ${where} shows ${found}; ${customer.name} requires ${expected}.`,
        request:
          `${label}: shows ${found}; ${customer.name} requires ${expected}. Please correct it.` +
          (agreeing.length > 0
            ? ` The ${agreeing.map((d) => lower(describeDoc(d))).join(" and ")} already show the required value.`
            : ""),
        allowedActions: ["clarify"],
      });
    }

    const owner = FIELD_OWNERS[field];
    const ownerDoc = owner
      ? carrying.find((d) => d.docType === owner && !excluded.has(d.id))
      : undefined;
    const expectedRule = ruleResults.find(([, r]) => r)?.[1] ?? null;
    let reference: Reference | null = null;
    if (ownerDoc) {
      reference = {
        ...reading(ownerDoc, field)!,
        label: `the ${lower(describeDoc(ownerDoc))}`,
        short: `the ${lower(typeLabel(ownerDoc))}`,
        reference: { source: "document", documentId: ownerDoc.id },
        documentId: ownerDoc.id,
      };
    } else if (rule?.operator === "EXACT" && rule.expectedValue !== null) {
      reference = {
        value: rule.expectedValue,
        unit: rule.unit,
        label: `${customer.name}'s requirement`,
        short: `${customer.name}'s requirement`,
        reference: { source: "rule", ruleId: rule.id },
        documentId: null,
      };
    }

    let consistency: FieldCheck["consistency"] = NOT_CROSS_CHECKED.has(field)
      ? "not_checked"
      : carrying.length === 0
        ? "no_values"
        : carrying.length === 1
          ? "single_source"
          : "consistent";

    if (!NOT_CROSS_CHECKED.has(field)) {
      const candidates = carrying.filter(
        (d) => !excluded.has(d.id) && d.id !== reference?.documentId,
      );
      const unverifiable = (doc: ShipmentDocument) =>
        issue({
          stage: "validation",
          severity: "review",
          kind: "cannot_verify",
          field,
          documentIds: [doc.id],
          message: `${label} on the ${lower(describeDoc(doc))} cannot be compared with the other documents (unknown unit).`,
          request: `Please confirm the ${lower(label)} and its unit on ${doc.filename}.`,
          allowedActions: ["clarify", "amend"],
        });

      if (reference) {
        for (const doc of candidates) {
          const r = reading(doc, field)!;
          const same = sameValue(field, reference, r);
          if (same === null) unverifiable(doc);
          if (same !== false) continue;
          consistency = "inconsistent";
          const found = formatValue(r.value, r.unit);
          const expected = formatValue(reference.value, reference.unit);
          const target = reference.documentId
            ? ` Please make the ${lower(typeLabel(doc))} match ${reference.short}.`
            : " Please correct it.";
          issue({
            stage: "validation",
            severity: "amendment",
            kind: "document_mismatch",
            field,
            documentIds: [doc.id],
            found,
            expected,
            reference: reference.reference,
            message: `${label} on the ${lower(describeDoc(doc))} shows ${found}; ${reference.label} shows ${expected}.`,
            request: `${label}: shows ${found}; ${reference.label} shows ${expected}.${target}`,
            allowedActions: ["clarify"],
          });
        }
      } else if (candidates.length > 1) {
        const first = reading(candidates[0]!, field)!;
        const comparisons = candidates.map((d) => sameValue(field, first, reading(d, field)!));
        if (comparisons.includes(null))
          candidates.filter((_, i) => comparisons[i] === null).forEach(unverifiable);
        else if (comparisons.includes(false)) {
          consistency = "inconsistent";
          const list = candidates
            .map((d) => {
              const r = reading(d, field)!;
              return `${lower(describeDoc(d))}: ${formatValue(r.value, r.unit)}`;
            })
            .join("; ");
          issue({
            stage: "validation",
            severity: "amendment",
            kind: "inconsistent",
            field,
            documentIds: candidates.map((d) => d.id),
            found: list,
            message: `${label} differs between documents (${list}) and no document or rule decides which is right.`,
            request: `${label} differs between the documents (${list}). Please confirm the correct value and correct the documents.`,
            allowedActions: ["clarify"],
          });
        }
      }

      const baseline: Reading | null =
        reference ?? (candidates[0] ? reading(candidates[0], field) : null);
      for (const doc of others) {
        const r = reading(doc, field);
        if (
          !r ||
          !baseline ||
          !assessField(field, doc.extraction![field], input.minConfidence).reliable
        )
          continue;
        if (sameValue(field, baseline, r) !== false) continue;
        const found = formatValue(r.value, r.unit);
        const expected = formatValue(baseline.value, baseline.unit);
        issue({
          stage: "validation",
          severity: "review",
          kind: "other_document_mismatch",
          field,
          documentIds: [doc.id],
          found,
          expected,
          message: `${doc.filename} (unclassified) shows ${lower(label)} ${found}; the other documents show ${expected}.`,
          request: `${doc.filename} shows ${lower(label)} ${found}, which differs from the other documents (${expected}). Please confirm or correct it.`,
          allowedActions: ["clarify", "amend"],
        });
      }
    }

    checks.set(field, { ruleStatus, consistency, reference, rule: expectedRule ?? null });
  }
  return { issues, checks };
}

export type FieldDescriptionInput = {
  documents: ShipmentDocument[];
  verified: Set<string>;
  checks: Map<ExtractionField, FieldCheck> | null;
  states: Map<ExtractionField, FieldResult["state"]>;
  minConfidence: number;
};

/** The verification grid: every document's reading per field, with the field's outcome. */
export function describeFields(input: FieldDescriptionInput): FieldResult[] {
  const readable = input.documents.filter((d) => d.status === "extracted" && d.extraction);
  return REQUIRED_FIELDS.map((field): FieldResult => {
    const check = input.checks?.get(field) ?? null;
    const owner = FIELD_OWNERS[field] ?? null;
    const observations = readable.flatMap((doc): FieldObservation[] => {
      const f = doc.extraction![field];
      if (f.value === null || f.value === "") return [];
      const { reliable, reasons } = assessField(field, f, input.minConfidence);
      const r = reading(doc, field)!;
      return [
        {
          documentId: doc.id,
          filename: doc.filename,
          docType: doc.docType ?? "OTHER",
          value: f.value,
          unit: r.unit ?? null,
          confidence: f.confidence,
          reliable,
          reasons,
          evidence: f.evidence ?? null,
          evidenceStatus: f.evidenceStatus ?? null,
          isOwner: owner !== null && doc.docType === owner,
          agrees: check?.reference ? sameValue(field, check.reference, r) : null,
          verifiedByCg: input.verified.has(`${doc.id}:${field}`),
        },
      ];
    });
    const main =
      observations.find((o) => o.documentId === check?.reference?.documentId) ??
      observations.find((o) => o.isOwner) ??
      observations.find((o) => o.docType !== "OTHER") ??
      null;
    const state = input.states.get(field) ?? "ok";
    return {
      field,
      state,
      ruleStatus: check?.ruleStatus ?? "not_checked",
      consistency: check?.consistency ?? "not_checked",
      ownerDocType: owner,
      value: main?.value ?? null,
      unit: main?.unit ?? null,
      valueSource: main ? (main.verifiedByCg ? "cg" : "document") : null,
      sourceDocumentId: main?.documentId ?? null,
      ruleId: check?.rule?.ruleId ?? null,
      expected: check?.rule ? expectedLabel(check.rule) : null,
      confidence: main?.confidence ?? null,
      reason: !check
        ? "Checked after intake is complete."
        : state === "ok"
          ? check.ruleStatus === "match"
            ? "Matches the customer rule and agrees across documents."
            : check.consistency === "not_checked"
              ? "Read from the commercial invoice; not compared across documents."
              : "Agrees across documents; no customer rule for this field."
          : state === "review"
            ? "Needs your decision."
            : "Needs correction by the supplier.",
      observations,
    };
  });
}
