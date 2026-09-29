import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import {
  extractionResultSchema,
  type ExtractionInput,
  type ExtractionResult,
  type ExtractorAgent,
} from "@nova/contracts";
import { LlmError, type ContentPart, type LlmClient } from "@nova/llm";
import { EXTRACTION_PROMPT } from "./prompt.js";

async function documentPart({ filePath, mimeType }: ExtractionInput): Promise<ContentPart> {
  const dataUrl = `data:${mimeType};base64,${(await readFile(filePath)).toString("base64")}`;
  return mimeType === "application/pdf"
    ? { type: "file", file: { filename: basename(filePath), file_data: dataUrl } }
    : { type: "image_url", image_url: { url: dataUrl } };
}

export function createExtractor({ llm, model }: { llm: LlmClient; model: string }): ExtractorAgent {
  return {
    async extract(input) {
      const json = await llm.chatJson({
        model,
        messages: [
          { role: "system", content: EXTRACTION_PROMPT },
          {
            role: "user",
            content: [{ type: "text", text: "Extract the fields." }, await documentPart(input)],
          },
        ],
      });
      const parsed = extractionResultSchema.safeParse(json);
      if (!parsed.success) {
        throw new LlmError(
          "MODEL_OUTPUT_INVALID",
          "Model output did not match the extraction schema.",
          true,
        );
      }
      return parsed.data;
    },
  };
}

const field = (value: string) => ({ value, confidence: 0.97, evidence: value, candidates: null });

export const FAKE_EXTRACTION: ExtractionResult = {
  consignee_name: field("Bata India"),
  hs_code: field("640399"),
  port_of_loading: field("Shanghai"),
  port_of_discharge: field("Mumbai"),
  incoterms: field("FOB"),
  description_of_goods: field("Leather footwear"),
  gross_weight: { value: 900, unit: "kg", confidence: 0.96, evidence: "900 KG", candidates: null },
  invoice_number: field("INV-2026-1042"),
};

export const createFakeExtractor = (result = FAKE_EXTRACTION): ExtractorAgent => ({
  extract: async () => result,
});
