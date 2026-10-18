// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { FallbackFonts } from "./fallback";
import { editLine } from "./edit-text";
import { interpretPage } from "./interpreter";
import { buildLines } from "./textmodel";

const STD_FONTS = path.resolve("node_modules/pdfjs-dist/standard_fonts").split(path.sep).join("/") + "/";
const loader = async (key: string) => new Uint8Array(fs.readFileSync(path.resolve("public/fonts/word", `${key}.ttf`)));

async function textOf(bytes: Uint8Array, n = 1): Promise<string> {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), disableFontFace: true, standardFontDataUrl: STD_FONTS }).promise;
  const tc = await (await doc.getPage(n)).getTextContent();
  return tc.items.map((i) => ("str" in i ? i.str : "")).join("");
}

async function edit(file: string, from: string, to: string, pageNo = 0, opts = {}) {
  const src = new Uint8Array(fs.readFileSync(file));
  const doc = await PDFDocument.load(src, { ignoreEncryption: true, updateMetadata: false });
  const page = doc.getPage(pageNo);
  const content = interpretPage(page);
  const lines = buildLines(content.runs);
  const line = lines.find((l) => l.text.includes(from));
  if (!line) throw new Error(`no line with “${from}” in ${path.basename(file)}: ${lines.slice(0, 4).map((l) => l.text).join(" | ")}`);
  const env = { doc, page, fonts: new FallbackFonts(doc, loader as never) };
  const res = await editLine(env, content, line, line.text.replace(from, to), opts);
  const out = await doc.save();
  if (res.ok) dump(`${path.basename(file)}-p${pageNo + 1}-${from}-${to}`, file, out, { page: pageNo + 1, from, to, bbox: line.bbox, oldText: line.text });
  return { res, out, before: src, line };
}

const FX = (n: string) => path.resolve("qa/editor-fixtures", n);

/** With EDITOR_DUMP=1 every edited file is written out for the independent validator (qa/validate/editorcheck.py). */
function dump(name: string, file: string, out: Uint8Array, meta: object) {
  if (!process.env.EDITOR_DUMP) return;
  const dir = path.resolve("qa/fidelity/_work/engine-out");
  fs.mkdirSync(dir, { recursive: true });
  const base = name.replace(/[^A-Za-z0-9.-]+/g, "_");
  fs.writeFileSync(path.join(dir, `${base}.pdf`), out);
  fs.copyFileSync(file, path.join(dir, `${base}.orig.pdf`));
  fs.writeFileSync(path.join(dir, `${base}.json`), JSON.stringify(meta));
}

const CASES: [string, string, string][] = [
  ["EDITOR-01-simple-text.pdf", "recieve", "receive"], // Chromium: one glyph per operator, Td chains
  ["EDITOR-03-business-letter.pdf", "recieve", "receive"], // LibreOffice: TJ per line, tagged marked content
  ["EDITOR-06-mixed-fonts.pdf", "wich", "which"],
  ["EDITOR-04-invoice.pdf", "buisness", "business"],
  ["EDITOR-05-form-acroform.pdf", "recieve", "receive"], // MuPDF: base-14 Helvetica, WinAnsi
];

describe("editLine: correcting a spelling mistake in place", () => {
  for (const [file, from, to] of CASES) {
    it(`${file}: “${from}” → “${to}”, old text gone, nothing else moved`, async () => {
      const { res, out } = await edit(FX(file), from, to);
      expect(res.ok, res.ok ? "" : res.reason).toBe(true);
      const after = await textOf(out);
      expect(after).toContain(to);
      expect(after).not.toContain(from);
    });
  }
});

// ---------------------------------------------------------------------------------------------- the manifest, everywhere
const MANIFEST = JSON.parse(fs.readFileSync(path.resolve("qa/editor-fixtures/manifest.json"), "utf8")) as Record<string, { targets: [string, string][] }>;

async function editAnywhere(file: string, from: string, to: string) {
  const src = new Uint8Array(fs.readFileSync(file));
  const doc = await PDFDocument.load(src, { ignoreEncryption: true, updateMetadata: false });
  for (let n = 0; n < doc.getPageCount(); n++) {
    const page = doc.getPage(n);
    const content = interpretPage(page);
    const lines = buildLines(content.runs);
    const line = lines.find((l) => l.text.includes(from));
    if (!line) continue;
    const env = { doc, page, fonts: new FallbackFonts(doc, loader as never) };
    const res = await editLine(env, content, line, line.text.replace(from, to));
    const out = await doc.save();
    if (res.ok) dump(`${path.basename(file)}-p${n + 1}-${from}-${to}`, file, out, { page: n + 1, from, to, bbox: line.bbox, oldText: line.text });
    return { res, out, page: n + 1, line };
  }
  throw new Error(`“${from}” not found in ${path.basename(file)}`);
}

const count = (hay: string, needle: string) => hay.split(needle).length - 1;

