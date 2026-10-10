import { z } from "zod";
import { extractionFieldSchema, extractionResultSchema } from "./extraction.js";
import { customerResolutionSchema } from "./customer.js";
import { validationResultSchema } from "./validation.js";

export const pipelineStageSchema = z.enum([
  "RECEIVED",
  "EXTRACTING",
  "EXTRACTED",
  "CUSTOMER_RESOLVING",
  "CUSTOMER_RESOLVED",
  "VALIDATING",
  "VALIDATED",
  "ROUTING",
  "ROUTED",
  "COMPLETED",
]);
export type PipelineStage = z.infer<typeof pipelineStageSchema>;

export const pipelineStatusSchema = z.enum(["RECEIVED", "PROCESSING", "COMPLETED", "FAILED"]);
export type PipelineStatus = z.infer<typeof pipelineStatusSchema>;

export const pipelineErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  stage: pipelineStageSchema.optional(),
  retryable: z.boolean(),
  attempt: z.number().int().positive().optional(),
});
export type PipelineError = z.infer<typeof pipelineErrorSchema>;

export const decisionSchema = z.enum(["auto_approve", "human_review", "amendment_request"]);
export type Decision = z.infer<typeof decisionSchema>;

export const discrepancySchema = z.object({
  field: extractionFieldSchema,
  found: z.string().min(1),
  expected: z.string().min(1),
  reason: z.string().min(1),
});
export type Discrepancy = z.infer<typeof discrepancySchema>;

export const routerDecisionSchema = z.object({
  decision: decisionSchema,
  reasoning: z.string().min(1),
  discrepancies: z.array(discrepancySchema),
  amendmentDraft: z.string().min(1).nullable(),
});
export type RouterDecision = z.infer<typeof routerDecisionSchema>;

export const routerInputSchema = z.object({
  runId: z.string().min(1),
  customerResolution: customerResolutionSchema.nullable(),
  rulesAvailable: z.boolean(),
  extraction: extractionResultSchema.nullable(),
  validations: z.array(validationResultSchema),
  pipelineErrors: z.array(pipelineErrorSchema),
});
export type RouterInput = z.infer<typeof routerInputSchema>;

export interface Router {
  decide(input: RouterInput): RouterDecision;
}

export const pipelineResultSchema = z.object({
  runId: z.string().min(1),
  status: pipelineStatusSchema,
  currentStage: pipelineStageSchema,
  extraction: extractionResultSchema.nullable(),
  customerResolution: customerResolutionSchema.nullable(),
  validations: z.array(validationResultSchema),
  decision: routerDecisionSchema.nullable(),
  error: pipelineErrorSchema.nullable(),
});
export type PipelineResult = z.infer<typeof pipelineResultSchema>;
