import path from "node:path";
import fs from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

// Regression tests for interactions that only fail with *real pointer/keyboard input* on the
// page: where a drag preview appears, whether a tool stays armed, whether strokes render while
// the pointer is still moving, whether typing lands on the page. Each one exists because the
// behavior was found broken by hands-on QA.

const FIXTURES = path.join(__dirname, "fixtures");

async function openFile(page: Page, filePath: string) {
  await page.goto("/pdf/editor");
  await page.locator('input[type="file"]').setInputFiles(filePath);
  await expect(page.locator('[data-testid="page-surface"]').first()).toBeVisible({ timeout: 15_000 });
}

const surface = (page: Page) => page.locator('[data-testid="page-surface"]').first();

async function surfaceBox(page: Page) {
  await surface(page).scrollIntoViewIfNeeded();
  const box = await surface(page).boundingBox();
  if (!box) throw new Error("no page surface");
  return box;
}

async function drag(page: Page, x0: number, y0: number, x1: number, y1: number, steps = 8) {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x1, y1, { steps });
  await page.mouse.up();
}

async function exportAndSave(page: Page, name: string): Promise<Buffer> {
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Export PDF/i }).click()]);
  const out = test.info().outputPath(name);
  await download.saveAs(out);
  return fs.readFileSync(out);
}

async function pdfTextItems(bytes: Buffer, pageNumber = 1) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), disableFontFace: true }).promise;
  const tc = await (await doc.getPage(pageNumber)).getTextContent();
  return tc.items.filter((i) => "str" in i && i.str.trim()).map((i) => ({ str: "str" in i ? i.str : "", x: (i as { transform: number[] }).transform[4], y: (i as { transform: number[] }).transform[5] }));
}

test.describe("PDF Editor: drag previews follow the pointer", () => {
  test("the live preview box sits exactly under the pointer while dragging (not at the page's top-left)", async ({ page }) => {
    await openFile(page, path.join(FIXTURES, "sample-a.pdf"));
    const sb = await surfaceBox(page);
    await page.getByRole("button", { name: "Highlight", exact: true }).click();

    const startX = sb.x + 60;
    const startY = sb.y + 60;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 120, startY + 50, { steps: 6 });

    const live = page.locator("[data-object-id='live-preview']");
    await expect(live).toHaveCount(1);
    const box = await live.boundingBox();
    if (!box) throw new Error("no live preview");
    expect(Math.abs(box.x - startX)).toBeLessThan(2);
    expect(Math.abs(box.y - startY)).toBeLessThan(2);
    expect(Math.abs(box.width - 120)).toBeLessThan(2);
    expect(Math.abs(box.height - 50)).toBeLessThan(2);
    await page.mouse.up();
  });

  test("a drag started on top of the page's text still draws (the text hit-target doesn't swallow it)", async ({ page }) => {
    await openFile(page, path.join(FIXTURES, "sample-a.pdf"));
    await page.getByRole("button", { name: "Highlight", exact: true }).click();
    const target = await page.getByRole("button", { name: /Edit text: Sample A - page 1/ }).boundingBox();
    if (!target) throw new Error("no text region");
    await drag(page, target.x + 4, target.y + 4, target.x + target.width - 4, target.y + target.height - 2);
    await expect(page.locator("[data-object-type=annotation]")).toHaveCount(1);
  });

  test("placement is exact (0px) at different zooms, when scrolled, and on a rotated page", async ({ page, isMobile }) => {
    await openFile(page, path.join(FIXTURES, "sample-a.pdf"));
    async function rectDragIsExact() {
      await page.waitForTimeout(600);
      await page.getByRole("button", { name: "Rectangle", exact: true }).click();
      const sb = await surfaceBox(page);
      const x0 = sb.x + 40, y0 = sb.y + 40;
      const x1 = Math.min(x0 + 120, sb.x + sb.width - 8), y1 = Math.min(y0 + 70, sb.y + sb.height - 8);
      await drag(page, x0, y0, x1, y1);
      const box = await page.locator("[data-object-type=shape]").last().boundingBox();
      if (!box) throw new Error("no shape");
      for (const [a, b] of [[box.x, x0], [box.y, y0], [box.x + box.width, x1], [box.y + box.height, y1]]) expect(Math.abs(a - b)).toBeLessThan(1.5);
      await page.keyboard.press("Escape");
    }
    await rectDragIsExact();
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    await rectDragIsExact();
    await page.getByRole("button", { name: "Fit width", exact: true }).click();
    await rectDragIsExact();
    if (isMobile) return; // the page rail (rotate buttons) lives in a drawer on phones
    await page.getByRole("button", { name: "Go to page 1" }).hover();
    await page.getByRole("button", { name: "Rotate page 1 clockwise" }).click();
    await rectDragIsExact();
  });
});

