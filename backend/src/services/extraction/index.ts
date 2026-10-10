export { createExtractor, createFakeExtractor, FAKE_EXTRACTION } from "./extractor.js";
export { normalizeExtraction } from "./normalize.js";
export {
  AMBIGUOUS_CONFIDENCE_CAP,
  applyQualityGate,
  CONTRADICTED_CONFIDENCE_CAP,
  DocumentReadError,
  evidenceStatus,
  readPdfText,
  UNVERIFIED_CONFIDENCE_FACTOR,
} from "./quality.js";
