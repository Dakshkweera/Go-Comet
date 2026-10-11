import MailComposer from "nodemailer/lib/mail-composer/index.js";

export type TestAttachment = {
  filename: string;
  content: Buffer | string;
  contentType?: string;
  cid?: string;
  contentDisposition?: "attachment" | "inline";
};

export type TestEmail = {
  from?: string;
  subject?: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
  text?: string;
  attachments?: TestAttachment[];
};

export const SUPPLIER = "Guangzhou Leatherworks <docs@gzleather.example>";

export const pdf = (label: string) => Buffer.from(`%PDF-1.4 ${label}`);

export function buildEml(email: TestEmail = {}): Promise<Buffer> {
  return new MailComposer({
    from: email.from ?? SUPPLIER,
    to: "cg@nova.local",
    subject: email.subject ?? "Shipment documents INV-2026-2041",
    messageId: email.messageId,
    inReplyTo: email.inReplyTo,
    references: email.references,
    text: email.text ?? "Please find the shipment documents attached.",
    attachments: email.attachments ?? [],
  })
    .compile()
    .build();
}
