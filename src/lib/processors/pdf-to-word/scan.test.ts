import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { analyzeScan, checkBoxes, detectRules, backgroundLevel, invertBars, luminance, solidBars, type PxBox, type Raster } from "./scan";
import { scannedPageInput, type OcrWordIn } from "./scanPage";
import { documentStats, findHeadersFooters, layoutPage, type Block } from "./layout";
import { buildDocx, verifyDocx } from "./docx";

/**
 * A synthetic scanned form, built like the structure of a real scanned record: a title over a full-width
 * rule, a label with an underlined value, a sentence over a rule, a boxed "valid from / until" row, label /
 * value rows, a 4 × 3 ruled table, OCR noise. Pixels are drawn at 2 px/pt on an off-white, slightly grey
 * scan background with blurred (two-tone) grey lines — as a scanner produces them.
 */
const W = 612;
const H = 792;
const K = 2;
const BG = 244;

function blank(): Raster {
  const data = new Uint8ClampedArray(W * K * H * K * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = BG;
    data[i + 1] = BG;
    data[i + 2] = BG - 3;
    data[i + 3] = 255;
  }
  return { width: W * K, height: H * K, data };
}
function px(r: Raster, x: number, y: number, v: number) {
  if (x < 0 || y < 0 || x >= r.width || y >= r.height) return;
  const p = (y * r.width + x) * 4;
  r.data[p] = v;
  r.data[p + 1] = v;
  r.data[p + 2] = v;
}
/** A 1 pt grey line, blurred: one dark row and one lighter row (top-down page coordinates, in pt). */
function hline(r: Raster, x0: number, x1: number, top: number) {
  for (let x = x0 * K; x < x1 * K; x++) {
    px(r, x, top * K, 181);
    px(r, x, top * K + 1, 150);
  }
}
function vline(r: Raster, y0: number, y1: number, left: number) {
  for (let y = y0 * K; y < y1 * K; y++) {
    px(r, left * K, y, 181);
    px(r, left * K + 1, y, 150);
  }
}
/** Ink for a word: vertical strokes of cap height, like letters (never a long horizontal run). */
function inkWord(r: Raster, b: { x: number; top: number; w: number; h: number }) {
  const top = b.top + b.h * 0.28;
  for (let x = Math.round(b.x * K); x < (b.x + b.w) * K; x += 3) for (let y = Math.round(top * K); y < (b.top + b.h) * K; y++) px(r, x, y, 40);
}

type W0 = { text: string; x: number; top: number; h: number; conf?: number };
const word = (text: string, x: number, top: number, h = 10, conf = 92): W0 => ({ text, x, top, h, conf });
/** Width a word of this text takes at this height (about 0.5 em per character). */
const widthOf = (w: W0) => w.text.length * (w.h / 0.72) * 0.5;

