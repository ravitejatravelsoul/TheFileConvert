import type { Fill, PageImage, PageInput, Rule, TextItem } from "./layout";
import { inkThreshold, luminance, strokeWeight, type PxBox, type Raster, type ScanAnalysis } from "./scan";
import { HEIGHTS, WIDTH_CHARS, WIDTHS } from "./fontWidths";

/**
 * A scanned page's input for layout: OCR words + the structure found in the pixels (scan.ts), in the page's
 * reading frame. Decides, from confidence, how much of the page is rebuilt and how much is kept as image:
 *
 * - structured-scan: words, rules, boxes, tables and shaded panels are rebuilt as editable Word content;
 * - hybrid: a region that can't be read reliably (a table whose cells OCR can't read, a stamp, a signature,
 *   a logo — ink no recognised word accounts for) is kept as a picture of that region, in place;
 * - visual-fallback: when the page as a whole can't be read reliably, the page image is kept behind the
 *   recognised text (which is made invisible), so the document still looks exactly like the scan.
 */

export type Strategy = "native" | "structured-scan" | "hybrid" | "visual-fallback";

export interface OcrWordIn {
  text: string;
  confidence: number;
  pdfBox: { x: number; y: number; width: number; height: number };
  /** Index of the OCR line (in `lines`) the word was read in, when the recogniser says. */
  line?: number;
}

export interface ScanReport {
  strategy: Strategy;
  /** Mean OCR confidence of the words kept, 0–100. */
  textConfidence: number;
  /** Share of the page's ink (rules aside) explained by recognised words or kept pictures, 0–1. */
  inkExplained: number;
  rules: number;
  fills: number;
  boldWords: number;
  /** Low-confidence fragments that weren't turned into text (OCR noise). */
  droppedNoise: string[];
  /** Regions kept as pictures. */
  pictures: number;
}

type Frame = { width: number; height: number; point: (x: number, y: number) => { x: number; y: number } };
type Box = { x: number; y: number; w: number; h: number };

export interface ScanPageArgs {
  words: OcrWordIn[];
  lines: { text: string; pdfBox: { x: number; y: number; width: number; height: number }; baseline?: { x0: number; y0: number; x1: number; y1: number } }[];
  analysis: ScanAnalysis;
  /** The page as rendered for OCR, before any line was erased. */
  raster: Raster;
  toPdf: (x: number, y: number) => [number, number];
  toPx: (x: number, y: number) => [number, number];
  frame: Frame;
  /** Encodes a pixel region of `raster` as a picture. */
  encode: (box: PxBox, mime: "image/png" | "image/jpeg") => Promise<PageImage | null>;
}

/** Thresholds (documented in qa/CODE_REVIEW.md). */
export const SCAN_THRESHOLDS = {
  /** A word below this confidence that is mostly symbols, or a single character, is noise. */
  noiseConfidence: 45,
  /** Any word below this confidence is noise. */
  hardNoiseConfidence: 25,
  /** A word with no letter or digit below this confidence is noise. */
  symbolConfidence: 80,
  /** A ruled region whose words average below this is kept as a picture, not rebuilt. */
  regionConfidence: 60,
  /** A page whose words average below this, or whose ink is mostly unexplained, is kept as an image. */
  pageConfidence: 50,
  pageInkExplained: 0.45,
  /** Words below this confidence don't account for ink when finding graphics (stamps, signatures, logos). */
  graphicWordConfidence: 70,
  /** Bold by x-height: the bold widths' size must match the x-height's within this share… */
  boldFit: 0.05,
  /** …and the regular widths' size must miss it by more than this. */
  regularMisfit: 0.1,
  /** A phrase whose stroke width (relative to its size, see scannedPageInput) is this much above the page's is bold. */
  boldRatio: 1.3,
};

const alnum = (s: string) => (s.match(/[\p{L}\p{N}]/gu) ?? []).length;

function isNoise(w: OcrWordIn): boolean {
  if (w.confidence < SCAN_THRESHOLDS.hardNoiseConfidence) return true;

  if (w.confidence >= SCAN_THRESHOLDS.noiseConfidence) return false;
  // Letters at middling confidence are words ("TO" in a small bold heading); marks and specks are not.
  const n = alnum(w.text);
  return n < 2 || (n === 2 && w.confidence < 40) || n / Math.max(1, w.text.length) < 0.6;
}

/** Families whose widths are known (fontWidths.ts), and the Word font each is written as. */
const FONT_NAMES = { serif: "Times New Roman", sans: "Arial", mono: "Courier New", georgia: "Georgia", calibri: "Calibri", cambria: "Cambria" } as const;
type TypeFamily = keyof typeof FONT_NAMES;
const classOf = (f: TypeFamily) => (f === "mono" ? "mono" : f === "sans" || f === "calibri" ? "sans" : "serif");
const charIndex = new Map([...WIDTH_CHARS].map((c, i) => [c, i]));

/** A word's advance width in em for a family (bold where the word is bold). */
function advance(text: string, family: TypeFamily, bold: boolean): number {
  const table = family === "mono" ? WIDTHS.mono : bold ? WIDTHS[`${family}Bold`] : WIDTHS[family];
  let w = 0;
  for (const ch of text) {
    const k = charIndex.get(ch);
    w += (k === undefined ? 520 : table[k]) / 1000;
  }
  return w;
}

const metricsKey = (f: TypeFamily, bold: boolean): keyof typeof HEIGHTS => (f === "mono" ? "mono" : bold ? `${f}Bold` : f);

