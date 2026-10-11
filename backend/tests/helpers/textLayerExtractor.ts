import type { ExtractionField, ExtractionResult, ExtractorAgent } from "../../src/schemas/index.js";
import { applyQualityGate, readPdfText } from "../../src/services/extraction/index.js";

const LABELS: Record<string, ExtractionField> = {
  CONSIGNEE: "consignee_name",
  "HS CODE": "hs_code",
  "PORT OF LOADING": "port_of_loading",
  "PORT OF DISCHARGE": "port_of_discharge",
  INCOTERMS: "incoterms",
  "DESCRIPTION OF GOODS": "description_of_goods",
  "GROSS WEIGHT": "gross_weight",
  "INVOICE NO": "invoice_number",
};

const empty = { value: null, confidence: 0, evidence: null, candidates: null };

/**
 * Test stand-in for the vision model: reads the "LABEL: value" lines our sample PDFs print,
 * then runs the real quality gate. It never answers the document type, so only titles classify.
 */
export const textLayerExtractor: ExtractorAgent = {
  async extract({ filePath }) {
    const text = await readPdfText(filePath);
    const fields = Object.fromEntries(Object.values(LABELS).map((f) => [f, empty])) as Record<
      ExtractionField,
      unknown
    >;
    for (const line of (text ?? "").split(/\r?\n/)) {
      const [label, ...rest] = line.split(":");
      const field = LABELS[label!.trim()];
      const value = rest.join(":").trim();
      if (!field || !value) continue;
      const base = { confidence: 0.97, evidence: line.trim(), candidates: null };
      if (field === "gross_weight") {
        const [amount, unit] = value.replace(/,/g, "").split(/\s+/);
        fields[field] = { ...base, value: Number(amount), unit: unit ?? null };
      } else {
        fields[field] = {
          ...base,
          value: field === "consignee_name" ? value.split(",")[0]!.trim() : value,
        };
      }
    }
    return applyQualityGate(fields as ExtractionResult, text);
  },
};
