import path from "node:path";
import fs from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

// Regression tests for interactions that only fail with *real pointer/keyboard input* on the
// page: where a drag preview appears, whether a tool stays armed, whether strokes render while
// the pointer is still moving, whether typing lands on the page. Each one exists because the
// behavior was found broken by hands-on QA.

const FIXTURES = path.join(__dirname, "fixtures");

async function openFile(page: Page, filePath: string, { actualSize = true } = {}) {
  await page.goto("/pdf/editor");
  await page.locator('input[type="file"]').setInputFiles(filePath);
  await expect(page.locator('[data-testid="page-surface"]').first()).toBeVisible({ timeout: 15_000 });
  // A phone opens the page fit to its width; most of these tests measure against 100%.
  if (actualSize) await page.getByRole("button", { name: "Actual size (100%)" }).click();
}

// Below the lg breakpoint the Properties panel and the page rail are on-demand drawers with a
// "Close panel" button, not permanent columns. These run `fn` with the named panel visible and
// close the drawer afterwards, so one test body covers both layouts.
async function withPanel(page: Page, isMobile: boolean, panel: "Properties" | "Pages", fn: () => Promise<void>) {
  if (isMobile) await page.getByRole("button", { name: new RegExp(`^${panel}`) }).click();
  await fn();
  if (isMobile) {
    await page.getByRole("button", { name: "Close panel" }).click();
    await expect(page.getByRole("button", { name: "Close panel" })).toBeHidden();
  }
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
    await openFile(page, path.join(FIXTURES, "sample-a.pdf"));
    const sb = await surfaceBox(page);
    await page.getByRole("button", { name: "Text", exact: true }).click();
    await page.mouse.click(sb.x + 60, sb.y + 300);
    await page.getByTestId("canvas-text-editor").waitFor();
    await page.keyboard.type("Sized");
    await page.keyboard.press("Escape");
    const before = await page.locator("[data-object-type=added-text]").boundingBox();
    await withPanel(page, isMobile, "Properties", async () => {
      await page.getByRole("button", { name: "Red", exact: true }).click();
      await page.getByLabel("Font size").fill("28");
      await page.getByLabel("Font size").blur();
    });
    const el = page.locator("[data-object-type=added-text] div").first();
    await expect(el).toHaveCSS("color", "rgb(219, 38, 38)");
    const after = await page.locator("[data-object-type=added-text]").boundingBox();
    expect(after!.height).toBeGreaterThan(before!.height * 1.5);
    await page.keyboard.press("Delete");
    await expect(page.locator("[data-object-type=added-text]")).toHaveCount(0);
  });

  test("typing into the properties-panel text box isn't cut off after one character", async ({ page, isMobile }) => {
    await openFile(page, path.join(FIXTURES, "sample-a.pdf"));
    const sb = await surfaceBox(page);
    await page.getByRole("button", { name: "Text", exact: true }).click();
    await page.mouse.click(sb.x + 60, sb.y + 300);
    await page.getByTestId("canvas-text-editor").waitFor();
    await page.keyboard.press("Escape");
    await withPanel(page, isMobile, "Properties", async () => {
      const panelText = page.locator("textarea").first();
      await panelText.click();
      await page.keyboard.press("Control+a");
      await page.keyboard.type("typed in the panel", { delay: 20 });
      await expect(panelText).toHaveValue("typed in the panel");
    });
    await expect(page.locator("[data-object-type=added-text]")).toContainText("typed in the panel");
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

  test("a crop area can be adjusted by its handles, is kept on the page, and applied from the action bar", async ({ page }) => {
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
    await openFile(page, path.join(FIXTURES, "multi-page.pdf"));
    await withPanel(page, isMobile, "Properties", async () => {
      await page.locator("summary", { hasText: /^Search/ }).click();
      await page.getByLabel("Search document text").fill("Page");
      await expect(page.getByText("1 of 5")).toBeVisible(); // 5 pages, none visited yet
      await page.getByRole("button", { name: "Next", exact: true }).click();
      await expect(page.getByText("2 of 5")).toBeVisible();
    });
    await withPanel(page, isMobile, "Pages", async () => {
      await expect(page.locator('div.group[class*="border-[var(--brand)]"]').getByRole("button", { name: "Go to page 2" })).toBeVisible();
    });
    await expect(page.locator("[data-testid=page-surface] [class*='ring-yellow-500']")).toHaveCount(1);
  });

  test("pages can be moved with the Move up/down buttons (works without dragging)", async ({ page, isMobile }) => {
    await openFile(page, path.join(FIXTURES, "multi-page.pdf"));
    await withPanel(page, isMobile, "Pages", async () => {
      if (!isMobile) await page.getByRole("button", { name: "Go to page 1" }).hover();
      await page.getByRole("button", { name: "Move page 1 down" }).click();
    });
    const bytes = await exportAndSave(page, "moved.pdf");
    const first = (await pdfTextItems(bytes, 1)).map((i) => i.str).join(" ");
    expect(first).toContain("Page 2 of 5");
  });

  test("Whiteout shows the not-secure-redaction warning while it's the active tool", async ({ page, isMobile }) => {
    await openFile(page, path.join(FIXTURES, "sample-a.pdf"));
    await page.getByRole("button", { name: "Whiteout", exact: true }).click();
    await withPanel(page, isMobile, "Properties", async () => {
      await expect(page.getByRole("note")).toContainText(/not secure\s+redaction/i);
    });
  });
});

