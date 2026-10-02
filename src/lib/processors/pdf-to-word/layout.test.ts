import { describe, expect, it } from "vitest";
import { documentStats, findHeadersFooters, layoutPage, layoutText, type Block, type PageInput, type Rule, type TextItem } from "./layout";

/** Items for lines of text starting at `y`, `gap` points apart. */
function lines(texts: string[], opts: { x?: number; y?: number; size?: number; gap?: number; bold?: boolean } = {}): TextItem[] {
  const { x = 72, y = 700, size = 11, gap = 15, bold = false } = opts;
  return texts.map((str, i) => ({ str, x, y: y - i * gap, w: str.length * size * 0.5, size, bold, italic: false }));
}
const page = (items: TextItem[], images: PageInput["images"] = []): PageInput => ({ width: 612, height: 792, items, images });
const lay = (p: PageInput) => layoutPage(p, documentStats([p]));

describe("layoutPage", () => {
  it("keeps paragraphs apart and joins the lines inside each", () => {
    // Wrapped lines run to the right edge (a line that stops short ended there on purpose).
    const items = [...lines(["The first paragraph starts here and it", "carries on to a second line."]).map((it, i) => (i === 0 ? { ...it, w: 460 } : it)), ...lines(["The second paragraph is separate."], { y: 650 })];
    const blocks = lay(page(items)).blocks;
    expect(blocks.map((b) => b.kind === "paragraph" && b.runs.map((r) => r.text).join(""))).toEqual([
      "The first paragraph starts here and it carries on to a second line.",
      "The second paragraph is separate.",
    ]);
  });

  it("splits single-line paragraphs even when every gap on the page is a paragraph gap", () => {
    const items = lines(["One short paragraph.", "Another short paragraph.", "A third one."], { gap: 24 });
    expect(lay(page(items)).blocks).toHaveLength(3);
  });

  it("turns larger type into Heading 1–3 by size, relative to the body text", () => {
    const items = [
      ...lines(["Report Title"], { y: 740, size: 24 }),
      ...lines(["Section"], { y: 700, size: 16 }),
      ...lines(["Subsection"], { y: 670, size: 13 }),
      ...lines(Array.from({ length: 8 }, (_, i) => `Body line ${i} with ordinary text that runs along.`), { y: 640 }),
    ];
    const styles = lay(page(items)).blocks.map((b) => (b.kind === "paragraph" ? b.style : b.kind));
    expect(styles.slice(0, 3)).toEqual(["h1", "h2", "h3"]);
    expect(styles[3]).toBe("normal");
  });

  it("recognises bulleted and numbered lists, and numbers restart per list", () => {
    const items = [...lines(["• Apples", "• Pears"]), ...lines(["3. Third step", "4. Fourth step"], { y: 640 })];
    const blocks = lay(page(items)).blocks;
    expect(blocks.map((b) => b.kind === "list" && [b.ordered, b.start, b.runs.map((r) => r.text).join("")])).toEqual([
      [false, 1, "Apples"],
      [false, 1, "Pears"],
      [true, 3, "Third step"],
      [true, 4, "Fourth step"],
    ]);
  });

  it("rebuilds a simple table from aligned cells", () => {
    const row = (y: number, cells: string[]) => cells.map((str, k) => ({ str, x: 72 + k * 120, y, w: str.length * 5, size: 11, bold: false, italic: false }));
    const items = [...row(700, ["Item", "Qty", "Price"]), ...row(684, ["Pens", "40", "$18.50"]), ...row(668, ["Folders", "8", "$9.60"])];
    const blocks = lay(page(items)).blocks;
    expect(blocks).toHaveLength(1);
    const table = blocks[0];
    expect(table.kind).toBe("table");
    if (table.kind === "table") expect(table.rows.map((r) => r.cells.map((c) => c.paragraphs.map((p) => p.runs.map((x) => x.text).join("")).join("")))).toEqual([
      ["Item", "Qty", "Price"],
      ["Pens", "40", "$18.50"],
      ["Folders", "8", "$9.60"],
    ]);
  });

  it("reads two columns left column first, then right", () => {
    const col = (x: number, label: string) => lines(Array.from({ length: 8 }, (_, i) => `${label} line ${i + 1} with enough words to fill the column width`), { x, y: 680 }).map((it) => ({ ...it, w: 220 }));
    const items = [...lines(["Newsletter"], { y: 740, size: 22 }), ...col(60, "Left"), ...col(330, "Right")];
    const text = layoutText([lay(page(items))]);
    expect(text.indexOf("Newsletter")).toBeLessThan(text.indexOf("Left line 1"));
    expect(text.indexOf("Left line 8")).toBeLessThan(text.indexOf("Right line 1"));
  });

  it("places pictures in reading order and keeps their proportions", () => {
    const img = { x: 72, y: 500, w: 300, h: 180, bytes: new Uint8Array([1]), mime: "image/png" as const, pxWidth: 600, pxHeight: 360 };
    const items = [...lines(["Before the picture."], { y: 700 }), ...lines(["After the picture."], { y: 480 })];
    const blocks = lay(page(items, [img])).blocks;
    expect(blocks.map((b) => b.kind)).toEqual(["paragraph", "image", "paragraph"]);
    const pic = blocks[1];
    if (pic.kind === "image") expect(pic.width / pic.height).toBeCloseTo(300 / 180, 5);
  });

  it("joins a word hyphenated across lines and keeps every other character as it is", () => {
    const items = lines(["The exam-", "ple shows niño, €120, “quotes” and ✓ marks."]).map((it, i) => (i === 0 ? { ...it, w: 460 } : it));
    expect(layoutText([lay(page(items))])).toBe("The example shows niño, €120, “quotes” and ✓ marks.");
  });
});