function form(opts: { tableConf?: number; allConf?: number } = {}) {
  const r = blank();
  const words: W0[] = [
    word("OFFICIAL", 44, 40, 14),
    word("RECORD", 125, 40, 14),
    word("COPY", 192, 40, 14),
    word("Name:", 44, 110, 9),
    word("Jane", 125, 106, 12),
    word("Doe", 165, 106, 12),
    word("This", 44, 150, 11),
    word("certifies", 80, 150, 11),
    word("the", 150, 150, 11),
    word("requirements", 182, 150, 11),
    word("VALID", 44, 212, 10),
    word("FROM", 86, 212, 10),
    word("01/01/2026", 150, 212, 11),
    word("UNTIL", 258, 212, 11),
    word("12/31/2026", 362, 212, 11),
    word("Account", 44, 270, 10),
    word("Number:", 96, 270, 10),
    word("4738", 173, 270, 11),
    word("0192", 208, 270, 11),
    word("Invoice", 44, 300, 10),
    word("Total:", 92, 300, 10),
    word("$182.50", 173, 300, 11),
    // Table: lines at 360 / 386 / 412 / 438 / 464; columns 43 / 204 / 362 / 555.
    ...[
      ["Item", "Status", "Value"],
      ["Tuition", "PAID", "$4,250.00"],
      ["Graduation", "DUE", "$95.00"],
      ["Record", "ACTIVE", "A-78421"],
    ].flatMap((row, i) => row.map((t, j) => word(t, [50, 211, 369][j], 368 + i * 26, 9, opts.tableConf ?? 92))),
  ].map((w) => (opts.allConf !== undefined ? { ...w, conf: opts.allConf } : w));
  for (const w of words) inkWord(r, { x: w.x, top: w.top, w: widthOf(w), h: w.h });
  // OCR noise from scan speckle: low-confidence symbol fragments.
  const noise: W0[] = [word("~|", 500, 600, 8, 20), word("=e", 520, 620, 8, 33)];
  hline(r, 36, 576, 62); // title rule
  hline(r, 120, 400, 122); // name underline
  hline(r, 36, 561, 166); // sentence rule
  hline(r, 36, 561, 202); // date box
  hline(r, 36, 561, 232);
  vline(r, 202, 233, 36);
  vline(r, 202, 233, 560);
  for (const y of [360, 386, 412, 438, 464]) hline(r, 43, 556, y);
  for (const x of [43, 204, 362, 555]) vline(r, 360, 465, x);

  const all = [...words, ...noise];
  const ocrWords: OcrWordIn[] = all.map((w) => ({ text: w.text, confidence: w.conf ?? 92, pdfBox: { x: w.x, y: H - (w.top + w.h), width: widthOf(w), height: w.h } }));
  // OCR lines: words whose middles share a band.
  const lines: { text: string; pdfBox: { x: number; y: number; width: number; height: number } }[] = [];
  for (const w of all) {
    const mid = w.top + w.h / 2;
    const l = lines.find((q) => Math.abs(H - (q.pdfBox.y + q.pdfBox.height / 2) - mid) < 5);
    const box = { x: w.x, y: H - (w.top + w.h), width: widthOf(w), height: w.h };
    if (!l) lines.push({ text: w.text, pdfBox: box });
    else {
      const x0 = Math.min(l.pdfBox.x, box.x);
      const y0 = Math.min(l.pdfBox.y, box.y);
      const x1 = Math.max(l.pdfBox.x + l.pdfBox.width, box.x + box.width);
      const y1 = Math.max(l.pdfBox.y + l.pdfBox.height, box.y + box.height);
      l.text += ` ${w.text}`;
      l.pdfBox = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    }
  }
  return { r, ocrWords, lines };
}

async function convert(opts: Parameters<typeof form>[0] = {}) {
  const { r, ocrWords, lines } = form(opts);
  const original = { width: r.width, height: r.height, data: new Uint8ClampedArray(r.data) };
  const analysis = analyzeScan(r, K);
  const encoded: PxBox[] = [];
  const { input, report } = await scannedPageInput({
    words: ocrWords,
    lines,
    analysis,
    raster: original,
    toPdf: (x, y) => [x / K, H - y / K],
    toPx: (x, y) => [x * K, (H - y) * K],
    frame: { width: W, height: H, point: (x, y) => ({ x, y }) },
    encode: async (box, mime) => {
      encoded.push(box);
      return { x: 0, y: 0, w: 1, h: 1, bytes: new Uint8Array([1]), mime, pxWidth: box.w, pxHeight: box.h };
    },
  });
  const layout = layoutPage(input, documentStats([input]), { next: 1 }, findHeadersFooters([input])[0]);
  const bytes = await buildDocx([layout], { title: "scan", bodySize: 11, bodyFont: "" });
  const xml = await (await JSZip.loadAsync(bytes)).file("word/document.xml")!.async("string");
  return { analysis, input, report, layout, bytes, xml, encoded };
}

const textOf = (b: Block): string =>
  b.kind === "paragraph" || b.kind === "list" ? b.runs.map((r) => r.text).join("") : b.kind === "table" ? b.rows.map((row) => row.cells.map((c) => c.paragraphs.map((p) => p.runs.map((r) => r.text).join("")).join(" ")).join(" | ")).join(" / ") : "";