test.describe("PDF Editor: added text on a rotated page", () => {
  test("keeps its layout (one line, real width) and turns with the page instead of wrapping into a sliver", async ({ page, isMobile }) => {
    await openFile(page, path.join(FIXTURES, "sample-a.pdf"));
    const sb = await surfaceBox(page);
    await page.getByRole("button", { name: "Text", exact: true }).click();
    await page.mouse.click(sb.x + 60, sb.y + 300);
    await page.getByTestId("canvas-text-editor").waitFor();
    await page.keyboard.type("A single line of text");
    await page.keyboard.press("Escape");
    await withPanel(page, isMobile, "Pages", async () => {
      if (!isMobile) await page.getByRole("button", { name: "Go to page 1" }).hover();
      await page.getByRole("button", { name: "Rotate page 1 clockwise" }).click();
    });
    const metrics = await page.locator("[data-object-type=added-text] div").first().evaluate((el) => {
      const cs = getComputedStyle(el);
      return { height: (el as HTMLElement).offsetHeight, width: (el as HTMLElement).offsetWidth, line: parseFloat(cs.fontSize) * 1.2 };
    });
    expect(metrics.height).toBeLessThan(metrics.line * 1.5); // still a single line
    expect(metrics.width).toBeGreaterThan(metrics.height * 3);
    const box = (await page.locator("[data-object-type=added-text]").boundingBox())!;
    expect(box.height).toBeGreaterThan(box.width); // the box is turned with the page
  });
});

test.describe("PDF Editor: underline and strikethrough as a flat drag", () => {
  test("dragging straight along a line (almost no height) still creates the underline / strikethrough", async ({ page }) => {
    await openFile(page, path.join(FIXTURES, "sample-a.pdf"));
    const sb = await surfaceBox(page);
    await page.getByRole("button", { name: "Underline", exact: true }).click();
    await drag(page, sb.x + 40, sb.y + 120, sb.x + 220, sb.y + 122, 6);
    await expect(page.locator("[data-object-type=annotation]")).toHaveCount(1);
    await page.getByRole("button", { name: "Strike", exact: true }).click();
    await drag(page, sb.x + 40, sb.y + 180, sb.x + 220, sb.y + 181, 6);
    await expect(page.locator("[data-object-type=annotation]")).toHaveCount(2);
    // The underline sits on the dragged line (its bottom edge), the strikethrough through it.
    const [u, s] = await Promise.all([
      page.locator("[data-object-type=annotation]").nth(0).boundingBox(),
      page.locator("[data-object-type=annotation]").nth(1).boundingBox(),
    ]);
    expect(Math.abs(u!.y + u!.height - (sb.y + 121))).toBeLessThan(3); // bottom ≈ dragged y (within a few px)
    expect(Math.abs(s!.y + s!.height / 2 - (sb.y + 180.5))).toBeLessThan(3);
  });
});

test.describe("PDF Editor: typing right after placing text", () => {
  test("the first character typed immediately after clicking is not lost", async ({ page }) => {
    await openFile(page, path.join(FIXTURES, "sample-a.pdf"));
    const sb = await surfaceBox(page);
    await page.getByRole("button", { name: "Text", exact: true }).click();
    await page.mouse.click(sb.x + 60, sb.y + 320);
    await page.keyboard.type("Reviewed by QA"); // no waiting for the editor to appear
    await expect(page.getByTestId("canvas-text-editor")).toHaveValue("Reviewed by QA");
  });

  test("typing across a pause (e.g. thinking mid-sentence) never loses what was already typed", async ({ page }) => {
    await openFile(page, path.join(FIXTURES, "sample-a.pdf"));
    const sb = await surfaceBox(page);
    await page.getByRole("button", { name: "Text", exact: true }).click();
    await page.mouse.click(sb.x + 60, sb.y + 320);
    const editor = page.getByTestId("canvas-text-editor");
    await expect(editor).toBeFocused();

    await page.keyboard.type("Reviewed by"); // replaces the auto-selected placeholder ("New text")
    await expect(editor).toHaveValue("Reviewed by");
    await page.waitForTimeout(300);
    await page.keyboard.type(" audit");

    await expect(editor).toHaveValue("Reviewed by audit");
  });
});

