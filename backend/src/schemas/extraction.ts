import { z } from "zod";

export const confidenceSchema = z.number().min(0).max(1);

export const extractionFieldSchema = z.enum([
  "consignee_name",
  "hs_code",
  "port_of_loading",
  "port_of_discharge",
  "incoterms",
  "description_of_goods",
  "gross_weight",
  "invoice_number",
]);
export type ExtractionField = z.infer<typeof extractionFieldSchema>;
export const REQUIRED_FIELDS = extractionFieldSchema.options;

export const evidenceStatusSchema = z.enum([
  "supported",
  "unverified",
  "ambiguous",
  "contradicted",
]);
export type EvidenceStatus = z.infer<typeof evidenceStatusSchema>;

export const extractedTextFieldSchema = z.object({
  value: z.string().nullable(),
  confidence: confidenceSchema,
  evidence: z.string().nullable().optional(),
  candidates: z.array(z.string()).nullable().optional(),
  evidenceStatus: evidenceStatusSchema.optional(),
});
export type ExtractedTextField = z.infer<typeof extractedTextFieldSchema>;

export const extractedNumberFieldSchema = z.object({
  value: z.number().nullable(),
  confidence: confidenceSchema,
  unit: z.string().nullable().optional(),
  evidence: z.string().nullable().optional(),
  candidates: z.array(z.number()).nullable().optional(),
  evidenceStatus: evidenceStatusSchema.optional(),
});
export type ExtractedNumberField = z.infer<typeof extractedNumberFieldSchema>;

export const extractionResultSchema = z.object({
  consignee_name: extractedTextFieldSchema,
  hs_code: extractedTextFieldSchema,
  port_of_loading: extractedTextFieldSchema,
  port_of_discharge: extractedTextFieldSchema,
  incoterms: extractedTextFieldSchema,
  description_of_goods: extractedTextFieldSchema,
  gross_weight: extractedNumberFieldSchema,
  invoice_number: extractedTextFieldSchema,
});
export type ExtractionResult = z.infer<typeof extractionResultSchema>;

export const extractionInputSchema = z.object({
  runId: z.string().min(1),
  documentId: z.string().min(1),
  filePath: z.string().min(1),
  mimeType: z.string().min(1),
});
export type ExtractionInput = z.infer<typeof extractionInputSchema>;

export type DocumentTypeHint = { value: string; confidence: number };

/** The model's answer to "what document is this?" rides along; deterministic code decides. */
export type ExtractorOutput = ExtractionResult & { documentType?: DocumentTypeHint };

export interface ExtractorAgent {
  extract(input: ExtractionInput): Promise<ExtractorOutput>;
}
