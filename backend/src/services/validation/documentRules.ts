import type { DocType, ExtractionField, TypedDocType } from "../../schemas/index.js";

/** Which document type is the reference for a field; unlisted fields have no owner. */
export const FIELD_OWNERS: Partial<Record<ExtractionField, TypedDocType>> = {
  invoice_number: "COMMERCIAL_INVOICE",
  incoterms: "COMMERCIAL_INVOICE",
  description_of_goods: "COMMERCIAL_INVOICE",
  port_of_loading: "BOL",
  port_of_discharge: "BOL",
  gross_weight: "PACKING_LIST",
};

/** Fields that must be printed on each document type; others are checked only if present. */
export const REQUIRED_FIELDS_BY_TYPE: Record<TypedDocType, ExtractionField[]> = {
  COMMERCIAL_INVOICE: [
    "invoice_number",
    "consignee_name",
    "hs_code",
    "incoterms",
    "description_of_goods",
  ],
  BOL: ["consignee_name", "port_of_loading", "port_of_discharge", "gross_weight"],
  PACKING_LIST: ["gross_weight"],
  CERTIFICATE_OF_ORIGIN: [],
};

export const REQUIRED_DOCUMENTS: TypedDocType[] = ["COMMERCIAL_INVOICE", "BOL", "PACKING_LIST"];

export const TYPED_DOCUMENTS: TypedDocType[] = [
  "COMMERCIAL_INVOICE",
  "BOL",
  "PACKING_LIST",
  "CERTIFICATE_OF_ORIGIN",
];

/** Other documents may describe goods in general terms (UCP 600 art. 14(e)). */
export const NOT_CROSS_CHECKED = new Set<ExtractionField>(["description_of_goods"]);

export const isTyped = (docType: DocType | null): docType is TypedDocType =>
  docType !== null && docType !== "OTHER";