const textOf = (b: Block) => (b.kind === "paragraph" || b.kind === "list" ? b.runs.map((r) => r.text).join("") : "");
const rule = (x0: number, y0: number, x1: number, y1: number): Rule => ({ x0, y0, x1, y1, thickness: 0.5, color: "000000" });

describe("layoutPage — formatting kept", () => {
  it("keeps each run's font and colour, and the body font is the document's", () => {
    const items: TextItem[] = [
      ...lines(Array.from({ length: 6 }, (_, i) => `Body text line ${i} written in the body font.`)).map((it) => ({ ...it, font: "Calibri" })),
      { str: "Red code", x: 72, y: 600, w: 50, size: 11, bold: false, italic: false, font: "Courier New", color: "c00000" },
    ];
    const p = page(items);
    const stats = documentStats([p]);
    expect(stats.bodyFont).toBe("Calibri");
    const runs = layoutPage(p, stats).blocks.flatMap((b) => (b.kind === "paragraph" ? b.runs : []));
    const red = runs.find((r) => r.text.includes("Red code"))!;
    expect([red.font, red.color]).toEqual(["Courier New", "c00000"]);
  });

  it("turns a dotted leader into a right tab with a dot leader", () => {
    const items: TextItem[] = [
      { str: "Introduction", x: 72, y: 700, w: 60, size: 11, bold: false, italic: false },
      { str: "........................................", x: 140, y: 700, w: 380, size: 11, bold: false, italic: false },
      { str: "3", x: 534, y: 700, w: 6, size: 11, bold: false, italic: false },
    ];
    const b = lay(page(items)).blocks[0];
    expect(b.kind).toBe("paragraph");
    if (b.kind !== "paragraph") return;
    // A dot-leader stop where the dots end, then the page number at its own right stop.
    expect(textOf(b)).toMatch(/^Introduction\t+3$/);
    const leader = b.fmt.tabs.find((t) => t.leader === "dot");
    expect(leader?.align).toBe("right");
    expect(leader!.pos).toBeCloseTo(520 - 72, 0);
    expect(b.fmt.tabs[b.fmt.tabs.length - 1].pos).toBeCloseTo(540 - 72, 0);
  });

  it("rebuilds a ruled table from its lines, with a cell spanning two columns", () => {
    // Three columns (x 72 / 222 / 372 / 522), three rows (y 700 / 680 / 660 / 640); the top row has no inner lines.
    const rules = [700, 680, 660, 640].map((y) => rule(72, y, 522, y));
    rules.push(rule(72, 640, 72, 700), rule(522, 640, 522, 700), rule(222, 640, 222, 680), rule(372, 640, 372, 680));
    const cellText = (str: string, x: number, y: number): TextItem => ({ str, x, y, w: str.length * 5, size: 10, bold: false, italic: false });
    const items = [cellText("Quarterly summary", 78, 686), cellText("North", 78, 666), cellText("412", 228, 666), cellText("96%", 378, 666), cellText("South", 78, 646), cellText("388", 228, 646), cellText("94%", 378, 646)];
    const blocks = lay({ ...page(items), rules }).blocks;
    const t = blocks.find((b) => b.kind === "table");
    expect(t?.kind).toBe("table");
    if (t?.kind !== "table") return;
    expect(t.columns.map(Math.round)).toEqual([150, 150, 150]);
    expect(t.rows.map((r) => r.cells.map((c) => c.span))).toEqual([[3], [1, 1, 1], [1, 1, 1]]);
    expect(t.rows[1].cells.map((c) => c.paragraphs.map((p) => p.runs.map((r) => r.text).join("")).join(""))).toEqual(["North", "412", "96%"]);
    expect(t.bordered).toBe(true);
    // Row heights come from the lines (20 pt apart, less the border).
    for (const r of t.rows) expect(r.height).toBeCloseTo(19.5, 1);
  });

  it("sets the right margin so wrapped lines still wrap where they did", () => {
    // Lines end at x≈500; the next line's first word ("wrapped", ~35 pt) would have fitted only past ~535.
    const texts = ["This paragraph is long enough that its lines must wrap here at the", "wrapped word and then it carries on along the second line of text", "and ends."];
    const items = lines(texts).map((it, i) => ({ ...it, w: i < 2 ? 428 : 40 }));
    const out = lay(page(items));
    const right = 612 - out.margins.right;
    expect(right).toBeGreaterThan(500);
    expect(right).toBeLessThan(507);
  });
});

