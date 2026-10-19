/**
 * How the value of a form text field is laid out inside its widget — one function used by both the live text box on the page
 * and the appearance stream written on export, so what you see while typing is what the file draws.
 *
 * Pure: widths come in through `measure`. Units are PDF points; y runs up from the bottom of the widget.
 */

export type FormFamily = "sans" | "serif" | "mono";

/** Ascent and descent (em) of the font the text is set in (the metric twins of Helvetica, Times and Courier we also write with). */
export const FORM_FONT_BOX: Record<FormFamily, { ascent: number; descent: number }> = {
  sans: { ascent: 0.905, descent: 0.212 },
  serif: { ascent: 0.891, descent: 0.216 },
  mono: { ascent: 0.833, descent: 0.3 },
};

export interface DefaultAppearance {
  /** The font resource name in /DA (Helv, TiRo, Cour, …). */
  fontName: string;
  /** Font size; 0 means auto-size. */
  size: number;
  /** Text colour, each 0–1. */
  color: { r: number; g: number; b: number };
}

/** Reads a /DA string: "/Helv 12 Tf 0 g", "/Arial 0 Tf 0.1 0.2 0.7 rg", "0 0 0 1 k /Cour 9 Tf". */
export function parseDefaultAppearance(da: string | undefined | null): DefaultAppearance {
  const out: DefaultAppearance = { fontName: "Helv", size: 0, color: { r: 0, g: 0, b: 0 } };
  if (!da) return out;
  const tf = /\/(\S+)\s+(-?[\d.]+)\s+Tf/.exec(da);
  if (tf) {
    out.fontName = tf[1];
    out.size = Math.max(0, Number(tf[2]) || 0);
  }
  const rgbm = /(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+rg/.exec(da);
  const gm = /(-?[\d.]+)\s+g(?![a-zA-Z])/.exec(da);
  const km = /(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+k(?![a-zA-Z])/.exec(da);
  const clamp = (n: number) => Math.min(1, Math.max(0, n));
  if (rgbm) out.color = { r: clamp(+rgbm[1]), g: clamp(+rgbm[2]), b: clamp(+rgbm[3]) };
  else if (km) {
    const [c, m, y, k] = [+km[1], +km[2], +km[3], +km[4]].map(clamp);
    out.color = { r: (1 - c) * (1 - k), g: (1 - m) * (1 - k), b: (1 - y) * (1 - k) };
  } else if (gm) {
    const g = clamp(+gm[1]);
    out.color = { r: g, g, b: g };
  }
  return out;
}

/** The standard family a /DA font name stands for (anything unknown is sans, like Acrobat's own fallback). */
export function familyOfFontName(name: string): FormFamily {
  if (/ti(ro|me)|times|serif|georgia|garamond|cambria|palatino|book/i.test(name)) return "serif";
  if (/cour|mono|consol|typewriter/i.test(name)) return "mono";
  return "sans";
}

export interface TextLayoutInput {
  width: number;
  height: number;
  value: string;
  multiline: boolean;
  /** 0 = auto-size. */
  fontSize: number;
  family: FormFamily;
  /** /Q: 0 left, 1 centre, 2 right. */
  align: 0 | 1 | 2;
  /** Width of the widget's border (/BS /W, or /Border). */
  borderWidth: number;
  measure: (text: string, size: number) => number;
}

export interface TextLayout {
  fontSize: number;
  padding: number;
  lineHeight: number;
  lines: { text: string; x: number; baseline: number }[];
}

/** Auto-size of a multi-line field starts here and shrinks until the text fits. */
export const AUTO_MAX = 12;
export const AUTO_MIN = 4;

export function formPadding(borderWidth: number): number {
  return Math.max(0, borderWidth) + 1;
}

function wrap(value: string, width: number, size: number, measure: TextLayoutInput["measure"]): string[] {
  const out: string[] = [];
  for (const para of value.split(/\r\n|\r|\n/)) {
    let line = "";
    for (const word of para.split(/(?<= )/)) {
      const trial = line + word;
      if (line && measure(trial.trimEnd(), size) > width) {
        out.push(line.trimEnd());
        line = word;
      } else line = trial;
    }
    out.push(line.trimEnd());
  }
  return out;
}

export function layoutFormText(input: TextLayoutInput): TextLayout {
  const { width, height, value, multiline, family, align, measure } = input;
  const { ascent, descent } = FORM_FONT_BOX[family];
  const pad = formPadding(input.borderWidth);
  const innerW = Math.max(1, width - 2 * pad);
  const innerH = Math.max(1, height - 2 * pad);
  const lineFactor = ascent + descent;
  let size = input.fontSize;

  if (!multiline) {
    if (size <= 0) {
      // auto-size on one line: as large as the height allows (what pdf-lib and most producers do), then narrowed to the width
      size = innerH / lineFactor;
      const w = measure(value, size);
      if (w > innerW && w > 0) size = Math.max(AUTO_MIN, (size * innerW) / w);
    }
    const w = measure(value, size);
    const x = align === 1 ? (width - w) / 2 : align === 2 ? width - pad - w : pad;
    // vertically centred: the line box (ascent + descent) sits in the middle of the widget
    const baseline = (height - lineFactor * size) / 2 + descent * size;
    return { fontSize: size, padding: pad, lineHeight: lineFactor * size, lines: [{ text: value, x: Math.max(pad, x), baseline }] };
  }

  let lines: string[];
  if (size <= 0) {
    size = AUTO_MAX;
    lines = wrap(value, innerW, size, measure);
    while (size > AUTO_MIN && lines.length * lineFactor * size > innerH) {
      size -= 0.5;
      lines = wrap(value, innerW, size, measure);
    }
  } else lines = wrap(value, innerW, size, measure);
  const lh = lineFactor * size;
  return {
    fontSize: size,
    padding: pad,
    lineHeight: lh,
    lines: lines.map((text, i) => {
      const w = measure(text, size);
      const x = align === 1 ? (width - w) / 2 : align === 2 ? width - pad - w : pad;
      return { text, x: Math.max(pad, x), baseline: height - pad - ascent * size - i * lh };
    }),
  };
}
