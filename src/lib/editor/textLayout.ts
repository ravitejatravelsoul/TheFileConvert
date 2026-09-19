/**
 * Layout for editor text objects: line wrapping and vertical placement, shared by the PDF
 * export so a text box wraps and sits the same way in the file as it does on screen.
 *
 * Kept free of pdf-lib / DOM types (it only needs "how wide is this string at size 1") so it
 * can be unit-tested with a fake measuring function.
 */

export type MeasureFn = (text: string) => number;

/** CSS line-height multiplier used by the on-canvas text box; export must use the same. */
export const TEXT_LINE_HEIGHT = 1.2;

/** Where, as a multiple of font size below the top of a line box, the baseline sits — the
 * ascent (~0.905 for Helvetica/Arial) plus the half-leading CSS adds above the glyphs when
 * line-height (1.2) exceeds the font's natural content height (~1.117). Keeping this in one
 * place means the text a user sees in the editor lands on the same baseline in the export. */
export const TEXT_BASELINE_FROM_LINE_TOP = 0.9465;

/**
 * Greedy word-wrap of `text` (which may contain explicit "\n" line breaks) into lines no wider
 * than `maxWidth` under `measure`. A single word wider than the box is broken across lines by
 * character rather than overflowing. Empty paragraphs are preserved as blank lines.
 */
export function wrapText(text: string, maxWidth: number, measure: MeasureFn): string[] {
  const out: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (paragraph === "") {
      out.push("");
      continue;
    }
    if (maxWidth <= 0) {
      out.push(paragraph);
      continue;
    }
    let line = "";
    for (const word of paragraph.split(/(?<= )/)) {
      // `word` keeps its trailing space so widths include inter-word spacing.
      const candidate = line + word;
      if (measure(candidate.trimEnd()) <= maxWidth || line === "") {
        if (measure(word.trimEnd()) > maxWidth && line === "") {
          // A single over-wide word: break it by characters.
          let chunk = "";
          for (const ch of word) {
            if (measure(chunk + ch) > maxWidth && chunk !== "") {
              out.push(chunk);
              chunk = ch;
            } else {
              chunk += ch;
            }
          }
          line = chunk;
        } else {
          line = candidate;
        }
      } else {
        out.push(line.trimEnd());
        line = word;
        if (measure(line.trimEnd()) > maxWidth) {
          let chunk = "";
          for (const ch of line) {
            if (measure(chunk + ch) > maxWidth && chunk !== "") {
              out.push(chunk);
              chunk = ch;
            } else {
              chunk += ch;
            }
          }
          line = chunk;
        }
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}

/** Baseline y (PDF space, y-up) of line `index` for a text box whose top edge is `topY`. */
export function lineBaselineY(topY: number, fontSize: number, index: number): number {
  return topY - (TEXT_BASELINE_FROM_LINE_TOP + TEXT_LINE_HEIGHT * index) * fontSize;
}

/** Replaces characters a standard PDF font can't encode with "?" so one stray character
 * (an emoji, a symbol outside WinAnsi) doesn't make the whole run silently disappear. */
export function sanitizeForFont(text: string, canEncode: (ch: string) => boolean): string {
  let out = "";
  for (const ch of text) out += ch === "\n" || canEncode(ch) ? ch : "?";
  return out;
}