/**
 * The height of a phrase's x-band in pixels — between baseline and x-height, where lowercase letters put
 * their ink (above it only ascenders, below only descenders) — or of its capitals when it has no lowercase
 * letters. Found from the ink density of the phrase's rows: the contiguous run of rows around the densest
 * one holding at least 35 % of its ink. Needs 4+ lowercase letters making up most of the phrase (or 3+
 * capitals/digits and no lowercase) to be reliable.
 */
function xBand(lum: Uint8Array, width: number, threshold: number, boxes: PxBox[], text: string): { px: number; caps: boolean } | null {
  const lower = (text.match(/\p{Ll}/gu) ?? []).length;
  const upper = (text.match(/[\p{Lu}\p{N}]/gu) ?? []).length;
  const caps = lower === 0;
  // (Lowercase must dominate: digits and capitals reach above the x-height and widen the band.)
  if (caps ? upper < 3 : lower < 4 || lower < 0.6 * (lower + upper)) return null;
  const y0 = Math.floor(Math.min(...boxes.map((b) => b.y)));
  const y1 = Math.ceil(Math.max(...boxes.map((b) => b.y + b.h)));
  if (y1 - y0 < 4) return null;
  const density: number[] = [];
  for (let y = y0; y < y1; y++) {
    let n = 0;
    let all = 0;
    for (const b of boxes) {
      if (y < b.y || y >= b.y + b.h) continue;
      for (let x = Math.floor(b.x); x < b.x + b.w && x < width; x++) {
        all++;
        if (lum[y * width + x] < threshold) n++;
      }
    }
    density.push(all ? n / all : 0);
  }
  let peak = 0;
  for (let k = 1; k < density.length; k++) if (density[k] > density[peak]) peak = k;
  const floor = density[peak] * 0.35;
  let top = peak;
  let bottom = peak;
  while (top > 0 && density[top - 1] >= floor) top--;
  while (bottom < density.length - 1 && density[bottom + 1] >= floor) bottom++;
  return { px: bottom - top + 1, caps };
}

/** Words side by side on one OCR line (gaps under ~1 em of their size), left to right. */
function phrasesOf(boxes: { x: number; w: number }[], lineOf: number[], sizes: number[]): number[][] {
  const lines = new Map<number, number[]>();
  boxes.forEach((_, i) => {
    const k = lineOf[i] >= 0 ? lineOf[i] : -1 - i;
    if (!lines.has(k)) lines.set(k, []);
    lines.get(k)!.push(i);
  });
  const out: number[][] = [];
  for (const idx of lines.values()) {
    idx.sort((p, q) => boxes[p].x - boxes[q].x);
    let cur: number[] = [];
    for (const i of idx) {
      const prev = cur[cur.length - 1];
      if (prev !== undefined && boxes[i].x - (boxes[prev].x + boxes[prev].w) > Math.max(sizes[i], sizes[prev])) {
        out.push(cur);
        cur = [];
      }
      cur.push(i);
    }
    if (cur.length) out.push(cur);
  }
  return out;
}

/**
 * Font family and size of each recognised word, from how wide it is on the page. For a candidate family a
 * word's size is (measured ink width) ÷ (its advance width in that font − ~0.08 em of side bearings); the
 * true family gives the same size to words set in one size, a wrong one scatters them.
 *
 * - Family: decided for the page by the lines with at least 3 measurable words (each votes for the family
 *   with clearly the least scatter, weighted by its words). A line keeps its own family only with strong
 *   evidence (4+ words, 6+ for monospace) — forms mix sizes on one line ("Name:" small bold, the value large),
 *   which scatters sizes in every family, so short lines can't decide.
 * - Size: per phrase — words next to each other on a line (a gap under ~1 em) share a size; a label and its
 *   value, set apart, keep their own. Words too short to measure take their phrase's size, or their height's.
 */
