import { DOC_TYPE_LABELS, type DocType, type ShipmentDocument } from "../../schemas/index.js";
import type { ResolvedIssue } from "./shipmentRouter.js";

export type DraftInput = {
  kind: "approval" | "amendment";
  stage: "intake" | "validation";
  reference: string;
  subject: string;
  supplierName: string | null;
  invoiceNumber: string | null;
  customerName: string | null;
  documents: ShipmentDocument[];
  items: ResolvedIssue[];
  signature: string;
};

const ORDER: DocType[] = [
  "COMMERCIAL_INVOICE",
  "BOL",
  "PACKING_LIST",
  "CERTIFICATE_OF_ORIGIN",
  "OTHER",
];

const label = (doc: ShipmentDocument) =>
  doc.docType && doc.docType !== "OTHER"
    ? `${DOC_TYPE_LABELS[doc.docType]} (${doc.filename})`
    : doc.filename;

export function replySubject(subject: string, reference: string) {
  const base = subject
    .replace(/\[SHP-\d+\]/g, "")
    .replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, "")
    .trim();
  return `Re: ${base || "Shipment documents"} [${reference}]`;
}

/** Grouped by document, because SU reissues documents rather than fields. */
function groups(input: DraftInput) {
  const byId = new Map(input.documents.map((d) => [d.id, d]));
  const rank = (docs: ShipmentDocument[]) =>
    docs.length === 1 ? ORDER.indexOf(docs[0]!.docType ?? "OTHER") : docs.length === 0 ? -1 : 99;
  const map = new Map<string, { docs: ShipmentDocument[]; items: ResolvedIssue[] }>();
  for (const item of input.items) {
    const docs = item.documentIds
      .map((id) => byId.get(id))
      .filter((d): d is ShipmentDocument => Boolean(d));
    const key = docs.map((d) => d.id).join("+");
    const group = map.get(key) ?? { docs, items: [] };
    group.items.push(item);
    map.set(key, group);
  }
  return [...map.values()].sort((a, b) => rank(a.docs) - rank(b.docs));
}

const LEGAL_SUFFIX =
  /(?:[,\s]+(?:co|company|corp|corporation|inc|llc|ltd|limited|pvt|private|gmbh)\.?)+$/i;

export function buildReplyDraft(input: DraftInput) {
  const name = input.supplierName?.replace(LEGAL_SUFFIX, "").trim();
  const greeting = `Hello ${name ? `${name} team` : "team"},`;
  const about =
    (input.invoiceNumber ? ` for invoice ${input.invoiceNumber}` : "") +
    (input.customerName ? ` (consignee: ${input.customerName})` : "");
  const against = input.customerName ? ` against ${input.customerName}'s requirements` : "";
  const subject = replySubject(input.subject, input.reference);

  if (input.kind === "approval") {
    const checked = input.documents.filter((d) => d.docType && d.docType !== "OTHER");
    const extra = input.documents.filter((d) => d.docType === "OTHER");
    const body = [
      greeting,
      "",
      `Thank you for the documents${about}. We checked them${against}:`,
      "",
      ...checked.map((d) => `- ${label(d)}`),
      ...(extra.length
        ? [
            "",
            `Also received (not part of the checks): ${extra.map((d) => d.filename).join(", ")}.`,
          ]
        : []),
      "",
      "All customer rules and cross-document checks passed. No changes are needed.",
      "",
      "Regards,",
      input.signature,
    ];
    return { subject, body: body.join("\n") };
  }

  const intro =
    input.stage === "intake"
      ? `Thank you for the documents${about}. Before we can check them, we need the following:`
      : `Thank you for the documents${about}. We checked them${against} and need the corrections below before we can release them.`;
  const lines: string[] = [];
  let n = 0;
  for (const { docs, items } of groups(input)) {
    lines.push(
      "",
      docs.length === 0
        ? "General"
        : docs.length === 1
          ? label(docs[0]!)
          : `Several documents (${docs.map((d) => d.filename).join(", ")})`,
    );
    for (const item of items) {
      n++;
      lines.push(`  ${n}. ${item.request}`);
      if (docs.some((d) => d.unchanged)) {
        lines.push(
          "     This file is the same as the version you sent before; the correction is still needed.",
        );
      }
    }
  }
  const body = [
    greeting,
    "",
    intro,
    ...lines,
    "",
    input.stage === "intake"
      ? "Please reply to this email with the documents."
      : "Please reply to this email with the corrected documents.",
    "",
    "Regards,",
    input.signature,
  ];
  return { subject, body: body.join("\n") };
}
