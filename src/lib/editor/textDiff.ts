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

export interface OcrPatchPlan {
  /** The PDF-space box to patch: just the changed characters, or the whole original box. */
  box: Rect;
  /** The text the patch replaces and the text it draws — always the same granularity as `box`. */
  originalText: string;
  newText: string;
  /** True when only the changed characters are patched. */
  partial: boolean;
}

/**
 * Decides what an OCR correction patches and draws. Only a same-length swap of digits
 * (2026 -> 2028, $182.50 -> $182.60) is patched as just the changed characters, and only when
 * the real per-character boxes needed to locate them are available (word-level edits). Anything
 * else — letters, a longer/shorter result, or a line-level edit that has no per-character boxes —
 * redraws the whole original box with the whole new text.
 *
 * The box and the drawn text must always be chosen together: patching the whole box while drawing
 * only the changed middle ("8") would erase everything else in that box.
 */
export function planOcrPatch(chars: CharBox[] | undefined, originalText: string, newText: string, wholeBox: Rect): OcrPatchPlan {
  const span = computeChangedSpan(originalText, newText);
  const digitSwap =
    span.originalMiddle.length === span.replacementMiddle.length &&
    /^[0-9]+$/.test(span.originalMiddle) &&
    /^[0-9]+$/.test(span.replacementMiddle);
  const subRect = digitSwap ? computeChangedSubRect(chars, originalText, span) : null;
  if (subRect) return { box: subRect, originalText: span.originalMiddle, newText: span.replacementMiddle, partial: true };
  return { box: wholeBox, originalText, newText, partial: false };
}
