import { describe, expect, it } from "vitest";
import { documentStats, layoutPage, layoutText, type PageInput, type TextItem } from "./layout";

/** Items for lines of text starting at `y`, `gap` points apart. */
function lines(texts: string[], opts: { x?: number; y?: number; size?: number; gap?: number; bold?: boolean } = {}): TextItem[] {
  const { x = 72, y = 700, size = 11, gap = 15, bold = false } = opts;
  return texts.map((str, i) => ({ str, x, y: y - i * gap, w: str.length * size * 0.5, size, bold, italic: false }));
}
const page = (items: TextItem[], images: PageInput["images"] = []): PageInput => ({ width: 612, height: 792, items, images });
const lay = (p: PageInput) => layoutPage(p, documentStats([p]));

describe("layoutPage", () => {
  it("keeps paragraphs apart and joins the lines inside each", () => {
    const items = [...lines(["The first paragraph starts here and it", "carries on to a second line."]), ...lines(["The second paragraph is separate."], { y: 650 })];
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
    if (table.kind === "table") expect(table.rows.map((r) => r.map((c) => c.map((x) => x.text).join("")))).toEqual([
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
    const items = lines(["The exam-", "ple shows niño, €120, “quotes” and ✓ marks."]);
    expect(layoutText([lay(page(items))])).toBe("The example shows niño, €120, “quotes” and ✓ marks.");
  });
});
