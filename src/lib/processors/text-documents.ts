import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { parseMarkdown, type MdBlock } from "./markdown";

export class ProcessorError extends Error {}

function wrapText(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, fontSize) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

const PAGE_WIDTH = 595.28; // A4
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;

export interface TextToPdfOptions {
  fontSize: number;
}

export async function textToPdf(text: string, options: TextToPdfOptions): Promise<Blob> {
  if (!text.trim()) throw new ProcessorError("There's no text to convert.");
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const lineHeight = options.fontSize * 1.4;
  const maxWidth = PAGE_WIDTH - MARGIN * 2;

  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const paragraphs = text.replace(/\r\n/g, "\n").split("\n");
  for (const paragraph of paragraphs) {
    const lines = paragraph === "" ? [""] : wrapText(paragraph, font, options.fontSize, maxWidth);
    for (const line of lines) {
      if (y < MARGIN) {
        page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        y = PAGE_HEIGHT - MARGIN;
      }
      page.drawText(line, { x: MARGIN, y, size: options.fontSize, font, color: rgb(0.1, 0.1, 0.1) });
      y -= lineHeight;
    }
  }

  const bytes = await doc.save();
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}

export function textToHtml(text: string, title: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; line-height: 1.6; max-width: 760px; margin: 40px auto; padding: 0 20px; white-space: pre-wrap; }
</style>
</head>
<body>${escaped}</body>
</html>
`;
}

interface PdfCursor {
  page: PDFPage;
  y: number;
}

function ensureSpace(doc: PDFDocument, cursor: PdfCursor, needed: number): PdfCursor {
  if (cursor.y - needed < MARGIN) {
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    return { page, y: PAGE_HEIGHT - MARGIN };
  }
  return cursor;
}

export async function markdownToPdf(source: string): Promise<Blob> {
  if (!source.trim()) throw new ProcessorError("There's no Markdown to convert.");
  const blocks: MdBlock[] = parseMarkdown(source);
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);
  const mono = await doc.embedFont(StandardFonts.Courier);
  const maxWidth = PAGE_WIDTH - MARGIN * 2;

  let cursor: PdfCursor = { page: doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]), y: PAGE_HEIGHT - MARGIN };

  const drawParagraph = (text: string, font: PDFFont, size: number, lineHeight: number, indent = 0) => {
    const lines = wrapText(text, font, size, maxWidth - indent);
    for (const line of lines) {
      cursor = ensureSpace(doc, cursor, lineHeight);
      cursor.page.drawText(line, { x: MARGIN + indent, y: cursor.y, size, font, color: rgb(0.1, 0.1, 0.1) });
      cursor.y -= lineHeight;
    }
  };

  const stripInlineMarkers = (text: string) =>
    text
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_m, a, b) => a ?? b)
      .replace(/\*([^*]+)\*|_([^_]+)_/g, (_m, a, b) => a ?? b)
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  for (const block of blocks) {
    switch (block.type) {
      case "heading": {
        const sizeByLevel: Record<number, number> = { 1: 24, 2: 20, 3: 16, 4: 14, 5: 12, 6: 11 };
        const size = sizeByLevel[block.level] ?? 12;
        cursor.y -= 6;
        drawParagraph(stripInlineMarkers(block.text), bold, size, size * 1.3);
        cursor.y -= 4;
        break;
      }
      case "paragraph":
        drawParagraph(stripInlineMarkers(block.text), regular, 11, 15);
        cursor.y -= 6;
        break;
      case "quote":
        drawParagraph(stripInlineMarkers(block.text), italic, 11, 15, 16);
        cursor.y -= 6;
        break;
      case "listitem":
        drawParagraph(`•  ${stripInlineMarkers(block.text)}`, regular, 11, 15, 12);
        break;
      case "code":
        for (const line of block.text.split("\n")) {
          cursor = ensureSpace(doc, cursor, 14);
          cursor.page.drawText(line, { x: MARGIN + 8, y: cursor.y, size: 9.5, font: mono, color: rgb(0.2, 0.2, 0.2) });
          cursor.y -= 13;
        }
        cursor.y -= 6;
        break;
      case "hr":
        cursor = ensureSpace(doc, cursor, 20);
        cursor.page.drawLine({
          start: { x: MARGIN, y: cursor.y },
          end: { x: PAGE_WIDTH - MARGIN, y: cursor.y },
          thickness: 1,
          color: rgb(0.85, 0.85, 0.85),
        });
        cursor.y -= 16;
        break;
    }
  }

  const bytes = await doc.save();
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}