test.describe("PDF Editor: pages that carry a CropBox", () => {
  test("the page is laid out on its visible (cropped) area, and the crop survives a round trip", async ({ page }) => {
    const doc = await PDFDocument.create();
    const p = doc.addPage([612, 792]);
    p.drawText("Cropped source page", { x: 80, y: 700, size: 18 });
    p.setCropBox(50, 100, 400, 500);
    const file = test.info().outputPath("with-cropbox.pdf");
    fs.writeFileSync(file, await doc.save());
    await openFile(page, file);
    await page.getByRole("button", { name: "Zoom in", exact: true }).waitFor();
    const sb = await surfaceBox(page);
    // 400 x 500 pt at the current zoom — not the 612 x 792 MediaBox.
    expect(Math.abs(sb.width / sb.height - 400 / 500)).toBeLessThan(0.02);
    const bytes = await exportAndSave(page, "with-cropbox-out.pdf");
    const out = (await PDFDocument.load(bytes)).getPage(0).getCropBox();
    expect(Math.round(out.x)).toBe(50);
    expect(Math.round(out.width)).toBe(400);
  });
});

test.describe("PDF Editor on a phone", () => {
  test("opens fit to the screen, has finger-sized controls, and both drawers can be closed and used", async ({ page, isMobile }) => {
    test.skip(!isMobile, "phone layout only");
    await openFile(page, path.join(FIXTURES, "multi-page.pdf"), { actualSize: false });
    const vp = page.viewportSize()!;
    const sb = await surfaceBox(page);
    expect(sb.x + sb.width).toBeLessThanOrEqual(vp.width); // fit to width: no sideways panning to reach the page
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);

    for (const name of ["Select", "Highlight", "Undo", "Zoom in", "Export PDF"]) {
      const box = (await page.getByRole("button", { name: new RegExp(`^${name}`) }).first().boundingBox())!;
      expect(Math.min(box.width, box.height), `${name} touch target`).toBeGreaterThanOrEqual(40);
    }

    // Pages drawer: closable, and the rotate control on the first page isn't covered by the close button.
    await page.getByRole("button", { name: /^Pages/ }).click();
    const close = page.getByRole("button", { name: "Close panel" });
    await expect(close).toBeVisible();
    await page.getByRole("button", { name: "Rotate page 1 clockwise" }).tap();
    await close.tap();
    await expect(close).toBeHidden();

    await page.getByRole("button", { name: /^Properties/ }).click();
    await expect(close).toBeVisible();
    await close.tap();
    await expect(close).toBeHidden();
  });
});

test.describe("PDF Editor: a page wider than its viewport", () => {
  test("the page keeps its size (and its drawing overlay matches its canvas) and scrolls instead of being squeezed", async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 800 });
    await openFile(page, path.join(FIXTURES, "multi-page.pdf")); // wider than the viewport at 100%
    await expect.poll(async () => (await surfaceBox(page)).width, { timeout: 20_000 }).toBeGreaterThan(480); // wider than the 480px viewport

    // The page's own <canvas> is rendered asynchronously (pdf.js rasterization) and is swapped out
    // for a fresh one on every scale change — including the auto-fit pass this wide page triggers on
    // load — via a plain `host.innerHTML = ""; host.appendChild(canvas)`. So a canvas can briefly not
    // exist in the DOM even after the *container* (sized synchronously from `spec.scale`) has already
    // settled at its final width. Poll the canvas itself, not just its container, so the assertion
    // below only ever reads a canvas that is actually present and already at its final size.
    const canvas = page.locator('[data-testid="page-surface"] canvas').first();
    await expect.poll(async () => (await canvas.boundingBox())?.width ?? 0, { timeout: 20_000 }).toBeGreaterThan(480);

    const surfaceWidth = (await surfaceBox(page)).width;
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error("page canvas disappeared between the poll and the final read");
    expect(Math.abs(surfaceWidth - canvasBox.width)).toBeLessThan(1.5);
  });
});

