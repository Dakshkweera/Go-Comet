import { createHash } from "node:crypto";
import { simpleParser, type AddressObject } from "mailparser";

export class EmailParseError extends Error {
  readonly code = "EMAIL_INVALID";
}

export type ParsedAttachment = { filename: string; content: Buffer; mimeType: string | null };

export type ParsedEmail = {
  messageId: string;
  fromAddress: string;
  fromName: string | null;
  replyTo: string | null;
  to: string | null;
  subject: string;
  sentAt: string | null;
  text: string;
  inReplyTo: string | null;
  references: string[];
  attachments: ParsedAttachment[];
  skipped: string[];
};

/** Detects the real file type from its first bytes; mail clients often label PDFs octet-stream. */
export function sniffMimeType(content: Buffer): string | null {
  if (content.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return "image/png";
  if (content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) return "image/jpeg";
  if (
    content.subarray(0, 4).toString("latin1") === "RIFF" &&
    content.subarray(8, 12).toString("latin1") === "WEBP"
  )
    return "image/webp";
  return null;
}

const first = (address: AddressObject | AddressObject[] | undefined) =>
  (Array.isArray(address) ? address[0] : address)?.value[0];

export async function parseEmail(raw: Buffer): Promise<ParsedEmail> {
  let mail;
  try {
    mail = await simpleParser(raw);
  } catch {
    throw new EmailParseError("The email could not be parsed.");
  }
  const from = first(mail.from);
  if (!from?.address) throw new EmailParseError("The email has no sender address to reply to.");

  const attachments: ParsedAttachment[] = [];
  const skipped: string[] = [];
  mail.attachments.forEach((a, i) => {
    const mimeType = sniffMimeType(a.content);
    const filename = a.filename?.trim() || `attachment-${i + 1}`;
    const inline = a.related || (a.contentDisposition === "inline" && Boolean(a.cid));
    if (inline && mimeType !== "application/pdf") skipped.push(filename);
    else attachments.push({ filename, content: a.content, mimeType });
  });

  const references = mail.references
    ? Array.isArray(mail.references)
      ? mail.references
      : mail.references.split(/\s+/)
    : [];
  return {
    messageId:
      mail.messageId?.trim() || `<sha256-${createHash("sha256").update(raw).digest("hex")}>`,
    fromAddress: from.address.toLowerCase(),
    fromName: from.name || null,
    replyTo: first(mail.replyTo)?.address?.toLowerCase() ?? null,
    to: first(mail.to)?.address?.toLowerCase() ?? null,
    subject: mail.subject?.trim() || "(no subject)",
    sentAt: mail.date ? mail.date.toISOString() : null,
    text: (mail.text ?? (mail.html ? mail.html.replace(/<[^>]+>/g, " ") : "")).trim(),
    inReplyTo: mail.inReplyTo?.trim() || null,
    references: references.filter(Boolean),
    attachments,
    skipped,
  };
}