export function estimateType(texts: string[], boxes: { x: number; w: number; h: number }[], bolds: boolean[], lineOf: number[]): { size: number; family: TypeFamily }[] {
  const families = Object.keys(FONT_NAMES) as TypeFamily[];
  const measurable = (i: number) => alnum(texts[i]) >= 3;
  const sizeFor = (i: number, f: TypeFamily) => {
    const adv = advance(texts[i], f, bolds[i]) - 0.08;
    return adv > 0.3 ? boxes[i].w / adv : null;
  };
  const med = (v: number[]) => [...v].sort((p, q) => p - q)[Math.floor(v.length / 2)];
  const scatter = (v: number[]) => {
    const m = v.reduce((x, y) => x + y, 0) / v.length;
    return Math.sqrt(v.reduce((x, y) => x + (y - m) ** 2, 0) / v.length) / m;
  };
  const lines = new Map<number, number[]>();
  texts.forEach((_, i) => {
    const k = lineOf[i] >= 0 ? lineOf[i] : -1 - i;
    if (!lines.has(k)) lines.set(k, []);
    lines.get(k)!.push(i);
  });
  for (const idx of lines.values()) idx.sort((p, q) => boxes[p].x - boxes[q].x);

  // Phrases: neighbours on a line with a gap under ~1 em (estimated from the box heights).
  const phrases: number[][] = [];
  for (const idx of lines.values()) {
    let cur: number[] = [];
    for (const i of idx) {
      const prev = cur[cur.length - 1];
      const em = Math.max(boxes[i].h, prev !== undefined ? boxes[prev].h : 0) / 0.72;
      if (prev !== undefined && boxes[i].x - (boxes[prev].x + boxes[prev].w) > em * 1.0) {
        phrases.push(cur);
        cur = [];
      }
      cur.push(i);
    }
    if (cur.length) phrases.push(cur);
  }

  // Family votes from phrases (one size within a phrase), so labels and values don't confuse the vote.
  const verdict = (idx: number[]) => {
    const scored = families
      .map((f) => {
        const ss = idx.filter(measurable).map((i) => sizeFor(i, f)).filter((v): v is number => v !== null);
        return { f, n: ss.length, sc: ss.length >= 2 ? scatter(ss) : Infinity };
      })
      .sort((p, q) => p.sc - q.sc);
    return scored[0].n >= 2 && scored[0].sc < scored[1].sc * 0.85 ? scored[0] : null;
  };
  // The page's family: the one whose sizes scatter least within phrases, pooled over all of them (one phrase
  // can't tell close families apart; a page of them can). Monospace needs clearly better evidence.
  const pooled = families.map((f) => {
    let sq = 0;
    let n = 0;
    for (const ph of phrases) {
      const ss = ph.filter(measurable).map((i) => sizeFor(i, f)).filter((v): v is number => v !== null);
      if (ss.length < 3) continue;
      const logs = ss.map(Math.log);
      const m = logs.reduce((x, y) => x + y, 0) / logs.length;
      for (const l of logs) sq += (l - m) ** 2;
      n += ss.length;
    }
    return { f, sc: n ? Math.sqrt(sq / n) : Infinity, n };
  });
  const bestOther = Math.min(...pooled.filter((p) => p.f !== "mono").map((p) => p.sc));
  const ranked = pooled.filter((p) => p.f !== "mono" || p.sc < bestOther * 0.7).sort((p, q) => p.sc - q.sc);
  const pageFamily: TypeFamily = ranked[0] && Number.isFinite(ranked[0].sc) ? ranked[0].f : "serif";
  // A long phrase in clearly another family (a monospace code line on a serif page) keeps its own.
  const phraseFamily = new Map<number[], TypeFamily>();
  for (const ph of phrases) {
    const v = verdict(ph);
    if (v && classOf(v.f) !== classOf(pageFamily) && v.n >= 4 && (v.f !== "mono" || v.n >= 6)) phraseFamily.set(ph, v.f);
  }

  const out: { size: number; family: TypeFamily }[] = texts.map(() => ({ size: 11, family: pageFamily }));
  for (const ph of phrases) {
    const family = phraseFamily.get(ph) ?? pageFamily;
    const ss = ph.filter(measurable).map((i) => sizeFor(i, family)).filter((v): v is number => v !== null);
    const size = ss.length ? med(ss) : med(ph.map((i) => boxes[i].h / 0.72));
    for (const i of ph) out[i] = { size: Math.max(4, Math.round(size * 2) / 2), family };
  }
  return out;
}

