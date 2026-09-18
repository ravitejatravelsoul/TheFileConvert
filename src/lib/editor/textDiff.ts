import type { Rect } from "./coordinates";

/**
 * Finds the minimal changed span between an OCR word's original text and the user's
 * replacement, via common prefix/suffix — the basis for patching only the characters that
 * actually changed (e.g. "2026" -> "2028" changes only the final digit) instead of the whole
 * word, which is what made even word-level edits look wider than necessary.
 */
export interface ChangedSpan {
  /** Characters common to both strings at the start. */
  prefixLen: number;
  /** Characters common to both strings at the end, not overlapping the prefix. */
  suffixLen: number;
  /** The actual differing substring of the original text. */
  originalMiddle: string;
  /** The actual differing substring of the replacement text. */
  replacementMiddle: string;
}

export function computeChangedSpan(original: string, replacement: string): ChangedSpan {
  const maxPrefix = Math.min(original.length, replacement.length);
  let prefixLen = 0;
  while (prefixLen < maxPrefix && original[prefixLen] === replacement[prefixLen]) prefixLen++;

  const maxSuffix = Math.min(original.length, replacement.length) - prefixLen;
  let suffixLen = 0;
  while (suffixLen < maxSuffix && original[original.length - 1 - suffixLen] === replacement[replacement.length - 1 - suffixLen]) {
    suffixLen++;
  }

  return {
    prefixLen,
    suffixLen,
    originalMiddle: original.slice(prefixLen, original.length - suffixLen),
    replacementMiddle: replacement.slice(prefixLen, replacement.length - suffixLen),
  };
}

export interface CharBox {
  text: string;
  pdfBox: Rect;
}

/**
 * Maps a changed span (in string-index space) onto a tight PDF-space rect covering just
 * those characters' own ink, using OCR's real per-character boxes rather than assuming even
 * spacing across the word. Returns null when char boxes aren't available/trustworthy (their
 * concatenated text doesn't match the word's own text — e.g. an OCR symbol merge/split), so
 * the caller can fall back to patching the whole word rather than guessing at geometry.
 */
export function computeChangedSubRect(chars: CharBox[] | undefined, originalText: string, span: ChangedSpan): Rect | null {
  if (!chars || chars.length === 0) return null;
  if (chars.map((c) => c.text).join("") !== originalText) return null;

  const changedChars = chars.slice(span.prefixLen, chars.length - span.suffixLen);
  if (changedChars.length === 0) return null;

  const x0 = Math.min(...changedChars.map((c) => c.pdfBox.x));
  const x1 = Math.max(...changedChars.map((c) => c.pdfBox.x + c.pdfBox.width));
  const y0 = Math.min(...changedChars.map((c) => c.pdfBox.y));
  const y1 = Math.max(...changedChars.map((c) => c.pdfBox.y + c.pdfBox.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
