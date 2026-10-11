import { degrees, PDFDocument, rgb, StandardFonts } from "pdf-lib";

export type Line = { label: string; value: string };

export type DocumentSpec = {
  title: string;
  lines: Line[];
  note?: string;
  messy?: boolean;
  secondPage?: Line[];
};

export const toLines = (fields: Record<string, string>): Line[] =>
  Object.entries(fields).map(([label, value]) => ({ label, value }));

/** A synthetic trade document with a real text layer; "messy" adds noise, tilt and a smudge. */
export async function renderDocument(spec: DocumentSpec): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = spec.messy ? rgb(0.62, 0.62, 0.6) : rgb(0.1, 0.1, 0.1);
  const tilt = spec.messy ? degrees(-1.8) : degrees(0);

  const page = pdf.addPage([595, 842]);
  page.drawText(spec.title, { x: 50, y: 780, size: 20, font: bold, color: ink, rotate: tilt });

  let y = 730;
  for (const { label, value } of spec.lines) {
    const x = spec.messy ? 50 + ((y / 7) % 9) : 50;
    page.drawText(`${label}:`, { x, y, size: 10, font: bold, color: ink, rotate: tilt });
    page.drawText(value, { x: x + 170, y, size: 10, font, color: ink, rotate: tilt });
    if (spec.messy && label === "HS CODE") {
      page.drawRectangle({
        x: x + 190,
        y: y - 3,
        width: 22,
        height: 14,
        color: rgb(0.5, 0.5, 0.48),
        opacity: 0.7,
      });
    }
    y -= 28;
  }

  if (spec.messy) {
    for (let i = 0; i < 220; i++) {
      page.drawCircle({
        x: (i * 137) % 595,
        y: (i * 251) % 842,
        size: 0.6 + (i % 3),
        color: rgb(0.55, 0.55, 0.55),
        opacity: 0.35,
      });
    }
    page.drawRectangle({
      x: 330,
      y: 380,
      width: 265,
      height: 120,
      color: rgb(0.8, 0.78, 0.72),
      opacity: 0.45,
    });
  }
  if (spec.note) {
    page.drawText(spec.note, { x: 50, y: 60, size: 8, font, color: rgb(0.4, 0.4, 0.4) });
  }

  if (spec.secondPage) {
    const second = pdf.addPage([595, 842]);
    let y2 = 780;
    for (const { label, value } of spec.secondPage) {
      second.drawText(`${label}: ${value}`, {
        x: 60,
        y: y2,
        size: 10,
        font,
        color: ink,
        rotate: tilt,
      });
      y2 -= 28;
    }
  }
  return pdf.save();
}