describe("findHeadersFooters", () => {
  it("finds the running header and the page-number footer, and leaves body text alone", () => {
    const pages: PageInput[] = [1, 2, 3].map((n) => ({
      width: 612,
      height: 792,
      images: [],
      items: [
        { str: "Evergreen Community Bank", x: 72, y: 750, w: 160, size: 14, bold: true, italic: false },
        ...lines([`Body text on page ${n} that is not a header.`, "More body text."], { y: 680 }),
        { str: `Page ${n} of 3`, x: 280, y: 36, w: 50, size: 8, bold: false, italic: false },
      ],
    }));
    const bands = findHeadersFooters(pages);
    for (const b of bands) {
      expect([...b.header].map((i) => i.str)).toEqual(["Evergreen Community Bank"]);
      expect([...b.footer].map((i) => i.str)[0]).toMatch(/^Page \d of 3$/);
    }
    const stats = documentStats(pages);
    const out = layoutPage(pages[1], stats, { next: 1 }, bands[1]);
    expect(out.header?.[0].runs.map((r) => r.text).join("")).toBe("Evergreen Community Bank");
    expect(out.footer?.[0].runs.map((r) => r.field ?? r.text)).toEqual(["Page ", "PAGE", " of ", "NUMPAGES"]);
    // In the header part only, not in the body as well.
    const body = out.blocks.map(textOf).join(" ");
    expect(body).not.toContain("Evergreen");
    expect(body).not.toMatch(/Page \d of/);
  });
});

describe("text is never lost or changed", () => {
  it("keeps the text of a vertically merged cell that sits in its lower row", () => {
    // Two rows, two columns; no line between the rows in the first column (merged), text centred across.
    const rules = [rule(72, 700, 372, 700), rule(222, 670, 372, 670), rule(72, 640, 372, 640), rule(72, 640, 72, 700), rule(222, 640, 222, 700), rule(372, 640, 372, 700)];
    const t = (str: string, x: number, y: number): TextItem => ({ str, x, y, w: str.length * 5, size: 10, bold: false, italic: false });
    const items = [t("Merged label", 78, 664), t("first", 228, 684), t("second", 228, 654)];
    const blocks = lay({ ...page(items), rules }).blocks;
    const table = blocks.find((b) => b.kind === "table");
    expect(table?.kind).toBe("table");
    if (table?.kind !== "table") return;
    const text = table.rows.flatMap((r) => r.cells.flatMap((c) => c.paragraphs.flatMap((p) => p.runs.map((x) => x.text))));
    expect(text).toEqual(expect.arrayContaining(["Merged label", "first", "second"]));
    expect(table.rows[0].cells[0].vMerge).toBe("restart");
    expect(table.rows[1].cells[0].vMerge).toBe("continue");
  });

  it("turns a number at the foot of the page into a page-number field only when it is the page number", () => {
    const body = lines(Array.from({ length: 6 }, (_, i) => `Body line ${i} with ordinary words in it.`), { y: 700 });
    const foot = (str: string): TextItem => ({ str, x: 300, y: 30, w: 20, size: 9, bold: false, italic: false });
    const fieldOf = (pages: PageInput[], i: number) => {
      const bands = findHeadersFooters(pages);
      const out = layoutPage(pages[i], documentStats(pages), { next: 1 }, bands[i]);
      const all = [...(out.footer ?? []).flatMap((p) => p.runs), ...out.blocks.flatMap((b) => (b.kind === "paragraph" ? b.runs : []))];
      return { field: all.find((r) => r.field)?.field ?? null, text: layoutText([out]) };
    };
    // A real page number.
    const numbered = [1, 2].map((n) => ({ ...page([...body, foot(String(n))]) }));
    expect(fieldOf(numbered, 1).field).toBe("PAGE");
    // An amount alone at the foot of a one-page document stays as written.
    const amount = fieldOf([page([...body, foot("1250")])], 0);
    expect(amount.field).toBeNull();
    expect(amount.text).toContain("1250");
  });
});