// Real touch input (Chromium's touch event dispatch, which the browser turns into pointer events with
// pointerType "touch") on the phone layout. Physical-device testing is separate; this is the closest
// automated equivalent.
test.describe("PDF Editor on a phone: touch input", () => {
  async function touchTools(page: Page) {
    const cdp = await page.context().newCDPSession(page);
    const send = (type: "touchStart" | "touchMove" | "touchEnd", pts: [number, number][]) =>
      cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i, radiusX: 2, radiusY: 2, force: 1 })) });
    return {
      async path(points: [number, number][], onMiddle?: () => Promise<void>) {
        await send("touchStart", [points[0]]);
        for (let i = 1; i < points.length; i++) {
          await send("touchMove", [points[i]]);
          if (onMiddle && i === Math.floor(points.length / 2)) await onMiddle();
        }
        await send("touchEnd", []);
        // Chromium swallows the first tap after a touch drag on a pointer-captured surface (reproduced on a
        // bare page); absorb it on the header so the next real tap lands.
        await page.touchscreen.tap(2, 2);
      },
      line(from: [number, number], to: [number, number], steps = 8): [number, number][] {
        return Array.from({ length: steps + 1 }, (_, i) => [from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps] as [number, number]);
      },
    };
  }

  test("tap places text and typing works; highlight/underline stay armed; strokes render live; crop applies", async ({ page, isMobile }) => {
    test.skip(!isMobile, "phone layout only");
    await openFile(page, path.join(FIXTURES, "multi-page.pdf"), { actualSize: false });
    const touch = await touchTools(page);
    const sb = await surfaceBox(page);
    const tool = async (name: string) => {
      const btn = page.getByRole("button", { name, exact: true });
      await btn.tap();
      if ((await btn.getAttribute("aria-pressed")) === "false") await btn.tap();
    };

    // Text: tap, type, tap away.
    await tool("Text");
    await page.touchscreen.tap(sb.x + 100, sb.y + sb.height * 0.6);
    await page.getByTestId("canvas-text-editor").waitFor();
    await page.keyboard.type("Typed on a phone");
    await page.touchscreen.tap(sb.x + sb.width - 6, sb.y + 6);
    await expect(page.locator("[data-object-type=added-text]")).toContainText("Typed on a phone");

    // Highlight ×3, then underline ×3, each without reselecting the tool.
    await tool("Highlight");
    for (let i = 0; i < 3; i++) await touch.path(touch.line([sb.x + 20, sb.y + 30 + i * 26], [sb.x + 180, sb.y + 44 + i * 26], 6));
    await expect(page.getByRole("button", { name: "Highlight", exact: true })).toHaveAttribute("aria-pressed", "true");
    await tool("Underline");
    for (let i = 0; i < 3; i++) await touch.path(touch.line([sb.x + 20, sb.y + 130 + i * 20], [sb.x + 180, sb.y + 131 + i * 20], 6)); // flat drags
    await expect(page.locator("[data-object-type=annotation]")).toHaveCount(6);

    // A freehand stroke is visible while the finger is still down.
    await tool("Draw");
    let liveDuring = 0;
    await touch.path(
      Array.from({ length: 12 }, (_, i) => [sb.x + 30 + i * 12, sb.y + sb.height * 0.75 + Math.sin(i / 2) * 12] as [number, number]),
      async () => {
        liveDuring = await page.locator("[data-testid=live-stroke]").count();
      }
    );
    expect(liveDuring).toBe(1);
    await expect(page.locator("[data-object-type=drawing]")).toHaveCount(1);

    // A rectangle lands exactly where it was dragged.
    await tool("Rectangle");
    const [x0, y0, x1, y1] = [sb.x + 40, sb.y + sb.height * 0.85, sb.x + 140, sb.y + sb.height * 0.85 + 40];
    await touch.path(touch.line([x0, y0], [x1, y1], 6));
    const r = (await page.locator("[data-object-type=shape]").last().boundingBox())!;
    for (const [a, b] of [[r.x, x0], [r.y, y0], [r.x + r.width, x1], [r.y + r.height, y1]]) expect(Math.abs(a - b)).toBeLessThan(2);

    // Crop by touch, applied from the action bar, and it reaches the exported file.
    await tool("Crop");
    const cb = await surfaceBox(page); // the page may have scrolled while drawing
    const viewportHeight = page.viewportSize()!.height;
    await touch.path(touch.line([cb.x + 10, cb.y + 10], [cb.x + cb.width - 20, Math.min(cb.y + cb.height - 40, viewportHeight - 60)], 8)); // stay on screen
    await page.getByRole("button", { name: "Keep this area" }).tap();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0); // no sideways scroll
    const bytes = await exportAndSave(page, "touch-session.pdf");
    const first = (await PDFDocument.load(bytes)).getPage(0);
    expect(first.getCropBox().width).toBeLessThan(first.getMediaBox().width);
    expect((await pdfTextItems(bytes, 1)).map((i) => i.str).join(" ")).toContain("Typed on a phone");
  });
});
