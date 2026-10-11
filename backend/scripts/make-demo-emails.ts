import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { renderDocument, toLines } from "./pdf.js";

// Three emails to upload by hand in a demo, one per outcome. They share the document layout of
// the numbered samples, so each one is read the way its numbered twin is.
const CG = '"CG Team" <cg@nova.local>';
const outDir = fileURLToPath(new URL("../../samples/demo-emails/", import.meta.url));
const consignee = "Bata India Limited, Kolkata, India";
const shipper = "Guangzhou Leatherworks Co., Ltd., Guangzhou, China";

type Fields = Record<string, string>;
type Demo = {
  name: string;
  sender: string;
  address: string;
  invoiceNo: string;
  note: string;
  bol?: Fields;
  packingList?: Fields;
  messyPackingList?: boolean;
};

const demos: Demo[] = [
  {
    name: "demo-auto-approved",
    sender: "Demo Supplier (auto-approved)",
    address: "demoautoapproved@gmail.com",
    invoiceNo: "3001",
    note: "Every document agrees and matches the customer's rules.",
  },
  {
    name: "demo-human-review",
    sender: "Demo Supplier (human review)",
    address: "demohumanreview@gmail.com",
    invoiceNo: "3002",
    note: "The packing list is a scan from the warehouse, so the HS code is hard to read.",
    packingList: { "HS CODE": "6403.?9" },
    messyPackingList: true,
  },
  {
    name: "demo-amendment-request",
    sender: "Demo Supplier (amendment request)",
    address: "demoamendmentrequest@gmail.com",
    invoiceNo: "3003",
    note: "The bill of lading and packing list were prepared by different people.",
    bol: { "GROSS WEIGHT": "950 KG" },
    packingList: { "HS CODE": "6403.22" },
  },
];

function attachments({ invoiceNo: no, bol, packingList, messyPackingList }: Demo) {
  const documents: { file: string; title: string; fields: Fields; messy?: boolean }[] = [
    {
      file: `CI-${no}.pdf`,
      title: "COMMERCIAL INVOICE",
      fields: {
        "INVOICE NO": `INV-2026-${no}`,
        DATE: "2026-10-06",
        SHIPPER: shipper,
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
      },
    },
    {
      file: `BL-${no}.pdf`,
      title: "BILL OF LADING",
      fields: {
        "B/L NO": `COSU62345${no}`,
        SHIPPER: shipper,
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
        ...bol,
      },
    },
    {
      file: `PL-${no}.pdf`,
      title: "PACKING LIST",
      messy: messyPackingList,
      fields: {
        "INVOICE NO": `INV-2026-${no}`,
        CONSIGNEE: consignee,
        "DESCRIPTION OF GOODS": "Leather footwear, men's formal shoes",
        PACKAGES: "48 cartons, 25 pairs per carton",
        "HS CODE": "6403.99",
        "NET WEIGHT": "840 KG",
        "GROSS WEIGHT": "900 KG",
        MEASUREMENT: "28.4 CBM",
        ...packingList,
      },
    },
  ];
  return Promise.all(
    documents.map(async (d) => ({
      filename: d.file,
      contentType: "application/pdf",
      content: Buffer.from(
        await renderDocument({ title: d.title, lines: toLines(d.fields), messy: d.messy }),
      ),
    })),
  );
}

mkdirSync(outDir, { recursive: true });
for (const demo of demos) {
  const eml = await new MailComposer({
    from: `"${demo.sender}" <${demo.address}>`,
    to: CG,
    subject: `Shipment documents INV-2026-${demo.invoiceNo}`,
    date: new Date("2026-10-11T09:00:00Z"),
    messageId: `<${demo.name}@gmail.com>`,
    text: `Dear CG team,\n\nPlease find attached the shipping documents for invoice INV-2026-${demo.invoiceNo} (consignee: Bata India). ${demo.note}\n\nBest regards,\n${demo.sender}`,
    attachments: await attachments(demo),
  })
    .compile()
    .build();
  writeFileSync(join(outDir, `${demo.name}.eml`), eml);
  console.log(join(outDir, `${demo.name}.eml`));
}
