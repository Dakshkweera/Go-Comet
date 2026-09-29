import { z } from "zod";

export const queryTypeSchema = z.enum(["general_question", "database_query"]);
export type QueryType = z.infer<typeof queryTypeSchema>;

export const queryClassificationSchema = z.object({
  type: queryTypeSchema,
  reason: z.string().min(1),
});
export type QueryClassification = z.infer<typeof queryClassificationSchema>;

export const sqlGenerationResultSchema = z.object({ sql: z.string().trim().min(1) });
export type SqlGenerationResult = z.infer<typeof sqlGenerationResultSchema>;

export const sqlValidationResultSchema = z.object({
  valid: z.boolean(),
  reason: z.string().min(1),
});
export type SqlValidationResult = z.infer<typeof sqlValidationResultSchema>;

export const queryExecutionResultSchema = z.object({
  columns: z.array(z.string()),
  rows: z.array(z.record(z.unknown())),
});
export type QueryExecutionResult = z.infer<typeof queryExecutionResultSchema>;

export const queryRequestSchema = z.object({ question: z.string().trim().min(1).max(500) });
export type QueryRequest = z.infer<typeof queryRequestSchema>;

export const queryResponseSchema = z.object({
  type: queryTypeSchema,
  answer: z.string().min(1),
  data: queryExecutionResultSchema.nullable(),
  sql: z.string().nullable(),
});
export type QueryResponse = z.infer<typeof queryResponseSchema>;