describe("table borders are not underlines", () => {
  it("keeps a cell border just under a short word as a border (no false underline, no merged rows)", () => {
    // Rows 13.4 pt apart; each word's baseline sits 3.2 pt above the line under it (size 11), like Word's tables.
    const ys = [695.15, 681.75, 668.35, 654.95];
    const rules: Rule[] = [];
    for (const y of ys) for (const x of [90, 198, 306]) rules.push(rule(x, y, x + 108, y));
    for (const x of [90, 198, 306, 414]) rules.push(rule(x, ys[3], x, ys[0]));
    const t = (str: string, x: number, y: number): TextItem => ({ str, x, y, w: str.length * 5.5, size: 11, bold: false, italic: false });
    const items = [t("Region", 95, 684.94), t("Q1", 203, 684.94), t("Q2", 311, 684.94), t("North", 95, 671.54), t("12", 203, 671.54), t("13", 311, 671.54), t("South", 95, 658.14), t("9", 203, 658.14), t("10", 311, 658.14)];
    const table = lay({ ...page(items), rules }).blocks.find((b) => b.kind === "table");
    expect(table?.kind).toBe("table");
    if (table?.kind !== "table") return;
    expect(table.rows.map((r) => r.cells.map((c) => c.paragraphs.map((p) => p.runs.map((x) => x.text).join("")).join("|")))).toEqual([
      ["Region", "Q1", "Q2"],
      ["North", "12", "13"],
      ["South", "9", "10"],
    ]);
    expect(table.rows.flatMap((r) => r.cells).every((c) => !c.vMerge)).toBe(true);
    expect(table.rows.flatMap((r) => r.cells.flatMap((c) => c.paragraphs.flatMap((p) => p.runs))).some((r) => r.underline)).toBe(false);
  });

  it("still recognises a real underline drawn along its words", () => {
    const items: TextItem[] = [...lines(Array.from({ length: 4 }, (_, i) => `Plain body text line ${i} for the statistics.`)), { str: "Important", x: 72, y: 600, w: 50, size: 11, bold: false, italic: false }];
    const runs = lay({ ...page(items), rules: [rule(72, 598.5, 122, 598.5)] }).blocks.flatMap((b) => (b.kind === "paragraph" ? b.runs : []));
    expect(runs.find((r) => r.text.includes("Important"))?.underline).toBe(true);
  });
});

describe("scanned text", () => {
  it("joins a recognised paragraph's wrapped lines even though OCR sizes differ a little line to line", () => {
    const words = (text: string, y: number, size: number, width: number): TextItem[] => {
      const parts = text.split(" ");
      const step = width / parts.length;
      return parts.map((str, i) => ({ str, x: 72 + i * step, y, w: step * 0.85, size, bold: false, italic: false, ocr: true }));
    };
    const items = [
      ...words("Service Receipt", 720, 18, 150),
      ...words("The regional office completed the quarterly review on schedule, and every site submitted its", 680, 11.4, 460),
      ...words("figures before the deadline.", 665, 12.1, 140),
    ];
    const paras = lay(page(items)).blocks.filter((b) => b.kind === "paragraph").map(textOf);
    expect(paras).toContain("The regional office completed the quarterly review on schedule, and every site submitted its figures before the deadline.");
  });
});

describe("PDF font names → Word font names", () => {
  it("maps the open stand-ins back to the Word fonts they match, and keeps unknown names readable", async () => {
    const { wordFontName } = await import("./extract");
    expect(["ABCDEF+Gelasio-Bold", "Carlito", "Caladea-Italic", "LiberationSerif", "DejaVuSans-Bold", "DejaVuSansMono", "BCDEFG+SourceSansPro-Regular", "Symbol"].map(wordFontName)).toEqual([
      "Georgia",
      "Calibri",
      "Cambria",
      "Times New Roman",
      "Verdana",
      "Deja Vu Sans Mono",
      "Source Sans Pro",
      "",
    ]);
  });
});
