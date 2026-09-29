import { z } from "zod";
import { extractionFieldSchema } from "./extraction.js";

export const customerResolutionStatusSchema = z.enum(["resolved", "not_found", "ambiguous"]);
export type CustomerResolutionStatus = z.infer<typeof customerResolutionStatusSchema>;

export const customerResolutionSchema = z.object({
  status: customerResolutionStatusSchema,
  customerId: z.string().nullable(),
  customerName: z.string().nullable(),
  reason: z.string().min(1),
});
export type CustomerResolution = z.infer<typeof customerResolutionSchema>;

export const customerResolutionInputSchema = z.object({
  runId: z.string().min(1),
  consigneeName: z.string().nullable(),
});
export type CustomerResolutionInput = z.infer<typeof customerResolutionInputSchema>;

export interface CustomerResolver {
  resolve(input: CustomerResolutionInput): Promise<CustomerResolution>;
}

export const ruleOperatorSchema = z.enum(["EXACT", "MIN", "MAX", "RANGE"]);
export type RuleOperator = z.infer<typeof ruleOperatorSchema>;

export const customerRuleSchema = z
  .object({
    id: z.string().min(1),
    customerId: z.string().min(1),
    field: extractionFieldSchema,
    operator: ruleOperatorSchema,
    expectedValue: z.union([z.string(), z.number()]).nullable(),
    minValue: z.number().nullable(),
    maxValue: z.number().nullable(),
    unit: z.string().nullable(),
    isActive: z.boolean(),
  })
  .superRefine((rule, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    switch (rule.operator) {
      case "EXACT":
        if (rule.expectedValue === null || rule.expectedValue === "")
          fail("EXACT requires expectedValue");
        break;
      case "MIN":
        if (rule.minValue === null) fail("MIN requires minValue");
        break;
      case "MAX":
        if (rule.maxValue === null) fail("MAX requires maxValue");
        break;
      case "RANGE":
        if (rule.minValue === null || rule.maxValue === null)
          fail("RANGE requires minValue and maxValue");
        else if (rule.minValue > rule.maxValue) fail("RANGE requires minValue <= maxValue");
        break;
    }
  });
export type CustomerRule = z.infer<typeof customerRuleSchema>;

export const customerRuleSetSchema = z.object({
  customerId: z.string().min(1),
  customerName: z.string().min(1),
  rules: z.array(customerRuleSchema),
});
export type CustomerRuleSet = z.infer<typeof customerRuleSetSchema>;

export interface RuleService {
  getRules(input: { customerId: string }): Promise<CustomerRuleSet>;
}