const tables = (blocks: Block[]) => blocks.filter((b): b is Extract<Block, { kind: "table" }> => b.kind === "table");

describe("scan pixel analysis", () => {
  it("finds rules in a scan and ignores text strokes", () => {
    const { r } = form();
    const { rules } = analyzeScan(r, K);
    const h = rules.filter((q) => q.y0 === q.y1);
    const v = rules.filter((q) => q.x0 === q.x1);
    expect(h).toHaveLength(10);
    expect(v).toHaveLength(6);
  });

  it("rebuilds a blurred grey 1 pt line at its weight and darkness, not as a pale hairline", () => {
    const { r } = form();
    const lum = luminance(r);
    const [q] = detectRules(r, lum, backgroundLevel(lum), { minH: 72, minV: 28, maxThick: 7 });
    // A 2 px blurred stroke; its ink is worth ~1.7 px of its darkest tone, so it comes back as ~1 pt.
    expect(q.thickness).toBeLessThanOrEqual(2);
    expect(q.weight / K).toBeGreaterThanOrEqual(0.75);
    expect(parseInt(q.color.slice(0, 2), 16)).toBeLessThanOrEqual(155);
  });
});

describe("scanned form → Word structure", () => {
  it("keeps the title above its rule, and the rule as a real line", async () => {
    const { layout } = await convert();
    const first = layout.blocks[0];
    expect(textOf(first)).toBe("OFFICIAL RECORD COPY");
    const titleRule = first.kind === "paragraph" ? first.fmt.borderBottom : undefined;
    const ruleBlock = layout.blocks[1]?.kind === "rule";
    expect(Boolean(titleRule) || ruleBlock).toBe(true);
  });

  it("aligns a label and its value on one line, with the value's underline", async () => {
    const { layout } = await convert();
    const name = layout.blocks.find((b) => textOf(b).startsWith("Name:"));
    expect(name?.kind).toBe("paragraph");
    if (name?.kind !== "paragraph") return;
    expect(textOf(name)).toMatch(/^Name:\t+Jane Doe$/);
    // A tab stop where the value starts (125 pt from the page edge).
    expect(name.fmt.tabs.some((t) => Math.abs(t.pos + layout.margins.left - 125) < 3)).toBe(true);
    // The underline stays a line: as the paragraph's bottom border or a rule right after it.
    const next = layout.blocks[layout.blocks.indexOf(name) + 1];
    expect(Boolean(name.fmt.borderBottom) || next?.kind === "rule").toBe(true);
  });

  it("keeps a separating rule under a sentence (not lost)", async () => {
    const { layout } = await convert();
    const i = layout.blocks.findIndex((b) => textOf(b).startsWith("This certifies"));
    const b = layout.blocks[i];
    expect(i).toBeGreaterThanOrEqual(0);
    const bordered = b.kind === "paragraph" && Boolean(b.fmt.borderBottom);
    expect(bordered || layout.blocks[i + 1]?.kind === "rule").toBe(true);
  });

  it("keeps the boxed date row as one row inside its border", async () => {
    const { layout } = await convert();
    const box = tables(layout.blocks).find((t) => textOf(t).includes("VALID"));
    expect(box).toBeDefined();
    expect(box!.rows).toHaveLength(1);
    expect(box!.bordered).toBe(true);
    // All four parts on one line, separated by tabs at their own positions.
    const paras = box!.rows[0].cells.flatMap((c) => c.paragraphs);
    const text = paras.map((p) => p.runs.map((r) => r.text).join("")).join("\n");
    expect(text).toMatch(/^VALID FROM\t+01\/01\/2026\t+UNTIL\t+12\/31\/2026$/);
  });

  it("rebuilds the ruled table as a real 4 × 3 Word table with its borders", async () => {
    const { layout, xml } = await convert();
    const t = tables(layout.blocks).find((b) => textOf(b).includes("Tuition"));
    expect(t).toBeDefined();
    expect(t!.rows).toHaveLength(4);
    expect(t!.columns).toHaveLength(3);
    expect(t!.bordered).toBe(true);
    expect(t!.border!.thickness).toBeGreaterThanOrEqual(0.75);
    expect(t!.rows.map((row) => row.cells.map((c) => c.paragraphs.map((p) => p.runs.map((r) => r.text).join("")).join(""))).slice(1)).toEqual([
      ["Tuition", "PAID", "$4,250.00"],
      ["Graduation", "DUE", "$95.00"],
      ["Record", "ACTIVE", "A-78421"],
    ]);
    expect(xml).toMatch(/<w:insideV w:val="single"/);
  });

  it("keeps label / value rows aligned on a shared column", async () => {
    const { layout } = await convert();
    // Either a two-column borderless table, or paragraphs whose values sit at the same tab stop.
    const t = tables(layout.blocks).find((b) => textOf(b).includes("Account"));
    if (t) {
      expect(t.bordered).toBe(false);
      expect(t.rows.map((row) => row.cells.map((c) => c.paragraphs.map((p) => p.runs.map((r) => r.text).join("")).join("")))).toEqual([
        ["Account Number:", "4738 0192"],
        ["Invoice Total:", "$182.50"],
      ]);
      return;
    }
    const rows = ["Account", "Invoice"].map((s) => layout.blocks.find((b) => textOf(b).startsWith(s)));
    expect(rows.map((b) => textOf(b!))).toEqual(["Account Number:	4738 0192", "Invoice Total:	$182.50"]);
    const stops = rows.map((b) => (b!.kind === "paragraph" ? b!.fmt.tabs[0]?.pos : undefined));
    expect(stops[0]).toBeDefined();
    expect(stops[0]).toBeCloseTo(stops[1]!, 0);
  });

  it("drops OCR noise instead of writing fragments", async () => {
    const { report, xml } = await convert();
    expect(report.droppedNoise).toEqual(["~|", "=e"]);
    expect(xml).not.toContain("~|");
    expect(xml).not.toContain("=e<");
  });

  it("reads the order top to bottom and passes the file check", async () => {
    const { layout, bytes, report } = await convert();
    const order = ["OFFICIAL", "Name:", "This certifies", "VALID", "Account", "Item"].map((s) => layout.blocks.findIndex((b) => textOf(b).includes(s)));
    expect(order.every((v) => v >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(report.strategy).toBe("structured-scan");
    expect(await verifyDocx(bytes)).toEqual([]);
  });
});

describe("scanned page fallbacks", () => {
  it("keeps a table OCR can't read as a picture of that region (hybrid)", async () => {
    const { report, input, encoded, layout } = await convert({ tableConf: 50 });
    expect(report.strategy).toBe("hybrid");
    expect(input.items.some((it) => it.str === "Tuition")).toBe(false);
    // The picture covers the table's lines (43–556 × 360–465 pt).
    const pic = encoded.find((b) => b.w > 500 * K * 0.9);
    expect(pic).toBeDefined();
    expect(pic!.y / K).toBeCloseTo(360, -1);
    expect(tables(layout.blocks).some((t) => textOf(t).includes("Tuition"))).toBe(false);
  });

  it("keeps an unreadable page as its image, with the text invisible over it (visual fallback)", async () => {
    const { report, layout, xml } = await convert({ allConf: 40 });
    expect(report.strategy).toBe("visual-fallback");
    expect(layout.floating.some((f) => f.behind && f.width === W && f.height === H)).toBe(true);
    expect(layout.transparentText).toBe(true);
    expect(xml).toContain('behindDoc="1"');
    expect(xml).toContain("<w14:textFill>");
    // Lines aren't drawn twice over the image.
    expect(layout.blocks.some((b) => b.kind === "rule")).toBe(false);
  });
});

describe("scan pixel analysis — bands, tints, faint lines", () => {
  /** A table whose header row is a solid blue band with white text, and whose last row is tinted. */
  function bandedTable(): Raster {
    const r = blank();
    const fill = (x0: number, y0: number, x1: number, y1: number, c: [number, number, number]) => {
      for (let y = y0 * K; y < y1 * K; y++)
        for (let x = x0 * K; x < x1 * K; x++) {
          const p = (y * r.width + x) * 4;
          [r.data[p], r.data[p + 1], r.data[p + 2]] = c;
        }
    };
    fill(57, 140, 555, 160, [79, 129, 189]); // header band
    for (const x of [70, 200, 330]) for (let k = 0; k < 8; k++) fill(x + k * 6, 146, x + k * 6 + 2, 154, [250, 250, 250]); // white "letters"
    fill(57, 240, 555, 260, [212, 216, 225]); // tinted total row
    for (const y of [160, 180, 200, 220, 240, 260]) hline(r, 57, 555, y);
    for (const x of [57, 186, 330, 555]) vline(r, 140, 261, x);
    return r;
  }

  it("finds a solid band with light text, and makes its text dark on paper for OCR", () => {
    const r = bandedTable();
    const lum = luminance(r);
    const bars = solidBars(r, lum, backgroundLevel(lum), 60 * K, 8 * K);
    expect(bars).toHaveLength(1);
    expect(bars[0].y / K).toBeCloseTo(140, -1);
    expect(bars[0].w / K).toBeGreaterThan(480);
    expect(parseInt(bars[0].text.slice(0, 2), 16)).toBeGreaterThan(220);
    invertBars(r, bars, [BG, BG, BG - 3]);
    const at = (x: number, y: number) => r.data[(y * K * r.width + x * K) * 4];
    expect(at(150, 150)).toBeGreaterThan(200); // the band is paper now
    expect(at(70, 150)).toBeLessThan(80); // its letters are dark
  });

  it("keeps the lines of a table whose rows are tinted or banded", () => {
    const { rules, fills, bars } = analyzeScan(bandedTable(), K);
    const hs = rules.filter((q) => q.y0 === q.y1).map((q) => Math.round(q.y0 / K));
    // Every row line, including the two around the tinted row, and the band's edge as the grid's top.
    for (const y of [140, 160, 180, 200, 220, 240, 260]) expect(hs.some((v) => Math.abs(v - y) <= 1)).toBe(true);
    expect(rules.filter((q) => q.x0 === q.x1)).toHaveLength(4);
    expect(bars).toHaveLength(1);
    expect(fills.some((f) => Math.abs(f.y / K - 240) <= 2)).toBe(true);
  });

  it("finds a faint grey grid line along its whole length", () => {
    const r = blank();
    for (let x = 57 * K; x < 555 * K; x++) px(r, x, 300 * K, 205 + ((x * 7) % 9)); // ~209 with noise
    for (let x = 57 * K; x < 555 * K; x++) px(r, x, 300 * K + 1, 226);
    const hs = analyzeScan(r, K).rules.filter((q) => q.y0 === q.y1);
    expect(hs).toHaveLength(1);
    expect((hs[0].x1 - hs[0].x0) / K).toBeGreaterThan(490);
  });
});

describe("scanned text runs", () => {
  it("joins a justified line's words into one run, so aligned word gaps never read as a column gutter", async () => {
    const r = blank();
    // Eight justified lines whose word gaps (a normal space, ~4 pt) all fall at x ≈ 296.
    const words: OcrWordIn[] = [];
    const lines: { text: string; pdfBox: { x: number; y: number; width: number; height: number } }[] = [];
    for (let i = 0; i < 8; i++) {
      const top = 100 + i * 15;
      const left = word("Customer response times improved across", 72, top, 10);
      const right = word("all three support channels went live", 298, top, 10);
      const lw = 226;
      const rw = 236;
      inkWord(r, { x: left.x, top, w: lw, h: 10 });
      inkWord(r, { x: right.x, top, w: rw, h: 10 });
      const lineWords = [
        ...left.text.split(" ").map((t, k, a) => ({ t, x: 72 + (k * lw) / a.length, w: lw / a.length - 4 })),
        ...right.text.split(" ").map((t, k, a) => ({ t, x: 298 + (k * rw) / a.length, w: rw / a.length - 4 })),
      ];
      for (const lw2 of lineWords) words.push({ text: lw2.t, confidence: 95, pdfBox: { x: lw2.x, y: H - (top + 10), width: lw2.w, height: 10 }, line: i });
      lines.push({ text: `${left.text} ${right.text}`, pdfBox: { x: 72, y: H - (top + 10), width: 468, height: 10 } });
    }
    const { input } = await scannedPageInput({
      words,
      lines,
      analysis: analyzeScan(r, K),
      raster: r,
      toPdf: (x, y) => [x / K, H - y / K],
      toPx: (x, y) => [x * K, (H - y) * K],
      frame: { width: W, height: H, point: (x, y) => ({ x, y }) },
      encode: async () => null,
    });
    expect(input.items.filter((it) => Math.abs(it.y - input.items[0].y) < 1)).toHaveLength(1);
    const layout = layoutPage(input, documentStats([input]), { next: 1 }, findHeadersFooters([input])[0]);
    expect(layout.blocks.some((b) => b.kind === "columns")).toBe(false);
  });
});

describe("forms from pixels — check boxes and section bands", () => {
  /** A drawn check box `size` pt square at (x, top), 1 px border; checked with a tick inside. */
  function drawBox(r: Raster, x: number, top: number, size: number, checked: boolean) {
    for (let k = 0; k < size * K; k++) {
      px(r, x * K + k, top * K, 40);
      px(r, x * K + k, (top + size) * K, 40);
      px(r, x * K, top * K + k, 40);
      px(r, (x + size) * K, top * K + k, 40);
    }
    if (checked) for (let k = 0; k < size * K * 0.6; k++) for (let t = 0; t < 2; t++) px(r, x * K + 4 + k, (top + size) * K - 4 - Math.round(k * 0.9) + t, 40);
  }
  /** A round letter (an "O") of about the same size, drawn with a thick stroke. */
  function drawRing(r: Raster, cx: number, cy: number, rad: number) {
    for (let y = -rad * K; y <= rad * K; y++)
      for (let x = -rad * K; x <= rad * K; x++) {
        const d = Math.hypot(x, y) / K;
        if (d <= rad && d >= rad * 0.72) px(r, cx * K + x, cy * K + y, 40);
      }
  }

  it("finds drawn check boxes, checked or not, and not round letters beside them", () => {
    const r = blank();
    drawBox(r, 72, 100, 9, false);
    drawBox(r, 160, 100, 9, true);
    drawBox(r, 72, 130, 12, true);
    drawRing(r, 250, 105, 5);
    const lum = luminance(r);
    const boxes = checkBoxes(r, lum, backgroundLevel(lum), K).sort((a, b) => a.y - b.y || a.x - b.x);
    expect(boxes.map((b) => [Math.round(b.x / K), Math.round(b.y / K), b.checked])).toEqual([
      [72, 100, false],
      [160, 100, true],
      [72, 130, true],
    ]);
  });

  it("puts a check box on its label's line as a ballot-box symbol, and drops what OCR made of it", async () => {
    const r = blank();
    drawBox(r, 72, 96, 9, true);
    inkWord(r, { x: 88, top: 95, w: 40, h: 10 });
    drawBox(r, 140, 96, 9, false);
    inkWord(r, { x: 156, top: 95, w: 30, h: 10 });
    const words: OcrWordIn[] = [
      { text: "[J", confidence: 40, pdfBox: { x: 72, y: H - 106, width: 9, height: 10 } },
      { text: "Health", confidence: 95, pdfBox: { x: 88, y: H - 105, width: 40, height: 10 } },
      { text: "Other", confidence: 95, pdfBox: { x: 156, y: H - 105, width: 30, height: 10 } },
    ];
    const { input } = await scannedPageInput({
      words,
      lines: [{ text: "[J Health Other", pdfBox: { x: 72, y: H - 106, width: 114, height: 11 } }],
      analysis: analyzeScan(r, K),
      raster: r,
      toPdf: (x, y) => [x / K, H - y / K],
      toPx: (x, y) => [x * K, (H - y) * K],
      frame: { width: W, height: H, point: (x, y) => ({ x, y }) },
      encode: async () => null,
    });
    const strs = input.items.sort((a, b) => a.x - b.x).map((i) => i.str);
    expect(strs).toEqual(["☑", "Health", "☐", "Other"]);
    const tick = input.items.find((i) => i.str === "☑")!;
    expect(Math.abs(tick.y - input.items.find((i) => i.str === "Health")!.y)).toBeLessThan(0.5);
  });

  it("makes a section band a box of its own height, and a band over a stack of row lines that table's header", () => {
    const r = blank();
    const fill = (x0: number, y0: number, x1: number, y1: number) => {
      for (let y = y0 * K; y < y1 * K; y++)
        for (let x = x0 * K; x < x1 * K; x++) {
          const p = (y * r.width + x) * 4;
          [r.data[p], r.data[p + 1], r.data[p + 2]] = [120, 70, 160];
        }
    };
    fill(60, 100, 540, 120); // a section heading bar
    fill(60, 300, 540, 320); // a table's header band
    for (const y of [340, 360, 380]) hline(r, 60, 540, y);
    const { rules, bars } = analyzeScan(r, K);
    expect(bars).toHaveLength(2);
    const v = (y0: number, y1: number) => rules.filter((q) => q.x0 === q.x1 && q.y0 / K >= y0 - 2 && q.y1 / K <= y1 + 2);
    const h = (y: number) => rules.filter((q) => q.y0 === q.y1 && Math.abs(q.y0 / K - y) <= 2);
    // The section bar: four edges.
    expect(v(100, 120)).toHaveLength(2);
    expect(h(100)).toHaveLength(1);
    expect(h(120)).toHaveLength(1);
    // The table header: its top and bottom edges join the rows; no sides.
    expect(v(300, 320)).toHaveLength(0);
    expect(h(300)).toHaveLength(1);
    expect(h(320)).toHaveLength(1);
  });
});

describe("OCR clean-up on scanned pages", () => {
  const page = async (words: OcrWordIn[]) => {
    const r = blank();
    for (const w of words) inkWord(r, { x: w.pdfBox.x, top: H - w.pdfBox.y - w.pdfBox.height, w: w.pdfBox.width, h: w.pdfBox.height });
    return scannedPageInput({
      words,
      lines: [],
      analysis: analyzeScan(r, K),
      raster: r,
      toPdf: (x, y) => [x / K, H - y / K],
      toPx: (x, y) => [x * K, (H - y) * K],
      frame: { width: W, height: H, point: (x, y) => ({ x, y }) },
      encode: async () => null,
    });
  };
  const w = (text: string, x: number, width: number, confidence = 95, height = 10, y = 600): OcrWordIn => ({ text, confidence, pdfBox: { x, y, width, height } });

  it("keeps a symbol between words and drops a lone speck", async () => {
    const { input } = await page([w("GPA:", 300, 24), w("3.62", 328, 20), w("•", 354, 4, 60), w("Credits", 364, 34), w(":", 120, 3, 59, 6, 650)]);
    const strs = input.items.map((i) => i.str).join(" ");
    expect(strs).toContain("•");
    expect(strs).not.toMatch(/(^|\s):(\s|$)/);
  });

  it("reads a stroke after a word as a capital I (\"General Chemistry I\")", async () => {
    const { input } = await page([w("General", 100, 38), w("Chemistry", 142, 46), w("|", 186, 3, 90, 12, 599)]);
    expect(input.items.map((i) => i.str).join(" ")).toMatch(/Chemistry I$/);
  });
});
