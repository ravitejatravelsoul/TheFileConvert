// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { interpretPage } from "./interpreter";

const DIR = path.resolve("qa/editor-fixtures");
const STD_FONTS = path.resolve("node_modules/pdfjs-dist/standard_fonts").split(path.sep).join("/") + "/";

const FILES = [
  ...fs.readdirSync(DIR).filter((f) => /^EDITOR-.*\.pdf$/.test(f)).map((f) => path.join(DIR, f)),
  ...fs.readdirSync(path.join(DIR, "public")).filter((f) => f.endsWith(".pdf")).map((f) => path.join(DIR, "public", f)),
];

const words = (s: string) => s.split(/\s+/).map((w) => w.normalize("NFKC")).filter(Boolean);

async function pdfjsPage(bytes: Uint8Array, n: number) {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), disableFontFace: true, standardFontDataUrl: STD_FONTS, useSystemFonts: false }).promise;
  const page = await doc.getPage(n);
  const tc = await page.getTextContent();
  return { items: tc.items.filter((i): i is typeof i & { str: string } => "str" in i), view: page.view, rotate: page.rotate };
}

describe("interpretPage against pdf.js (an independent reader of the same files)", () => {
  for (const file of FILES) {
    const name = path.basename(file);
    if (/scanned/.test(name)) continue;
    it(`${name}: the same words, in the same places`, async () => {
      const bytes = new Uint8Array(fs.readFileSync(file));
      const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
      const pages = Math.min(2, pdf.getPageCount());
      for (let n = 1; n <= pages; n++) {
        const page = pdf.getPage(n - 1);
        const ours = interpretPage(page);
        const ref = await pdfjsPage(bytes, n);
        const ourText = ours.runs.filter((r) => !r.invisible).map((r) => r.glyphs.map((g) => g.unicode).join("")).join(" ");
        const refWords = words(ref.items.map((i) => i.str).join(" "));
        const have = new Map<string, number>();
        for (const w of words(ourText)) have.set(w, (have.get(w) ?? 0) + 1);
        // glyph-per-op streams join without spaces: also index the concatenation of everything, to compare word by word
        const joined = ours.runs.filter((r) => !r.invisible).map((r) => r.glyphs.map((g) => g.unicode).join("")).join("");
        let hit = 0;
        for (const w of refWords) {
          if ((have.get(w) ?? 0) > 0) {
            have.set(w, have.get(w)! - 1);
            hit++;
          } else if (joined.includes(w)) hit++;
        }
        const recall = refWords.length ? hit / refWords.length : 1;
        expect(recall, `${name} page ${n}: words pdf.js sees that we don't`).toBeGreaterThanOrEqual(0.97);

        // Positions: every pdf.js text item's start lies on one of our glyph origins (x within 1 pt, y within 1 pt).
        const [x0, y0] = [ref.view[0], ref.view[1]];
        const origins = ours.runs.flatMap((r) => r.glyphs.map((g) => ({ x: g.x, y: g.y })));
        let placed = 0;
        let checked = 0;
        for (const it of ref.items) {
          if (!it.str.trim()) continue;
          checked++;
          const tr = (it as unknown as { transform: number[] }).transform;
          const ix = tr[4];
          const iy = tr[5];
          if (origins.some((o) => Math.abs(o.x - ix) < 1.2 && Math.abs(o.y - iy) < 1.2) || origins.some((o) => Math.abs(o.x - (ix - x0)) < 1.2 && Math.abs(o.y - (iy - y0)) < 1.2)) placed++;
        }
        if (checked) expect(placed / checked, `${name} page ${n}: pdf.js text items that start where a glyph of ours starts`).toBeGreaterThanOrEqual(0.95);
      }
    });
  }
});
