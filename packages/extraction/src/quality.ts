import { readFile } from "node:fs/promises";
import { REQUIRED_FIELDS, type ExtractionResult } from "@nova/contracts";
import { extractText, getDocumentProxy } from "unpdf";

export const AMBIGUOUS_CONFIDENCE_CAP = 0.3;
export const UNSUPPORTED_CONFIDENCE_CAP = 0.5;

const AMBIGUOUS = /[?�□]|illegible|unreadable/i;
const squash = (s: string) => s.toLowerCase().replace(/[\s,.\-'"]/g, "");

export async function readPdfText(filePath: string): Promise<string | null> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(await readFile(filePath)));
    const { text } = await extractText(pdf, { mergePages: true });
    return text.replace(/\s/g, "").length >= 20 ? text : null;
  } catch {
    return null;
  }
}

/**
 * Model confidence is only a signal: caps it when the value looks ambiguous, is not
 * supported by the quoted evidence, or does not appear in the document's text layer.
 */
export function applyQualityGate(
  extraction: ExtractionResult,
  documentText: string | null,
): ExtractionResult {
  const text = documentText ? squash(documentText) : null;
  return Object.fromEntries(
    REQUIRED_FIELDS.map((field) => {
      const f = extraction[field];
      if (f.value === null) return [field, f];
      const value = String(f.value);
      let cap = 1;
      if (AMBIGUOUS.test(value) || (f.evidence && AMBIGUOUS.test(f.evidence))) {
        cap = AMBIGUOUS_CONFIDENCE_CAP;
      } else if (
        (f.evidence && !squash(f.evidence).includes(squash(value))) ||
        (text && !text.includes(squash(value)))
      ) {
        cap = UNSUPPORTED_CONFIDENCE_CAP;
      }
      return [field, { ...f, confidence: Math.min(f.confidence, cap) }];
    }),
  ) as ExtractionResult;
}
