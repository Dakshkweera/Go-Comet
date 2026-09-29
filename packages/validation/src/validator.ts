import {
  customerRuleSchema,
  type CustomerRule,
  type ExtractionField,
  type ValidationInput,
  type ValidationResult,
  type Validator,
} from "@nova/contracts";
import { assessField, normalizeHsCode } from "./reliability.js";

const KG_PER_UNIT: Record<string, number> = {
  kg: 1,
  kgs: 1,
  kilogram: 1,
  kilograms: 1,
  g: 0.001,
  t: 1000,
  mt: 1000,
  tonne: 1000,
  tonnes: 1000,
  lb: 0.45359237,
  lbs: 0.45359237,
};

export function toKg(value: number, unit: string | null | undefined): number | null {
  const factor = unit ? KG_PER_UNIT[unit.trim().toLowerCase()] : undefined;
  return factor === undefined ? null : value * factor;
}

function normalizeText(field: ExtractionField, value: string): string {
  if (field === "hs_code") return normalizeHsCode(value);
  if (field === "invoice_number") return value.trim();
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function createValidator({ minConfidence }: { minConfidence: number }): Validator {
  return {
    validate({ extraction, rules }: ValidationInput): ValidationResult[] {
      return rules.filter((r) => r.isActive).map((rule) => evaluate(rule));

      function evaluate(rule: CustomerRule): ValidationResult {
        const extracted = extraction[rule.field];
        const isNumber = typeof extracted.value === "number";
        const base: ValidationResult = {
          field: rule.field,
          status: "uncertain",
          foundText: isNumber ? null : (extracted.value as string | null),
          foundNumber: isNumber ? (extracted.value as number) : null,
          expectedText: typeof rule.expectedValue === "string" ? rule.expectedValue : null,
          expectedNumber: typeof rule.expectedValue === "number" ? rule.expectedValue : null,
          expectedMin: rule.minValue,
          expectedMax: rule.maxValue,
          unit: rule.unit ?? ("unit" in extracted ? (extracted.unit ?? null) : null),
          confidence: extracted.confidence,
          ruleId: rule.id,
          ruleOperator: rule.operator,
          reason: "",
        };
        const result = (status: ValidationResult["status"], reason: string) => ({
          ...base,
          status,
          reason,
        });

        if (!customerRuleSchema.safeParse(rule).success) {
          return result("uncertain", "The customer rule is misconfigured and cannot be evaluated.");
        }
        const reliability = assessField(rule.field, extracted, minConfidence);
        if (!reliability.reliable) {
          return result("uncertain", `Cannot validate: ${reliability.reasons.join("; ")}.`);
        }

        if (rule.operator === "EXACT") {
          const found = normalizeText(rule.field, String(extracted.value));
          const expected = normalizeText(rule.field, String(rule.expectedValue));
          return found === expected
            ? result("match", "Extracted value matches the customer rule.")
            : result("mismatch", `Found "${extracted.value}", expected "${rule.expectedValue}".`);
        }

        if (!isNumber) {
          return result("uncertain", `${rule.operator} rules need a numeric value.`);
        }
        const unit = "unit" in extracted ? extracted.unit : null;
        const found = rule.unit
          ? toKgIn(extracted.value as number, unit, rule.unit)
          : (extracted.value as number);
        if (found === null) {
          return result(
            "uncertain",
            `Cannot compare unit "${unit ?? "none"}" with "${rule.unit}".`,
          );
        }
        const min = rule.minValue ?? -Infinity;
        const max = rule.maxValue ?? Infinity;
        if (found < min)
          return result("mismatch", `Value is below the customer's minimum of ${min}.`);
        if (found > max)
          return result("mismatch", `Value exceeds the customer's maximum of ${max}.`);
        return result("match", "Value is within the customer's limits.");
      }
    },
  };
}

function toKgIn(value: number, fromUnit: string | null | undefined, toUnit: string): number | null {
  const kg = toKg(value, fromUnit);
  const perTarget = toKg(1, toUnit);
  return kg === null || perTarget === null ? null : kg / perTarget;
}
