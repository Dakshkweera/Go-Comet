import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { renderDocument, toLines } from "./pdf.js";

const SUPPLIER = '"Guangzhou Leatherworks Co., Ltd." <docs@gzleather.example>';
const CG = '"CG Team" <cg@nova.local>';
const outDir = fileURLToPath(new URL("../../samples/emails/", import.meta.url));

type Attachment = { file: string; title: string; fields: Record<string, string>; messy?: boolean };
type Sample = {
  name: string;
  subject: string;
  date: string;
  inReplyTo?: string;
  text: string;
  attachments: (Attachment | { file: string; raw: Buffer })[];
};

const consignee = "Bata India Limited, Kolkata, India";

const invoice = (no: string, fields: Record<string, string> = {}): Attachment => ({
  file: `CI-${no}.pdf`,
  title: "COMMERCIAL INVOICE",
  fields: {
    "INVOICE NO": `INV-2026-${no}`,
    DATE: "2026-10-06",
    SHIPPER: "Guangzhou Leatherworks Co., Ltd., Guangzhou, China",
    CONSIGNEE: consignee,
    "PORT OF LOADING": "Shanghai",
    "PORT OF DISCHARGE": "Mumbai",
    INCOTERMS: "FOB Shanghai",
    "HS CODE": "6403.99",
    "DESCRIPTION OF GOODS": "Leather footwear, men's formal shoes, 1,200 pairs",
    "GROSS WEIGHT": "900 KG",
    "UNIT PRICE": "USD 32.00 per pair",
    "TOTAL VALUE": "USD 38,400.00",
    "PAYMENT TERMS": "30 days from B/L date",
    ...fields,
  },
});

const billOfLading = (no: string, fields: Record<string, string> = {}): Attachment => ({
  file: `BL-${no}.pdf`,
  title: "BILL OF LADING",
  fields: {
    "B/L NO": `COSU62345${no}`,
    SHIPPER: "Guangzhou Leatherworks Co., Ltd., Guangzhou, China",
    CONSIGNEE: consignee,
    "NOTIFY PARTY": "Bata India Limited, Kolkata",
    "VESSEL / VOYAGE": "COSCO HARMONY / 041W",
    "PORT OF LOADING": "Shanghai",
    "PORT OF DISCHARGE": "Mumbai",
    "CONTAINER NO": `CSNU62${no}7 (40' HC)`,
    "DESCRIPTION OF GOODS": "48 cartons leather footwear",
    "HS CODE": "6403.99",
    "GROSS WEIGHT": "900 KG",
    FREIGHT: "Collect",
    ...fields,
  },
});

const packingList = (
  no: string,
  fields: Record<string, string> = {},
  messy = false,
): Attachment => ({
  file: `PL-${no}.pdf`,
  title: "PACKING LIST",
  messy,
  fields: {
    "INVOICE NO": `INV-2026-${no}`,
    CONSIGNEE: consignee,
    "DESCRIPTION OF GOODS": "Leather footwear, men's formal shoes",
    PACKAGES: "48 cartons, 25 pairs per carton",
    "HS CODE": "6403.99",
    "NET WEIGHT": "840 KG",
    "GROSS WEIGHT": "900 KG",
    MEASUREMENT: "28.4 CBM",
    ...fields,
  },
});

const fumigation = (no: string): Attachment => ({
  file: `FUM-${no}.pdf`,
  title: "FUMIGATION CERTIFICATE",
  fields: {
    "CERTIFICATE NO": `FUM-2026-0${no}`,
    CONSIGNEE: consignee,
    TREATMENT: "Methyl bromide, 48 g/m3, 24 hours",
    "DATE OF TREATMENT": "2026-10-04",
    "TREATED ITEMS": "Wooden pallets under the footwear cartons",
  },
});

const body = (no: string, extra = "") =>
  `Dear CG team,\n\nPlease find attached the shipping documents for invoice INV-2026-${no} (consignee: Bata India).${extra}\n\nBest regards,\nLi Wei\nExport Documentation, Guangzhou Leatherworks`;

const messageId = (name: string) => `<${name}@gzleather.example>`;

const samples: Sample[] = [
  {
    name: "01-clean",
    subject: "Shipment documents INV-2026-2041",
    date: "2026-10-08T09:15:00Z",
    text: body("2041", " The fumigation certificate for the pallets is attached as well."),
    attachments: [invoice("2041"), billOfLading("2041"), packingList("2041"), fumigation("2041")],
  },
  {
    name: "02-intake",
    subject: "Shipment documents INV-2026-2042",
    date: "2026-10-08T10:02:00Z",
    text: body("2042"),
    attachments: [
      invoice("2042"),
      billOfLading("2042"),
      { file: "scan_01.pdf", raw: Buffer.from("%PDF-1.4\n%damaged during scanning\n") },
    ],
  },
  {
    name: "02-intake-reply",
    subject: "Re: Shipment documents INV-2026-2042",
    date: "2026-10-08T14:40:00Z",
    inReplyTo: messageId("02-intake"),
    text: "Dear CG team,\n\nSorry, the scan was damaged. Attached is the packing list again.\n\nBest regards,\nLi Wei",
    attachments: [packingList("2042")],
  },
  {
    name: "03-validation",
    subject: "Shipment documents INV-2026-2043",
    date: "2026-10-08T11:30:00Z",
    text: body("2043"),
    attachments: [
      invoice("2043"),
      billOfLading("2043", { "GROSS WEIGHT": "950 KG" }),
      packingList("2043", { "HS CODE": "6403.22" }),
    ],
  },
  {
    name: "03-validation-reply",
    subject: "Re: Shipment documents INV-2026-2043",
    date: "2026-10-09T08:05:00Z",
    inReplyTo: messageId("03-validation"),
    text: "Dear CG team,\n\nThank you. Corrected bill of lading and packing list attached, with the invoice again for completeness.\n\nBest regards,\nLi Wei",
    attachments: [invoice("2043"), billOfLading("2043"), packingList("2043")],
  },
  {
    name: "04-review",
    subject: "Shipment documents INV-2026-2044",
    date: "2026-10-08T12:45:00Z",
    text: body("2044", " The packing list is a scan from the warehouse."),
    attachments: [
      invoice("2044"),
      billOfLading("2044"),
      packingList("2044", { "HS CODE": "6403.?9" }, true),
    ],
  },
];

// Same spec, same bytes: a document resent unchanged must hash identically.
const rendered = new Map<string, Buffer>();
async function render(a: Attachment) {
  const key = JSON.stringify(a);
  if (!rendered.has(key)) {
    const spec = { title: a.title, lines: toLines(a.fields), messy: a.messy };
    rendered.set(key, Buffer.from(await renderDocument(spec)));
  }
  return rendered.get(key)!;
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
for (const sample of samples) {
  const folder = join(outDir, sample.name);
  mkdirSync(folder);
  const attachments = [];
  for (const a of sample.attachments) {
    const content = "raw" in a ? a.raw : await render(a);
    writeFileSync(join(folder, a.file), content);
    attachments.push({ filename: a.file, content, contentType: "application/pdf" });
  }
  const eml = await new MailComposer({
    from: SUPPLIER,
    to: CG,
    subject: sample.subject,
    date: new Date(sample.date),
    messageId: messageId(sample.name),
    inReplyTo: sample.inReplyTo,
    references: sample.inReplyTo ? [sample.inReplyTo] : undefined,
    text: sample.text,
    attachments,
  })
    .compile()
    .build();
  writeFileSync(join(outDir, `${sample.name}.eml`), eml);
  console.log(join(outDir, `${sample.name}.eml`));
}