export async function scannedPageInput(a: ScanPageArgs): Promise<{ input: PageInput; report: ScanReport }> {
  const { frame } = a;
  const pdfToFrame = (b: { x: number; y: number; width: number; height: number }): Box => {
    const c = [frame.point(b.x, b.y), frame.point(b.x + b.width, b.y), frame.point(b.x, b.y + b.height), frame.point(b.x + b.width, b.y + b.height)];
    const x = Math.min(...c.map((p) => p.x));
    const y = Math.min(...c.map((p) => p.y));
    return { x, y, w: Math.max(...c.map((p) => p.x)) - x, h: Math.max(...c.map((p) => p.y)) - y };
  };
  const pxToFrame = (b: PxBox): Box => {
    const [ax, ay] = a.toPdf(b.x, b.y);
    const [bx, by] = a.toPdf(b.x + b.w, b.y + b.h);
    return pdfToFrame({ x: Math.min(ax, bx), y: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay) });
  };
  const pdfToPx = (b: { x: number; y: number; width: number; height: number }): PxBox => {
    const [ax, ay] = a.toPx(b.x, b.y);
    const [bx, by] = a.toPx(b.x + b.width, b.y + b.height);
    return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
  };
  const [ox, oy] = a.toPx(0, 0);
  const [ux, uy] = a.toPx(1, 0);
  const pxPerPt = Math.hypot(ux - ox, uy - oy) || 2;

  // ---- words: noise out, confidence and weight in
  const droppedNoise: string[] = [];
  // A symbol with no letter or digit in it is text only between words ("Cumulative GPA: 3.62 • Credits
  // earned: 44", "Smith & Sons") — flanked within ~2 em on both sides on its own line; a stroke of a table
  // or a speck beside a word is not. Line-drawing characters ("|", "_", "~") are never text on their own.
  const flanked = (w: OcrWordIn) => {
    const mid = w.pdfBox.y + w.pdfBox.height / 2;
    const em = Math.max(w.pdfBox.height, 6) * 1.4;
    const side = (dir: number) => a.words.some((o) => o !== w && alnum(o.text) > 0 && o.pdfBox.y < mid && o.pdfBox.y + o.pdfBox.height > mid && (dir < 0 ? w.pdfBox.x - (o.pdfBox.x + o.pdfBox.width) : o.pdfBox.x - (w.pdfBox.x + w.pdfBox.width)) >= -1 && (dir < 0 ? w.pdfBox.x - (o.pdfBox.x + o.pdfBox.width) : o.pdfBox.x - (w.pdfBox.x + w.pdfBox.width)) < em);
    return side(-1) && side(1);
  };
  // A lone "|" as tall as the capitals beside it that starts a line ("I confirm that…") or ends a run of
  // words ("General Chemistry I") is a capital "I", not a stroke.
  const asI = (w: OcrWordIn) => {
    if (!/^[|¦]$/.test(w.text.trim())) return false;
    const mid = w.pdfBox.y + w.pdfBox.height / 2;
    const em = w.pdfBox.height * 1.2;
    const right = a.words.find((o) => o !== w && /^\p{Ll}/u.test(o.text) && o.pdfBox.y < mid && o.pdfBox.y + o.pdfBox.height > mid && o.pdfBox.x - (w.pdfBox.x + w.pdfBox.width) >= 0 && o.pdfBox.x - (w.pdfBox.x + w.pdfBox.width) < em);
    const left = a.words.some((o) => o !== w && alnum(o.text) > 0 && o.pdfBox.y < mid && o.pdfBox.y + o.pdfBox.height > mid && w.pdfBox.x - (o.pdfBox.x + o.pdfBox.width) >= -1 && w.pdfBox.x - (o.pdfBox.x + o.pdfBox.width) < em * 2);
    if (Boolean(right) && !left && w.pdfBox.height >= 0.8 * right!.pdfBox.height) return true;
    // …or ends a run of words as a capital I ("General Chemistry I", "World War I").
    // (The recogniser's box for such an "I" may overlap the word before it and run a little taller.)
    const gapAfter = (o: OcrWordIn) => w.pdfBox.x - (o.pdfBox.x + o.pdfBox.width);
    const before = a.words.find((o) => o !== w && /\p{Lu}/u.test(o.text) && o.pdfBox.y < mid && o.pdfBox.y + o.pdfBox.height > mid && gapAfter(o) >= -w.pdfBox.width && gapAfter(o) < em);
    const after = a.words.some((o) => o !== w && o !== before && o.pdfBox.y < mid && o.pdfBox.y + o.pdfBox.height > mid && o.pdfBox.x > w.pdfBox.x && o.pdfBox.x - (w.pdfBox.x + w.pdfBox.width) < em);
    return Boolean(before) && !after && Math.abs(w.pdfBox.height - before!.pdfBox.height) <= 0.35 * before!.pdfBox.height;
  };
  for (const w of a.words) if (asI(w)) w.text = "I";
  const kept = a.words.filter((w) => {
    if (!w.text.trim()) return false;
    if (isNoise(w) || (alnum(w.text) === 0 && (/^[|¦_~`'.,:;]+$/.test(w.text.trim()) || w.confidence < SCAN_THRESHOLDS.symbolConfidence) && !flanked(w))) {
      droppedNoise.push(w.text);
      return false;
    }
    return true;
  });
  const lum = luminance(a.raster);
  // The text's own ink, for measuring it: rules and check boxes painted out (a grid line inside a word's box
  // would read as a heavy stroke).
  const textLum = lum.slice();
  {
    const W = a.raster.width;
    const paint = (x0: number, y0: number, x1: number, y1: number) => {
      for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(a.raster.height - 1, Math.ceil(y1)); y++) textLum.fill(a.analysis.background, y * W + Math.max(0, Math.floor(x0)), y * W + Math.min(W, Math.ceil(x1) + 1));
    };
    for (const q of a.analysis.rules) {
      const pad = q.thickness / 2 + 2;
      if (q.y0 === q.y1) paint(q.x0, q.y0 - pad, q.x1, q.y0 + pad);
      else paint(q.x0 - pad, q.y0, q.x0 + pad, q.y1);
    }
    for (const c of a.analysis.checkboxes) paint(c.ink.x, c.ink.y, c.ink.x + c.ink.w, c.ink.y + c.ink.h);
  }
  const threshold = inkThreshold(a.analysis.background);
  const lineBoxes = a.lines.map((l) => pdfToFrame(l.pdfBox));
  const boxes = kept.map((w) => pdfToFrame(w.pdfBox));
  // The line the recogniser read each word in; by position only when it doesn't say (line boxes can overlap
  // where a left block and a right block were read as one line).
  const lineOf = boxes.map((b, i) => kept[i].line ?? lineBoxes.findIndex((l) => b.y + b.h / 2 >= l.y && b.y + b.h / 2 <= l.y + l.h));
  // Bold: a phrase's stroke width relative to its type size, against the page's. A word's mean horizontal
  // ink run, less the scan's edge blur (~½ pt), divided by its size measured from its width (a box's height
  // depends on its letters: "are" has no ascenders): ~0.09 for regular text, 0.12+ for bold. Decided per
  // phrase (words side by side on a line), which evens out short words' noise; the page's reference is the
  // word-weighted median, which body text dominates.
  const texts = kept.map((w) => w.text);
  const plain = estimateType(texts, boxes, kept.map(() => false), lineOf);
  // Words on a dark band: their colour is the band's text colour; their stroke can't be measured (light ink).
  const barOf = kept.map((w) => {
    const b = pdfToPx(w.pdfBox);
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    return a.analysis.bars.find((q) => cx >= q.x && cx <= q.x + q.w && cy >= q.y && cy <= q.y + q.h);
  });
  const runs = kept.map((w, i) => (alnum(w.text) < 2 || barOf[i] ? null : strokeWeight(textLum, a.raster.width, pdfToPx(w.pdfBox), threshold)));
  const phrases = phrasesOf(boxes, lineOf, plain.map((t) => t.size));
  const phraseWeight = phrases.map((ph) => {
    const ws = ph.map((i) => (runs[i] === null ? null : Math.max(0, runs[i]! - 0.5 * pxPerPt) / (pxPerPt * plain[i].size))).filter((v): v is number => v !== null).sort((p, q) => p - q);
    return ws.length ? ws[Math.floor(ws.length / 2)] : null;
  });
  const pool = phrases.flatMap((ph, k) => (phraseWeight[k] === null ? [] : ph.map(() => phraseWeight[k]!))).sort((p, q) => p - q);
  const reference = pool.length >= 6 ? pool[Math.floor(pool.length / 2)] : null;
  const bolds = kept.map(() => false);
  if (reference !== null) phrases.forEach((ph, k) => {
    // (A phrase of one or two characters is a noisy measure: it needs a much clearer margin.)
    const chars = ph.reduce((n, i) => n + alnum(kept[i].text), 0);
    const need = chars >= 3 ? SCAN_THRESHOLDS.boldRatio : 1.6;
    if (phraseWeight[k] !== null && phraseWeight[k]! > reference * need) for (const i of ph) bolds[i] = true;
  });
  // Bold by geometry: a bold phrase measured with regular widths comes out too large, and its stroke may not
  // look heavier than small body text (a 13 pt bold heading against 10 pt body). Its x-height (cap height
  // for capitals-only text), measured from the ink, says which hypothesis is right: the size the bold widths
  // give must match the size the x-height gives, and the regular widths' must not.
  const median = (v: number[]) => [...v].sort((p, q) => p - q)[Math.floor(v.length / 2)];
  const asBold = estimateType(texts, boxes, kept.map(() => true), lineOf);
  // One phrase's band is a pixel or two off (6 % at body size), so the band is pooled over the phrases of one
  // family and width-size — a paragraph's lines, or a page's headings — and the class decided together.
  const classes = new Map<string, { phrases: number[][]; bands: number[]; caps: boolean }>();
  phrases.forEach((ph) => {
    if (ph.some((i) => bolds[i])) return;
    // (Measured on the phrase's lowercase words when it mixes in digits or capitals: "Autumn" of "Autumn 2024".)
    const lowerWords = ph.filter((i) => {
      const t = kept[i].text;
      const lo = (t.match(/\p{Ll}/gu) ?? []).length;
      return lo >= 2 && lo >= 0.6 * alnum(t);
    });
    const use = lowerWords.length && lowerWords.length < ph.length ? lowerWords : ph;
    const band = xBand(textLum, a.raster.width, threshold, use.map((i) => pdfToPx(kept[i].pdfBox)), use.map((i) => kept[i].text).join(" "));
    if (!band) return;
    const key = `${plain[ph[0]].family}|${Math.round(plain[ph[0]].size)}|${band.caps}`;
    if (!classes.has(key)) classes.set(key, { phrases: [], bands: [], caps: band.caps });
    classes.get(key)!.phrases.push(ph);
    classes.get(key)!.bands.push(band.px);
  });
  for (const c of classes.values()) {
    const ph0 = c.phrases[0];
    const fam = plain[ph0[0]].family;
    const px = c.bands.sort((p, q) => p - q)[Math.floor(c.bands.length / 2)];
    const ratio = (bold: boolean) => (c.caps ? HEIGHTS[metricsKey(fam, bold)].capHeight : HEIGHTS[metricsKey(fam, bold)].xHeight);
    // (Less half a pixel: anti-aliased edges reach over the ink threshold.)
    const fromBand = (bold: boolean) => (px - 0.5) / pxPerPt / ratio(bold);
    const errRegular = Math.abs(plain[ph0[0]].size - fromBand(false)) / fromBand(false);
    const boldSize = median(c.phrases.map((ph) => asBold[ph[0]].size));
    const errBold = Math.abs(boldSize - fromBand(true)) / fromBand(true);
    if (errBold < SCAN_THRESHOLDS.boldFit && errRegular > SCAN_THRESHOLDS.regularMisfit && errRegular - errBold > 0.07) for (const ph of c.phrases) for (const i of ph) bolds[i] = true;
  }
  const boldWords = bolds.filter(Boolean).length;
  const baselineAt = (line: number, x: number): number | null => {
    const bl = line >= 0 ? a.lines[line]?.baseline : undefined;
    if (!bl) return null;
    const p0 = frame.point(bl.x0, bl.y0);
    const p1 = frame.point(bl.x1, bl.y1);
    if (Math.abs(p1.x - p0.x) < 1) return null;
    return p0.y + ((x - p0.x) / (p1.x - p0.x)) * (p1.y - p0.y);
  };
  // Typography from the words' measured widths (see estimateType).
  const type = estimateType(kept.map((w) => w.text), boxes, bolds, lineOf);
  let items: TextItem[] = kept.map((w, i) => {
    const b = boxes[i];
    const { size, family } = type[i];
    // For now from its box: the bottom is the baseline, or the descenders' bottom when the word has any
    // (settled per row below).
    const y = b.y + (/[gjpqy,;()[\]{}|]/.test(w.text) ? 0.21 * size : 0);
    const color = barOf[i]?.text;
    return { str: w.text, x: b.x, y, w: b.w, size, bold: bolds[i], italic: false, ocr: true, conf: w.confidence, font: FONT_NAMES[family], ...(color ? { color } : {}) };
  });
  // Words read on one line share a baseline.
  const byLine = new Map<number, TextItem[]>();
  const lineTag = new Map<TextItem, number>();
  items.forEach((it, i) => {
    if (lineOf[i] < 0) return;
    lineTag.set(it, lineOf[i]);
    if (!byLine.has(lineOf[i])) byLine.set(lineOf[i], []);
    byLine.get(lineOf[i])!.push(it);
  });
  // A line as read can hold two blocks side by side (an address on the left, invoice details on the right)
  // on different baselines: each row — words less than ~3 em apart — gets its own. A row's baseline is the
  // recogniser's when that crosses most of its words; otherwise the median of the words' own estimates
  // (box bottoms are unreliable: a stray mark below a word stretches its box).
  for (const [line, group] of byLine) {
    group.sort((p, q) => p.x - q.x);
    const rows: TextItem[][] = [];
    for (const it of group) {
      const row = rows[rows.length - 1];
      const prev = row?.[row.length - 1];
      if (prev && it.x - (prev.x + prev.w) < 3 * Math.max(it.size, prev.size)) row.push(it);
      else rows.push([it]);
    }
    for (const row of rows) {
      const crossed = row.map((it) => {
        const v = baselineAt(line, it.x + it.w / 2);
        const box = boxes[items.indexOf(it)];
        // (A baseline lies near the bottom of a word's box — at most a descender's depth above it — not
        // anywhere across it: the line's baseline may belong to the other block read in the same line.)
        return v !== null && box && v >= box.y - 1 && v <= box.y + box.h * 0.35 ? v : null;
      });
      const hits = crossed.filter((v): v is number => v !== null);
      // (From words with letters or digits: an asterisk, a quote or a degree sign floats above the baseline.)
      const lettered = row.filter((it) => alnum(it.str) > 0);
      const base = hits.length * 2 > row.length ? median(hits) : median((lettered.length ? lettered : row).map((it) => it.y));
      for (const it of row) if (Math.abs(it.y - base) < it.size * 0.75) it.y = base;
    }
  }

  // ---- rules and shaded areas, in the reading frame
  const wordBoxes = kept.map((w) => pdfToFrame(w.pdfBox));
  const inside = (x: number, y: number, b: Box, pad = 1) => x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad;
  let rules: Rule[] = [];
  for (const q of a.analysis.rules) {
    const box = pxToFrame({ x: Math.min(q.x0, q.x1), y: Math.min(q.y0, q.y1), w: Math.abs(q.x1 - q.x0), h: Math.abs(q.y1 - q.y0) });
    const horizontal = box.w >= box.h;
    const rule: Rule = horizontal ? { x0: box.x, x1: box.x + box.w, y0: box.y + box.h / 2, y1: box.y + box.h / 2, thickness: q.weight / pxPerPt, color: q.color } : { x0: box.x + box.w / 2, x1: box.x + box.w / 2, y0: box.y, y1: box.y + box.h, thickness: q.weight / pxPerPt, color: q.color };
    // A short "line" inside a word is a letter's stroke, not a rule.
    const len = horizontal ? box.w : box.h;
    if (len < 60 && wordBoxes.some((b) => inside((rule.x0 + rule.x1) / 2, (rule.y0 + rule.y1) / 2, b))) continue;
    rules.push(rule);
  }
  let fills: Fill[] = a.analysis.fills.map((f) => {
    const b = pxToFrame(f);
    return { x: b.x, y: b.y, w: b.w, h: b.h, color: f.color };
  });

  // ---- hybrid: ruled regions OCR can't read are kept as pictures
  const images: PageImage[] = [];
  const groups = ruleGroups(rules);
  for (const g of groups) {
    const ws = items.filter((it) => inside(it.x + it.w / 2, it.y, g.box, 0));
    if (!ws.length || g.h < 2 || g.v < 2) continue;
    const conf = ws.reduce((n, it) => n + (it.conf ?? 100), 0) / ws.length;
    if (conf >= SCAN_THRESHOLDS.regionConfidence) continue;
    const pic = await a.encode(frameToPx(g.box), "image/png");
    if (!pic) continue;
    images.push({ ...pic, x: g.box.x, y: g.box.y, w: g.box.w, h: g.box.h });
    items = items.filter((it) => !ws.includes(it));
    rules = rules.filter((r) => !g.rules.includes(r));
    fills = fills.filter((f) => !inside(f.x + f.w / 2, f.y + f.h / 2, g.box, 0));
  }
  function frameToPx(b: Box): PxBox {
    // frame → pdf is the inverse of frame.point; pdf points of the frame box's corners are found by mapping
    // the page's own corners. For the upright pages OCR reads, the frame is the page shifted; invert generally:
    const corners = [
      [b.x, b.y],
      [b.x + b.w, b.y + b.h],
    ].map(([x, y]) => frameInverse(frame, x, y));
    return pdfToPx({ x: Math.min(corners[0].x, corners[1].x), y: Math.min(corners[0].y, corners[1].y), width: Math.abs(corners[1].x - corners[0].x), height: Math.abs(corners[1].y - corners[0].y) });
  }

  // ---- how much of the ink is explained (words, rules, kept pictures)
  // Only words read with confidence explain ink: a stamp or a signature read as "Ld", "AMA" is still a graphic.
  const confident = kept.filter((w) => w.confidence >= SCAN_THRESHOLDS.graphicWordConfidence);
  const explained = inkExplained(a.raster, lum, threshold, a.analysis.rules, confident.map((w) => pdfToPx(w.pdfBox)).concat(a.analysis.bars, a.analysis.checkboxes.map((c) => c.ink), images.map((im) => frameToPx({ x: im.x, y: im.y, w: im.w, h: im.h }))), pxPerPt);
  const textConfidence = kept.length ? kept.reduce((n, w) => n + w.confidence, 0) / kept.length : 0;

  // ---- graphics (stamps, signatures, logos): ink nothing else explains, kept as pictures
  for (const found of explained.unexplained) {
    // Lines touching the graphic (a chart's axes, a logo's underline) are part of it: the picture takes
    // them in rather than leaving them as separate rules beside it. Only lines no longer than ~1.5× the
    // graphic, so a page-wide rule it touches stays a rule.
    const region = { ...found };
    const reach = 6 * pxPerPt;
    for (const q of a.analysis.rules) {
      const qx0 = Math.min(q.x0, q.x1);
      const qx1 = Math.max(q.x0, q.x1);
      const qy0 = Math.min(q.y0, q.y1);
      const qy1 = Math.max(q.y0, q.y1);
      const near = qx1 >= region.x - reach && qx0 <= region.x + region.w + reach && qy1 >= region.y - reach && qy0 <= region.y + region.h + reach;
      if (!near || qx1 - qx0 > 1.5 * found.w || qy1 - qy0 > 1.5 * found.h + reach) continue;
      const x0 = Math.min(region.x, qx0 - 2);
      const y0 = Math.min(region.y, qy0 - 2);
      region.w = Math.max(region.x + region.w, qx1 + 2) - x0;
      region.h = Math.max(region.y + region.h, qy1 + 2) - y0;
      region.x = x0;
      region.y = y0;
    }
    const pic = await a.encode(region, "image/png");
    if (!pic) continue;
    const b = pxToFrame(region);
    images.push({ ...pic, x: b.x, y: b.y, w: b.w, h: b.h });
    // What OCR made of the graphic is not text; the picture shows it.
    const overlaps = (it: TextItem) => it.x < b.x + b.w && it.x + it.w > b.x && it.y - it.size * 0.25 < b.y + b.h && it.y + it.size * 0.75 > b.y;
    rules = rules.filter((r) => !inside((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, b, 0));
    items = items.filter((it) => !(inside(it.x + it.w / 2, it.y + it.size * 0.3, b, 0) || ((it.conf ?? 100) < SCAN_THRESHOLDS.graphicWordConfidence && overlaps(it))) || (it.conf ?? 100) >= SCAN_THRESHOLDS.graphicWordConfidence + 15);
  }
  const inkShare = explained.total ? (explained.covered + explained.unexplained.reduce((n, r) => n + r.ink, 0)) / explained.total : 1;

  let strategy: Strategy = images.length ? "hybrid" : "structured-scan";
  let background: PageImage | undefined;
  if (textConfidence < SCAN_THRESHOLDS.pageConfidence || (explained.total > 0 && explained.covered / explained.total < SCAN_THRESHOLDS.pageInkExplained && kept.length < 8)) {
    // Not reliably readable: keep the page as it looks; the recognised text stays, invisible, for search.
    const full = await a.encode({ x: 0, y: 0, w: a.raster.width, h: a.raster.height }, "image/jpeg");
    if (full) {
      background = { ...full, x: 0, y: 0, w: frame.width, h: frame.height };
      strategy = "visual-fallback";
      rules = [];
      fills = [];
      images.length = 0;
    }
  }

  // Neighbouring words of one style on a line are one run of text, as a native PDF gives it ("word word
  // word", not three items). Layout then sees a justified line as one stretch of text, not as words whose
  // gaps happen to line up into a column gutter. Parts set apart (a label and its value) stay separate.
  const merged: TextItem[] = [];
  const lineGroups = new Map<number, TextItem[]>();
  for (const it of items) {
    const k = lineTag.get(it);
    if (k === undefined) continue;
    if (!lineGroups.has(k)) lineGroups.set(k, []);
    lineGroups.get(k)!.push(it);
  }
  for (const group of lineGroups.values()) {
    group.sort((p, q) => p.x - q.x);
    let cur: TextItem | null = null;
    for (const it of group) {
      const gap = cur ? it.x - (cur.x + cur.w) : Infinity;
      if (cur && gap >= -1 && gap < 0.75 * Math.max(cur.size, it.size) && cur.size === it.size && cur.bold === it.bold && cur.font === it.font && cur.color === it.color && Math.abs(cur.y - it.y) < 0.5) {
        cur.str += ` ${it.str}`;
        cur.w = it.x + it.w - cur.x;
        cur.conf = Math.min(cur.conf ?? 100, it.conf ?? 100);
      } else {
        if (cur) merged.push(cur);
        cur = { ...it };
      }
    }
    if (cur) merged.push(cur);
  }
  items = [...merged, ...items.filter((it) => !lineTag.has(it))];

  // Check boxes: a ballot-box symbol on the line of the label beside it (its baseline, its size), checked
  // or not as drawn. What OCR made of a box ("[J", "Ml") is dropped.
  for (const cb of a.analysis.checkboxes) {
    const b = pxToFrame(cb);
    const ink = pxToFrame(cb.ink);
    items = items.filter((it) => !(it.x < ink.x + ink.w && it.x + it.w > ink.x && it.y < ink.y + ink.h && it.y + it.size * 0.6 > ink.y && /^[^\p{L}\p{N}]*[\p{L}\p{N}]?[^\p{L}\p{N}]*$/u.test(it.str)));
    const near = items
      .filter((it) => it.y > b.y - b.h && it.y < b.y + b.h && Math.abs(it.x - (b.x + b.w)) < 3 * b.h + (it.x < b.x ? Infinity : 0))
      .sort((p, q) => Math.abs(p.x - b.x) - Math.abs(q.x - b.x))[0];
    // The ballot box is ~0.78 em tall: at its label's size it matches a box drawn for that label.
    const size = near ? near.size : Math.max(6, Math.round((b.h / 0.78) * 2) / 2);
    items.push({ str: cb.checked ? "☑" : "☐", x: b.x, y: near ? near.y : b.y + 0.08 * size, w: b.w, size, bold: false, italic: false, ocr: true, conf: 100, font: "Segoe UI Symbol" });
  }

  const input: PageInput = { width: frame.width, height: frame.height, items, images, rules, fills, background, strategy };
  return {
    input,
    report: { strategy, textConfidence: Math.round(textConfidence), inkExplained: Math.round(inkShare * 100) / 100, rules: rules.length, fills: fills.length, boldWords, droppedNoise, pictures: images.length + (background ? 1 : 0) },
  };
}

/** frame.point is a rotation + shift; invert it numerically from two reference points. */
function frameInverse(frame: Frame, x: number, y: number): { x: number; y: number } {
  const o = frame.point(0, 0);
  const ex = frame.point(1, 0);
  const ey = frame.point(0, 1);
  const a = ex.x - o.x;
  const b = ey.x - o.x;
  const c = ex.y - o.y;
  const d = ey.y - o.y;
  const det = a * d - b * c || 1;
  const dx = x - o.x;
  const dy = y - o.y;
  return { x: (d * dx - b * dy) / det, y: (-c * dx + a * dy) / det };
}

/** Rules that touch form groups (a box, a table grid); horizontal/vertical counts and bounding box. */
function ruleGroups(rules: Rule[]): { rules: Rule[]; h: number; v: number; box: Box }[] {
  const parent = rules.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const touch = (p: Rule, q: Rule) => p.x0 - 3 <= q.x1 && q.x0 - 3 <= p.x1 && Math.min(p.y0, p.y1) - 3 <= Math.max(q.y0, q.y1) && Math.min(q.y0, q.y1) - 3 <= Math.max(p.y0, p.y1);
  for (let i = 0; i < rules.length; i++) for (let j = i + 1; j < rules.length; j++) if (touch(rules[i], rules[j])) parent[find(i)] = find(j);
  const by = new Map<number, Rule[]>();
  rules.forEach((r, i) => {
    const k = find(i);
    if (!by.has(k)) by.set(k, []);
    by.get(k)!.push(r);
  });
  return [...by.values()].map((rs) => {
    const x0 = Math.min(...rs.map((r) => r.x0));
    const x1 = Math.max(...rs.map((r) => r.x1));
    const y0 = Math.min(...rs.map((r) => Math.min(r.y0, r.y1)));
    const y1 = Math.max(...rs.map((r) => Math.max(r.y0, r.y1)));
    return { rules: rs, h: rs.filter((r) => Math.abs(r.y1 - r.y0) < 0.5).length, v: rs.filter((r) => Math.abs(r.x1 - r.x0) < 0.5).length, box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
  });
}

/**
 * Ink accounting on a coarse grid (4 px cells): ink cells inside word boxes or kept pictures are explained;
 * rule strokes don't count; connected clusters of unexplained ink at least ~24 × 12 pt are graphics
 * (stamps, signatures, logos) to keep as pictures. Smaller specks are scan noise.
 */
function inkExplained(r: Raster, lum: Uint8Array, threshold: number, pxRules: ScanAnalysis["rules"], covered: PxBox[], pxPerPt: number): { total: number; covered: number; unexplained: (PxBox & { ink: number })[] } {
  const C = 4;
  const cw = Math.ceil(r.width / C);
  const ch = Math.ceil(r.height / C);
  const ink = new Uint8Array(cw * ch);
  const isRule = new Uint8Array(cw * ch);
  for (const q of pxRules) {
    const pad = q.thickness + 3;
    for (let y = Math.floor((Math.min(q.y0, q.y1) - pad) / C); y <= (Math.max(q.y0, q.y1) + pad) / C; y++)
      for (let x = Math.floor((Math.min(q.x0, q.x1) - pad) / C); x <= (Math.max(q.x0, q.x1) + pad) / C; x++) if (x >= 0 && y >= 0 && x < cw && y < ch) isRule[y * cw + x] = 1;
  }
  for (let y = 0; y < r.height; y++)
    for (let x = 0; x < r.width; x++) if (lum[y * r.width + x] < threshold) ink[Math.floor(y / C) * cw + Math.floor(x / C)] = 1;
  const cov = new Uint8Array(cw * ch);
  for (const b of covered) {
    const pad = 2;
    for (let y = Math.floor(b.y / C) - pad; y <= (b.y + b.h) / C + pad; y++)
      for (let x = Math.floor(b.x / C) - pad; x <= (b.x + b.w) / C + pad; x++) if (x >= 0 && y >= 0 && x < cw && y < ch) cov[y * cw + x] = 1;
  }
  let total = 0;
  let coveredN = 0;
  const free = new Uint8Array(cw * ch);
  for (let i = 0; i < ink.length; i++) {
    if (!ink[i] || isRule[i]) continue;
    total++;
    if (cov[i]) coveredN++;
    else free[i] = 1;
  }
  // Connected clusters (8-neighbourhood, bridging 1-cell gaps).
  const seen = new Uint8Array(cw * ch);
  const out: (PxBox & { ink: number })[] = [];
  const minW = (24 * pxPerPt) / C;
  const minH = (12 * pxPerPt) / C;
  for (let i = 0; i < free.length; i++) {
    if (!free[i] || seen[i]) continue;
    const stack = [i];
    seen[i] = 1;
    let x0 = cw;
    let y0 = ch;
    let x1 = 0;
    let y1 = 0;
    let n = 0;
    while (stack.length) {
      const k = stack.pop()!;
      const x = k % cw;
      const y = (k - x) / cw;
      n++;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
          const m = ny * cw + nx;
          if (free[m] && !seen[m]) {
            seen[m] = 1;
            stack.push(m);
          }
        }
    }
    if (x1 - x0 + 1 >= minW && y1 - y0 + 1 >= minH && n >= 12) out.push({ x: x0 * C, y: y0 * C, w: (x1 - x0 + 1) * C, h: (y1 - y0 + 1) * C, ink: n });
  }
  return { total, covered: coveredN, unexplained: out };
}
