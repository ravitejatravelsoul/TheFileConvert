import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { parseMarkdown, stripInlineMarkdown, type MdBlock } from "./markdown";

export class ProcessorError extends Error {}

const PAGE_WIDTH = 595.28; // A4
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;

export interface PdfBuildResult {
  blob: Blob;
  /** Distinct characters the built-in PDF font can't draw; each was replaced with "?" in the PDF. */
  replacedCharacters: string[];
}

/** Text the standard PDF fonts can draw: tabs become spaces, and any character outside their (Latin-1
 * style) range is swapped for "?" and remembered, so the user is told rather than getting an error. */
function makeDrawable(text: string, font: PDFFont, replaced: Set<string>): string {
  let out = "";
  for (const ch of text.replace(/\t/g, "    ")) {
    if (ch === "\n") {
      out += ch;
      continue;
    }
    try {
      font.widthOfTextAtSize(ch, 10);
      out += ch;
    } catch {
      replaced.add(ch);
      out += "?";
    }
  }
  return out;
}

/** Breaks a single over-long token (a URL, a 300-character run) so it wraps instead of running off the page. */
function breakLongToken(token: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  const parts: string[] = [];
  let current = "";
  for (const ch of token) {
    if (current && font.widthOfTextAtSize(current + ch, fontSize) > maxWidth) {
      parts.push(current);
      current = ch;
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function wrapText(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean).flatMap((w) => (font.widthOfTextAtSize(w, fontSize) > maxWidth ? breakLongToken(w, font, fontSize, maxWidth) : [w]));
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

/** Wraps a line of code at the character level (code spacing matters, so no word reflow). */
function wrapCodeLine(line: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  if (font.widthOfTextAtSize(line, fontSize) <= maxWidth) return [line];
  return breakLongToken(line, font, fontSize, maxWidth);
}

export interface TextToPdfOptions {
  fontSize: number;
}

export async function textToPdf(text: string, options: TextToPdfOptions): Promise<PdfBuildResult> {
  if (!text.trim()) throw new ProcessorError("There's no text to convert.");
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const lineHeight = options.fontSize * 1.4;
  const maxWidth = PAGE_WIDTH - MARGIN * 2;
  const replaced = new Set<string>();

  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const paragraphs = makeDrawable(text.replace(/\r\n/g, "\n"), font, replaced).split("\n");
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
  return { blob: new Blob([bytes as BlobPart], { type: "application/pdf" }), replacedCharacters: [...replaced] };
}

export function textToHtml(text: string, title: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const safeTitle = title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${safeTitle}</title>
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

export async function markdownToPdf(source: string): Promise<PdfBuildResult> {
  if (!source.trim()) throw new ProcessorError("There's no Markdown to convert.");
  const blocks: MdBlock[] = parseMarkdown(source);
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);
  const mono = await doc.embedFont(StandardFonts.Courier);
  const maxWidth = PAGE_WIDTH - MARGIN * 2;
  const replaced = new Set<string>();
  const draw = (text: string, font: PDFFont) => makeDrawable(text, font, replaced);

  let cursor: PdfCursor = { page: doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]), y: PAGE_HEIGHT - MARGIN };

  const drawParagraph = (text: string, font: PDFFont, size: number, lineHeight: number, indent = 0) => {
    const lines = wrapText(draw(text, font), font, size, maxWidth - indent);
    for (const line of lines) {
      cursor = ensureSpace(doc, cursor, lineHeight);
      cursor.page.drawText(line, { x: MARGIN + indent, y: cursor.y, size, font, color: rgb(0.1, 0.1, 0.1) });
      cursor.y -= lineHeight;
    }
  };

  // Ordered-list numbering follows the source: consecutive numbered items at one depth count up.
  const counters: number[] = [];

  for (const block of blocks) {
    if (block.type !== "listitem") counters.length = 0;
    switch (block.type) {
      case "heading": {
        const sizeByLevel: Record<number, number> = { 1: 24, 2: 20, 3: 16, 4: 14, 5: 12, 6: 11 };
        const size = sizeByLevel[block.level] ?? 12;
        cursor.y -= 6;
        drawParagraph(stripInlineMarkdown(block.text), bold, size, size * 1.3);
        cursor.y -= 4;
        break;
      }
      case "paragraph":
        drawParagraph(stripInlineMarkdown(block.text), regular, 11, 15);
        cursor.y -= 6;
        break;
      case "quote":
        drawParagraph(stripInlineMarkdown(block.text), italic, 11, 15, 16);
        cursor.y -= 6;
        break;
      case "listitem": {
        counters.length = block.depth + 1;
        let marker = "•";
        if (block.ordered) {
          counters[block.depth] = (counters[block.depth] ?? (block.number ?? 1) - 1) + 1;
          marker = `${counters[block.depth]}.`;
        } else {
          counters[block.depth] = 0;
        }
        drawParagraph(`${marker}  ${stripInlineMarkdown(block.text)}`, regular, 11, 15, 12 + block.depth * 16);
        break;
      }
      case "code":
        for (const rawLine of block.text.split("\n")) {
          for (const line of wrapCodeLine(draw(rawLine, mono), mono, 9.5, maxWidth - 8)) {
            cursor = ensureSpace(doc, cursor, 14);
            cursor.page.drawText(line, { x: MARGIN + 8, y: cursor.y, size: 9.5, font: mono, color: rgb(0.2, 0.2, 0.2) });
            cursor.y -= 13;
          }
        }
        cursor.y -= 6;
        break;
      case "table": {
        const cols = block.header.length;
        const colWidth = maxWidth / cols;
        const size = 10;
        const drawRow = (cells: string[], font: PDFFont, shade: boolean) => {
          const wrapped = cells.map((c) => wrapText(draw(stripInlineMarkdown(c), font), font, size, colWidth - 8));
          const height = Math.max(...wrapped.map((l) => l.length)) * 13 + 6;
          cursor = ensureSpace(doc, cursor, height);
          const top = cursor.y + 4;
          if (shade) cursor.page.drawRectangle({ x: MARGIN, y: top - height, width: maxWidth, height, color: rgb(0.95, 0.95, 0.96) });
          wrapped.forEach((lines, c) =>
            lines.forEach((line, l) => cursor.page.drawText(line, { x: MARGIN + c * colWidth + 4, y: cursor.y - l * 13, size, font, color: rgb(0.1, 0.1, 0.1) }))
          );
          cursor.page.drawLine({ start: { x: MARGIN, y: top - height }, end: { x: MARGIN + maxWidth, y: top - height }, thickness: 0.6, color: rgb(0.8, 0.8, 0.82) });
          cursor.y -= height;
        };
        drawRow(block.header, bold, true);
        for (const row of block.rows) drawRow(row, regular, false);
        cursor.y -= 8;
        break;
      }
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
  return { blob: new Blob([bytes as BlobPart], { type: "application/pdf" }), replacedCharacters: [...replaced] };
}

/** One plain-language sentence for the result screen when characters had to be replaced. */
export function replacedCharactersNote(replaced: string[]): string | undefined {
  if (replaced.length === 0) return undefined;
  const shown = replaced.slice(0, 6).join(" ");
  return `The PDF's built-in fonts can't draw ${replaced.length === 1 ? "this character" : "these characters"} (${shown}${replaced.length > 6 ? " …" : ""}), so ${replaced.length === 1 ? "it was" : "they were"} replaced with "?". Everything else is intact.`;
}
