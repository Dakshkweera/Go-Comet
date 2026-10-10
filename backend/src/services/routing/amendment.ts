import type { Discrepancy, ValidationResult } from "../../schemas/index.js";

const withUnit = (n: number, unit: string | null) => (unit ? `${n} ${unit}` : String(n));

function expectedLabel(v: ValidationResult): string {
  switch (v.ruleOperator) {
    case "MIN":
      return `>= ${withUnit(v.expectedMin!, v.unit)}`;
    case "MAX":
      return `<= ${withUnit(v.expectedMax!, v.unit)}`;
    case "RANGE":
      return `${v.expectedMin}–${withUnit(v.expectedMax!, v.unit)}`;
    default:
      return v.expectedText ?? String(v.expectedNumber);
  }
}

export function toDiscrepancy(v: ValidationResult): Discrepancy {
  const found = v.foundText ?? withUnit(v.foundNumber!, v.unit);
  return { field: v.field, found, expected: expectedLabel(v), reason: v.reason };
}

export function draftAmendment(invoiceNumber: string | null, discrepancies: Discrepancy[]): string {
  const lines = discrepancies.map(
    (d, i) =>
      `${i + 1}. ${d.field.replaceAll("_", " ")}\n   Found: ${d.found}\n   Expected: ${d.expected}`,
  );
  const subject = invoiceNumber ? `Invoice ${invoiceNumber}` : "This document";
  return `${subject} requires amendment. Please correct the following and resubmit:\n\n${lines.join("\n\n")}`;
}