test.describe("PDF Editor: tools stay armed for repeated use", () => {
  test("highlight, underline and strikethrough each work several times in a row without reselecting", async ({ page }) => {
    await openFile(page, path.join(FIXTURES, "sample-a.pdf"));
    const sb = await surfaceBox(page);
    for (const [label, n] of [["Highlight", 3], ["Underline", 5], ["Strike", 2]] as const) {
      await page.getByRole("button", { name: label, exact: true }).click();
      for (let i = 0; i < n; i++) await drag(page, sb.x + 30, sb.y + 30 + i * 35, sb.x + 180, sb.y + 55 + i * 35, 4);
      await expect(page.getByRole("button", { name: label, exact: true })).toHaveAttribute("aria-pressed", "true");
    }
    await expect(page.locator("[data-object-type=annotation]")).toHaveCount(10);
  });

  test("Escape leaves the tool; a stray click without dragging doesn't create anything or drop the tool", async ({ page }) => {
    await openFile(page, path.join(FIXTURES, "sample-a.pdf"));
    const sb = await surfaceBox(page);
    await page.getByRole("button", { name: "Underline", exact: true }).click();
    await page.mouse.click(sb.x + 100, sb.y + 100); // a click, not a drag
    await expect(page.locator("[data-object-type=annotation]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Underline", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Select", exact: true })).toHaveAttribute("aria-pressed", "true");
  });
});

test.describe("PDF Editor: freehand drawing", () => {
  test("the stroke is visible while the pointer is still down, and the tool stays armed", async ({ page }) => {
    await openFile(page, path.join(FIXTURES, "sample-a.pdf"));
    const sb = await surfaceBox(page);
    await page.getByRole("button", { name: "Draw", exact: true }).click();
    await page.mouse.move(sb.x + 40, sb.y + 40);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(sb.x + 40 + i * 10, sb.y + 40 + Math.sin(i / 2) * 20);
    // Mid-stroke — button still held — the ink must already be on the page.
    const points = await page.locator("[data-testid=live-stroke] polyline").getAttribute("points");
    expect((points ?? "").split(" ").length).toBeGreaterThanOrEqual(10);
    await page.mouse.up();
    // ...and a second stroke works without reselecting Draw.
    await drag(page, sb.x + 40, sb.y + 140, sb.x + 200, sb.y + 170);
    await expect(page.locator("[data-object-type=drawing]")).toHaveCount(2);
    await expect(page.locator("[data-testid=live-stroke]")).toHaveCount(0);
  });
});

test.describe("PDF Editor: text is edited directly on the page", () => {
  test("place text, type a sentence continuously, edit inside it, and it exports where it shows", async ({ page }) => {
    await openFile(page, path.join(FIXTURES, "sample-a.pdf"));
    const sb = await surfaceBox(page);
    await page.getByRole("button", { name: "Text", exact: true }).click();
    await page.mouse.click(sb.x + 60, sb.y + 300);

    const editor = page.getByTestId("canvas-text-editor");
    await expect(editor).toBeFocused();
    await page.keyboard.type("The quick brown fox", { delay: 15 });
    await expect(editor).toHaveValue("The quick brown fox"); // placeholder was replaced, all keystrokes landed

    // edit the middle: select "quick" with the keyboard and replace it
    await page.keyboard.press("Control+Home");
    for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight");
    for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.type("slow");
    await page.keyboard.press("End");
    await page.keyboard.type(" jumps");
    await page.keyboard.press("Backspace");
    await expect(editor).toHaveValue("The slow brown fox jump");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("canvas-text-editor")).toHaveCount(0);

    const box = await page.locator("[data-object-type=added-text]").boundingBox();
    if (!box) throw new Error("no text box");
    const bytes = await exportAndSave(page, "typed.pdf");
    const items = await pdfTextItems(bytes);
    const added = items.filter((i) => i.str !== "Sample A - page 1").map((i) => i.str).join(" ");
    expect(added.replace(/\s+/g, " ")).toBe("The slow brown fox jump");
    // The first line's left edge lands where the box's left edge is on screen.
    const first = items.find((i) => i.str.startsWith("The slow"));
    expect(first).toBeTruthy();
    expect(Math.abs(first!.x - (box.x - sb.x) / 1.3)).toBeLessThan(1);
  });

  test("clicking an already-selected text box (or double-clicking) re-enters editing; typing is one undo step", async ({ page }) => {
    await openFile(page, path.join(FIXTURES, "sample-a.pdf"));
    const sb = await surfaceBox(page);
    await page.getByRole("button", { name: "Text", exact: true }).click();
    await page.mouse.click(sb.x + 60, sb.y + 300);
    await page.keyboard.type("Hello world");
    await page.keyboard.press("Escape");

    await page.locator("[data-object-type=added-text]").click(); // already selected → edit
    await expect(page.getByTestId("canvas-text-editor")).toBeFocused();
    await page.keyboard.press("Control+a");
    await page.keyboard.type("Second draft");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(page.locator("[data-object-type=added-text]")).toContainText("Hello world");
  });

  test("the selected text's color and size are edited from the panel, and Delete removes it", async ({ page, isMobile }) => {
    test.skip(isMobile, "needs the desktop side panel/page rail; the mobile drawers are covered by the advanced suite");
    await openFile(page, path.join(FIXTURES, "sample-a.pdf"));
    const sb = await surfaceBox(page);
    await page.getByRole("button", { name: "Text", exact: true }).click();
    await page.mouse.click(sb.x + 60, sb.y + 300);
    await page.keyboard.type("Sized");
    await page.keyboard.press("Escape");
    const before = await page.locator("[data-object-type=added-text]").boundingBox();
    await page.getByRole("button", { name: "Red", exact: true }).click();
    await page.getByLabel("Font size").fill("28");
    const el = page.locator("[data-object-type=added-text] div").first();
    await expect(el).toHaveCSS("color", "rgb(219, 38, 38)");
    const after = await page.locator("[data-object-type=added-text]").boundingBox();
    expect(after!.height).toBeGreaterThan(before!.height * 1.5);
    await page.getByLabel("Font size").blur();
    await page.keyboard.press("Delete");
    await expect(page.locator("[data-object-type=added-text]")).toHaveCount(0);
  });

  test("typing into the properties-panel text box isn't cut off after one character", async ({ page, isMobile }) => {
    test.skip(isMobile, "needs the desktop side panel/page rail; the mobile drawers are covered by the advanced suite");
    await openFile(page, path.join(FIXTURES, "sample-a.pdf"));
    const sb = await surfaceBox(page);
    await page.getByRole("button", { name: "Text", exact: true }).click();
    await page.mouse.click(sb.x + 60, sb.y + 300);
    await page.keyboard.press("Escape");
    const panelText = page.locator("textarea").first();
    await panelText.click();
    await page.keyboard.press("Control+a");
    await page.keyboard.type("typed in the panel", { delay: 20 });
    await expect(panelText).toHaveValue("typed in the panel");
  });
});

test.describe("PDF Editor: shapes, images, crop, search, pages", () => {
  test("a line dragged down-right exports down-right, and matches what's on screen", async ({ page }) => {
    await openFile(page, path.join(FIXTURES, "sample-a.pdf"));
    const sb = await surfaceBox(page);
    await page.getByRole("button", { name: "Line", exact: true }).click();
    await drag(page, sb.x + 40, sb.y + 40, sb.x + 200, sb.y + 160); // top-left → bottom-right on screen
    const bytes = await exportAndSave(page, "line.pdf");
    const doc = await PDFDocument.load(bytes);
    const stream = doc.getPage(0).node.Contents();
    expect(stream).toBeTruthy();
    // Inspect the actual path: the line should start near the TOP-left (high PDF y) and end
    // at the BOTTOM-right (low PDF y).
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loaded = await pdfjs.getDocument({ data: new Uint8Array(bytes), disableFontFace: true }).promise;
    const ops = await (await loaded.getPage(1)).getOperatorList();
    const idx = ops.fnArray.indexOf(pdfjs.OPS.constructPath);
    expect(idx).toBeGreaterThan(-1);
    // args = [paintOp, [pathData], minMax]; pathData is a flat run of DrawOPS-tagged points
    // (0 = moveTo, 1 = lineTo, each followed by x, y).
    const args = ops.argsArray[idx] as [number, ArrayLike<number>[], number[]];
    const data = Array.from(args[1][0]);
    const move = data.indexOf(0);
    const line = data.lastIndexOf(1);
    const [x0, y0] = [data[move + 1], data[move + 2]];
    const [x1, y1] = [data[line + 1], data[line + 2]];
    expect(x1).toBeGreaterThan(x0);
    expect(y1).toBeLessThan(y0);
  });

  test("a resized picture keeps its proportions (screen and export agree)", async ({ page }) => {
    await openFile(page, path.join(FIXTURES, "sample-a.pdf"));
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Image", exact: true }).click()]);
    await chooser.setFiles(path.join(FIXTURES, "sample.jpg"));
    const sb = await surfaceBox(page);
    await page.waitForTimeout(300);
    await page.mouse.click(sb.x + 150, sb.y + 150);
    const img = page.locator("[data-object-type=image]");
    await expect(img).toHaveCount(1);
    const before = (await img.boundingBox())!;
    const handle = (await img.locator(".rounded-full").nth(3).boundingBox())!;
    await page.mouse.move(handle.x + 6, handle.y + 6);
    await page.mouse.down();
    await page.mouse.move(handle.x + 6 + 70, handle.y + 6 - 25, { steps: 6 });
    await page.mouse.up();
    const after = (await img.boundingBox())!;
    expect(after.width).toBeGreaterThan(before.width);
    expect(Math.abs(after.width / after.height - before.width / before.height)).toBeLessThan(0.02);
  });

  test("a crop area can be adjusted by its handles, is kept on the page, and applied from the action bar", async ({ page, isMobile }) => {
    test.skip(isMobile, "the page is wider than a phone screen (it scrolls sideways), so a drag can't reach its far corner");
    await openFile(page, path.join(FIXTURES, "multi-page.pdf"));
    await page.getByRole("button", { name: "Crop", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Drag on the page");
    const sb = await surfaceBox(page);
    await drag(page, sb.x + 40, sb.y + 40, sb.x + sb.width + 200, sb.y + sb.height + 200); // overshoots the page
    await expect(page.getByRole("button", { name: "Keep this area" })).toBeVisible();
    // (The action bar shifts the layout, so measure the page again now that it's shown.)
    const sbNow = await surfaceBox(page);
    const handle = (await page.locator("[data-crop-handle=se]").boundingBox())!;
    // clamped to the page: the handle sits on the page's bottom-right corner, not past it.
    expect(handle.x + handle.width / 2).toBeLessThanOrEqual(sbNow.x + sbNow.width + 1);
    expect(handle.y + handle.height / 2).toBeLessThanOrEqual(sbNow.y + sbNow.height + 1);
    await page.mouse.move(handle.x + 7, handle.y + 7);
    await page.mouse.down();
    await page.mouse.move(handle.x + 7 - 80, handle.y + 7 - 100, { steps: 6 });
    await page.mouse.up();
    await page.getByRole("button", { name: "Keep this area" }).click();
    const bytes = await exportAndSave(page, "cropped-bar.pdf");
    const doc = await PDFDocument.load(bytes);
    const crop = doc.getPage(0).getCropBox();
    const media = doc.getPage(0).getMediaBox();
    expect(crop.width).toBeLessThan(media.width);
    expect(crop.x + crop.width).toBeLessThanOrEqual(media.width + 0.5);
    expect(crop.y).toBeGreaterThanOrEqual(-0.5);
  });

  test("search covers every page from the start and Next/Prev jump to the match", async ({ page, isMobile }) => {
    test.skip(isMobile, "needs the desktop side panel/page rail; the mobile drawers are covered by the advanced suite");
    await openFile(page, path.join(FIXTURES, "multi-page.pdf"));
    await page.locator("summary", { hasText: /^Search/ }).click();
    await page.getByLabel("Search document text").fill("Page");
    await expect(page.getByText("1 of 5")).toBeVisible(); // 5 pages, none visited yet
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByText("2 of 5")).toBeVisible();
    await expect(page.locator('div.group[class*="border-[var(--brand)]"]').getByRole("button", { name: "Go to page 2" })).toBeVisible();
    await expect(page.locator("[data-testid=page-surface] [class*='ring-yellow-500']")).toHaveCount(1);
  });

  test("pages can be moved with the Move up/down buttons (works without dragging)", async ({ page, isMobile }) => {
    test.skip(isMobile, "needs the desktop side panel/page rail; the mobile drawers are covered by the advanced suite");
    await openFile(page, path.join(FIXTURES, "multi-page.pdf"));
    await page.getByRole("button", { name: "Go to page 1" }).hover();
    await page.getByRole("button", { name: "Move page 1 down" }).click();
    const bytes = await exportAndSave(page, "moved.pdf");
    const first = (await pdfTextItems(bytes, 1)).map((i) => i.str).join(" ");
    expect(first).toContain("Page 2 of 5");
  });

  test("Whiteout shows the not-secure-redaction warning while it's the active tool", async ({ page, isMobile }) => {
    test.skip(isMobile, "needs the desktop side panel/page rail; the mobile drawers are covered by the advanced suite");
    await openFile(page, path.join(FIXTURES, "sample-a.pdf"));
    await page.getByRole("button", { name: "Whiteout", exact: true }).click();
    await expect(page.getByRole("note")).toContainText(/not secure\s+redaction/i);
  });
});