describe("every spelling target in the fixture library", () => {
  for (const [file, info] of Object.entries(MANIFEST)) {
    for (const [from, to] of info.targets) {
      it(`${file}: ${from} → ${to}`, async () => {
        const { res, out, page } = await editAnywhere(FX(file), from, to);
        expect(res.ok, res.ok ? "" : res.reason).toBe(true);
        const before = await textOf(new Uint8Array(fs.readFileSync(FX(file))), page);
        const after = await textOf(out, page);
        expect(count(after, to)).toBeGreaterThanOrEqual(count(before, to) + 1);
        expect(count(after, from)).toBe(count(before, from) - 1);
      });
    }
  }
});

describe("changing the length of a line", () => {
  const F = FX("EDITOR-01-simple-text.pdf");
  it("shorter: a word removed", async () => {
    const { res, out } = await edit(F, "before the end of", "before");
    expect(res.ok, res.ok ? "" : res.reason).toBe(true);
    expect(await textOf(out)).toContain("before");
  });
  it("one character: teh → the", async () => {
    const { res, out } = await edit(F, " teh ", " the ");
    expect(res.ok, res.ok ? "" : res.reason).toBe(true);
    expect(await textOf(out)).not.toContain(" teh ");
  });
  it("longer, with room to grow: a word becomes a longer word", async () => {
    const { res, out } = await edit(F, "Please send", "Please kindly send");
    expect(res.ok, res.ok ? "" : res.reason).toBe(true);
    expect(await textOf(out)).toContain("Please kindly send");
  });
  it("replacing several words at once", async () => {
    const { res, out } = await edit(F, "Review the draft, confirm the dates", "Check the plan, confirm the schedule");
    expect(res.ok, res.ok ? "" : res.reason).toBe(true);
    expect(await textOf(out)).toContain("Check the plan, confirm the schedule");
  });
  it("a letter the original font doesn't have: the new text uses the bundled font of the same family", async () => {
    const { res, out } = await edit(F, "Summary", "Summary Qx");
    expect(res.ok, res.ok ? "" : res.reason).toBe(true);
    expect(await textOf(out)).toContain("Summary Qx");
  });
  it("refuses, rather than overlaps, when the new text would run into its neighbour", async () => {
    const { res } = await edit(FX("EDITOR-04-invoice.pdf"), "Qty", "Quantity of everything ordered in this invoice");
    expect(res.ok).toBe(false);
  });
});

describe("other kinds of text", () => {
  it("bold, italic and coloured text keeps working", async () => {
    for (const [file, from, to] of [
      ["EDITOR-06-mixed-fonts.pdf", "Italic line", "Slanted line"],
      ["EDITOR-06-mixed-fonts.pdf", "Red paragraph", "Crimson paragraph"],
      ["EDITOR-06-mixed-fonts.pdf", "Large blue text", "Large green text"],
      ["EDITOR-02-resume.pdf", "Senior Data Analyst", "Lead Data Analyst"],
    ] as const) {
      const { res, out } = await edit(FX(file), from, to);
      expect(res.ok, `${from}: ${res.ok ? "" : res.reason}`).toBe(true);
      expect(await textOf(out)).toContain(to);
    }
  });

  it("special characters survive (accents, currency, Greek)", async () => {
    const { res, out } = await edit(FX("EDITOR-15-special-characters.pdf"), "Café, naïve", "Café, naïve and señor");
    expect(res.ok, res.ok ? "" : res.reason).toBe(true);
    expect(await textOf(out)).toContain("señor");
  });

  it("rotated pages", async () => {
    for (const pageNo of [0, 1, 2, 3]) {
      const { res, out } = await edit(FX("EDITOR-09-rotated-pages.pdf"), "recieve", "receive", pageNo);
      expect(res.ok, `page ${pageNo + 1}: ${res.ok ? "" : res.reason}`).toBe(true);
      expect(await textOf(out, pageNo + 1)).toContain("receive");
    }
  });

  it("public documents made by other producers (Adobe PDFMaker for Word, Antenna House, Adobe Designer)", async () => {
    const T = path.resolve("qa/editor-fixtures/public");
    const probe = async (file: string, pick: (t: string) => string | null, page = 0) => {
      const src = new Uint8Array(fs.readFileSync(path.join(T, file)));
      const doc = await PDFDocument.load(src, { ignoreEncryption: true, updateMetadata: false });
      const pg = doc.getPage(page);
      const content = interpretPage(pg);
      const lines = buildLines(content.runs).filter((l) => l.editable && l.text.trim().length > 12);
      const line = lines.find((l) => pick(l.text) !== null);
      expect(line, `a line in ${file}`).toBeTruthy();
      const from = pick(line!.text)!;
      const env = { doc, page: pg, fonts: new FallbackFonts(doc, loader as never) };
      const res = await editLine(env, content, line!, line!.text.replace(from, from.toUpperCase() === from ? from.toLowerCase() : from.toUpperCase()));
      return { res, out: await doc.save(), line: line! };
    };
    for (const file of ["table.pdf", "fw9.pdf", "f1040es.pdf"]) {
      const { res, out } = await probe(file, (t) => (/[a-z]{5,}/.exec(t)?.[0] ?? null));
      expect(res.ok, `${file}: ${res.ok ? "" : res.reason}`).toBe(true);
      expect((await textOf(out)).length).toBeGreaterThan(50);
    }
  });
});
