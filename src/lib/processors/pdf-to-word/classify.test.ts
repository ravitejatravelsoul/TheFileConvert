import { describe, expect, it } from "vitest";
import { HYBRID_THRESHOLDS, classifyScanned, hybridDecision, nativeKind, photoRegions, pixelSignals, type HybridEvidence, type PageSignals, type PixelSignals } from "./classify";
import { analyzeScan, type Raster } from "./scan";

const sig = (o: Partial<PageSignals> = {}): PageSignals => ({ visibleChars: 0, invisibleChars: 0, imageCoverage: 0, largestImageCoverage: 0, imageDpi: 0, ...o });
const px = (o: Partial<PixelSignals> = {}): PixelSignals => ({ hRules: 0, vRules: 0, checkboxes: 0, bars: 0, fills: 0, frame: false, photoRegions: 0, photoCoverage: 0, ...o });

describe("nativeKind — text you can see, or only a picture", () => {
  it("a page with real text is native, and mixed when pictures cover much of it", () => {
    expect(nativeKind(sig({ visibleChars: 900 }))).toBe("native");
    expect(nativeKind(sig({ visibleChars: 400, imageCoverage: 0.5, largestImageCoverage: 0.4 }))).toBe("mixed");
  });

  it("a page that is one picture is scanned, whatever text layer it carries", () => {
    expect(nativeKind(sig({ largestImageCoverage: 0.98, imageCoverage: 0.98 }))).toBe("scanned");
    // A searchable scan: 1,200 characters, all invisible — the reader sees the picture.
    expect(nativeKind(sig({ visibleChars: 0, invisibleChars: 1200, largestImageCoverage: 0.99, imageCoverage: 0.99 }))).toBe("scanned");
  });

  it("a footer drawn over a scan doesn't make it a text page", () => {
    expect(nativeKind(sig({ visibleChars: 11, largestImageCoverage: 0.97, imageCoverage: 0.97 }))).toBe("scanned");
  });

  it("an empty page is blank, and a short text-only page is native", () => {
    expect(nativeKind(sig())).toBe("blank");
    expect(nativeKind(sig({ visibleChars: 8 }))).toBe("native");
  });
});

describe("classifyScanned — what is the picture of", () => {
  it("a photograph is an image page; a portrait on a document makes it an official document", () => {
    expect(classifyScanned(px({ photoCoverage: 0.7, photoRegions: 1 })).cls).toBe("IMAGE_PAGE");
    expect(classifyScanned(px({ photoCoverage: 0.04, photoRegions: 2, hRules: 9 })).cls).toBe("OFFICIAL_DOCUMENT");
  });

  it("a page border (certificate) is an official document", () => {
    expect(classifyScanned(px({ frame: true, hRules: 8, vRules: 4 })).cls).toBe("OFFICIAL_DOCUMENT");
  });

  it("check boxes make a form, even among many rules", () => {
    expect(classifyScanned(px({ checkboxes: 1, hRules: 19 })).cls).toBe("FORM");
  });

  it("a ruled grid or many row lines is a table", () => {
    expect(classifyScanned(px({ hRules: 12, vRules: 2 })).cls).toBe("SCANNED_TABLE");
    expect(classifyScanned(px({ hRules: 3, vRules: 3 })).cls).toBe("SCANNED_TABLE");
  });

  it("fields, bands or tinted cells make a form", () => {
    expect(classifyScanned(px({ hRules: 2, vRules: 1 })).cls).toBe("FORM");
    expect(classifyScanned(px({ bars: 1 })).cls).toBe("FORM");
  });

  it("a page with one letterhead rule or a signature line is plain scanned text", () => {
    expect(classifyScanned(px({ hRules: 1 })).cls).toBe("SCANNED_TEXT");
    expect(classifyScanned(px({ hRules: 2 })).cls).toBe("SCANNED_TEXT");
    expect(classifyScanned(px()).cls).toBe("SCANNED_TEXT");
  });
});

