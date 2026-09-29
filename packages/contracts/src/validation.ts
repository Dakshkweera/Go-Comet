import { z } from "zod";
import { confidenceSchema, extractionFieldSchema, extractionResultSchema } from "./extraction.js";
import { customerRuleSchema, ruleOperatorSchema } from "./customer.js";

export const validationStatusSchema = z.enum(["match", "mismatch", "uncertain"]);
export type ValidationStatus = z.infer<typeof validationStatusSchema>;

export const validationResultSchema = z.object({
  field: extractionFieldSchema,
  status: validationStatusSchema,
  foundText: z.string().nullable(),
  foundNumber: z.number().nullable(),
  expectedText: z.string().nullable(),
  expectedNumber: z.number().nullable(),
  expectedMin: z.number().nullable(),
  expectedMax: z.number().nullable(),
  unit: z.string().nullable(),
  confidence: confidenceSchema.nullable(),
  ruleId: z.string().nullable(),
  ruleOperator: ruleOperatorSchema.nullable(),
  reason: z.string().min(1),
});
export type ValidationResult = z.infer<typeof validationResultSchema>;

export const validationInputSchema = z.object({
  runId: z.string().min(1),
  extraction: extractionResultSchema,
  customer: z.object({ id: z.string().min(1), name: z.string().min(1) }),
  rules: z.array(customerRuleSchema),
});
export type ValidationInput = z.infer<typeof validationInputSchema>;

export interface Validator {
  validate(input: ValidationInput): ValidationResult[];
}