/** A white page with (optionally) a block of grainy mid-tone "photo", a column of text-like strokes and a frame. */
function page(opts: { photo?: [number, number, number, number]; text?: boolean; frame?: boolean; skew?: number } = {}): Raster {
  const W = 612 * 2;
  const H = 792 * 2;
  const data = new Uint8ClampedArray(W * H * 4).fill(244);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  const set = (x: number, y: number, v: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const p = (y * W + x) * 4;
    data[p] = data[p + 1] = data[p + 2] = v;
  };
  if (opts.photo) {
    const [x0, y0, w, h] = opts.photo;
    for (let y = y0 * 2; y < (y0 + h) * 2; y++) for (let x = x0 * 2; x < (x0 + w) * 2; x++) set(x, y, 150 + ((x * 7 + y * 13) % 40));
  }
  if (opts.text) for (let line = 0; line < 30; line++) for (let x = 144; x < 1000; x += 3) for (let y = 300 + line * 22; y < 312 + line * 22; y++) set(x, y, 40);
  if (opts.frame) {
    const t = opts.skew ?? 0;
    for (let x = 48; x < W - 48; x++) {
      const dy = Math.round((x - W / 2) * t);
      set(x, 48 + dy, 90);
      set(x, 49 + dy, 90);
      set(x, H - 48 + dy, 90);
      set(x, H - 47 + dy, 90);
    }
    for (let y = 48; y < H - 48; y++) {
      const dx = Math.round((y - H / 2) * t);
      set(48 + dx, y, 90);
      set(49 + dx, y, 90);
      set(W - 48 + dx, y, 90);
      set(W - 47 + dx, y, 90);
    }
  }
  return { data, width: W, height: H };
}

describe("photoRegions / pixelSignals", () => {
  it("finds a portrait-sized block of continuous tone and ignores text", () => {
    const r = page({ photo: [60, 100, 140, 170], text: true });
    const { regions, coverage } = photoRegions(r, 2, []);
    expect(regions).toHaveLength(1);
    expect(coverage).toBeGreaterThan(0.04);
    expect(coverage).toBeLessThan(0.06);
    expect(photoRegions(page({ text: true }), 2, []).regions).toHaveLength(0);
  });

  it("does not take a flat tint (a shaded band) for a photograph", () => {
    const r = page();
    for (let y = 200; y < 260; y++) for (let x = 100; x < 1000; x++) r.data[(y * r.width + x) * 4] = r.data[(y * r.width + x) * 4 + 1] = r.data[(y * r.width + x) * 4 + 2] = 120;
    const analysis = analyzeScan(r, 2);
    expect(analysis.bars.length).toBeGreaterThan(0);
    expect(pixelSignals(analysis, r, 2).photoRegions).toBe(0);
  });

  it("sees a page border even when the scan is skewed and the lines are broken into pieces", () => {
    const r = page({ frame: true, skew: 0.004 });
    expect(pixelSignals(analyzeScan(r, 2), r, 2).frame).toBe(true);
    const plain = page({ text: true });
    expect(pixelSignals(analyzeScan(plain, 2), plain, 2).frame).toBe(false);
  });

  it("a plain page of text has no signals at all", () => {
    const r = page({ text: true });
    const s = pixelSignals(analyzeScan(r, 2), r, 2);
    expect(s).toMatchObject({ hRules: 0, vRules: 0, checkboxes: 0, bars: 0, photoRegions: 0, frame: false });
    expect(classifyScanned(s).cls).toBe("SCANNED_TEXT");
  });
});

const sure: HybridEvidence = { words: 210, textConfidence: 96, inkExplained: 0.99, droppedNoise: 1, pictures: 0, rules: 0, fills: 0, runningTextShare: 0.93 };

describe("hybridDecision — editable text from a scan only when extremely confident", () => {
  it("accepts a clean page of running text read with high confidence", () => {
    expect(hybridDecision(sure).ok).toBe(true);
    expect(hybridDecision({ ...sure, rules: HYBRID_THRESHOLDS.maxRules }).ok).toBe(true); // a letterhead line
  });

  it.each([
    ["too few words to judge", { words: 12 }],
    ["a middling read", { textConfidence: 84 }],
    ["ink that isn't text (a signature or stamp)", { inkExplained: 0.91 }],
    ["many noise fragments", { droppedNoise: 14 }],
    ["pictures on the page", { pictures: 1 }],
    ["rules beyond a letterhead", { rules: 5 }],
    ["shading", { fills: 1 }],
    ["labels and values rather than running text", { runningTextShare: 0.4 }],
  ])("refuses %s", (_what, change) => {
    const d = hybridDecision({ ...sure, ...change });
    expect(d.ok).toBe(false);
    expect(d.reason.length).toBeGreaterThan(5);
  });

  it("says every reason that applies", () => {
    const d = hybridDecision({ ...sure, textConfidence: 70, pictures: 2 });
    expect(d.reason).toMatch(/confidence/);
    expect(d.reason).toMatch(/pictures/);
  });
});
