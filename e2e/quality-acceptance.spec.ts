import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { test, expect, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { createCanvas, loadImage } from "@napi-rs/canvas";

// Regression coverage for defects found by the product-quality acceptance pass: each test drives the real UI
// and checks what the downloaded file actually contains (not just that a button produced *a* file).
// Fixtures come from scripts/qa-fixtures.mjs (deterministic; large ones are generated on demand).

const QA = path.join(__dirname, "fixtures", "qa");
const need = [
  "pdf-multipage.pdf",
  "pdf-rotations.pdf",
  "pdf-dup-images.pdf",
  "pdf-scanned-small.pdf",
  "img-quadrants.png",
  "img-photo-transparent.png",
  "img-photo-small-optimized.jpg",
  "pdf-metadata.pdf",
];
test.beforeAll(() => {
  if (need.some((f) => !fs.existsSync(path.join(QA, f)))) {
    execFileSync(process.execPath, [path.join(__dirname, "..", "scripts", "qa-fixtures.mjs")], { cwd: path.join(__dirname, "..") });
  }
});

const fixture = (name: string) => path.join(QA, name);

async function upload(page: Page, route: string, ...files: string[]) {
  await page.goto(route);
  await page.locator('input[type="file"]').first().setInputFiles(files.map(fixture));
}

async function download(page: Page, name: string | RegExp): Promise<Buffer> {
  const [d] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name }).first().click()]);
  const p = test.info().outputPath(d.suggestedFilename());
  await d.saveAs(p);
  return fs.readFileSync(p);
}

async function pdfTexts(bytes: Buffer): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), disableFontFace: true }).promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) out.push((await (await doc.getPage(i)).getTextContent()).items.map((x) => ("str" in x ? x.str : "")).join(" "));
  return out;
}

const pageNumbers = (texts: string[]) => texts.map((t) => Number((t.match(/Page (\d+) of/) ?? [0, 0])[1]));

async function pixelAt(png: Buffer, x: number, y: number) {
  const img = await loadImage(png);
  const c = createCanvas(img.width, img.height);
  c.getContext("2d").drawImage(img, 0, 0);
  return Array.from(c.getContext("2d").getImageData(x, y, 1, 1).data);
}

test.describe("PDF merge / reorder", () => {
  test("merge: files can be reordered in the list, and the output follows that order", async ({ page }) => {
    await upload(page, "/pdf/merge", "pdf-multipage.pdf", "pdf-rotations.pdf");
    await page.getByRole("button", { name: "Move pdf-rotations.pdf up" }).click();
    await page.getByRole("button", { name: /^Merge 2 PDFs/ }).click();
    await page.getByText("Done!").waitFor();
    const texts = await pdfTexts(await download(page, /^Download/));
    expect(texts).toHaveLength(10);
    expect(texts[0]).toContain("Page 1 of 4"); // the 4-page file came first
    expect(texts[4]).toContain("Page 1 of 6");
  });

  test("reorder: pages show thumbnails, and drag-and-drop plus an arrow give the exported order", async ({ page, isMobile }) => {
    test.skip(isMobile, "HTML5 drag-and-drop is exercised on desktop; the arrow buttons are covered on every project below");
    await upload(page, "/pdf/reorder", "pdf-multipage.pdf");
    await expect(page.locator("li[data-page] img")).toHaveCount(6, { timeout: 20_000 });
    await page.locator('li[data-page="6"]').dragTo(page.locator('li[data-page="2"]'));
    await page.getByRole("button", { name: "Move page 1 later" }).click();
    await page.getByRole("button", { name: /Export reordered PDF/ }).click();
    await page.getByText("Done!").waitFor();
    expect(pageNumbers(await pdfTexts(await download(page, /^Download/)))).toEqual([6, 1, 2, 3, 4, 5]);
  });

  test("reorder: arrows are labelled per page and move that page", async ({ page }) => {
    await upload(page, "/pdf/reorder", "pdf-multipage.pdf");
    await page.getByRole("button", { name: "Move page 3 earlier" }).click();
    await expect(page.locator("li[data-page]").nth(1)).toHaveAttribute("data-page", "3");
    await page.getByRole("button", { name: /Export reordered PDF/ }).click();
    await page.getByText("Done!").waitFor();
    expect(pageNumbers(await pdfTexts(await download(page, /^Download/)))).toEqual([1, 3, 2, 4, 5, 6]);
  });
});

test.describe("PDF pages keep their displayed orientation", () => {
  test("PDF to images: a page stored rotated 90 degrees comes out landscape", async ({ page }) => {
    await upload(page, "/pdf/to-images", "pdf-rotations.pdf");
    await page.getByRole("button", { name: /^Convert to images/ }).click();
    await page.getByText("Done!").waitFor();
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(await download(page, /Download all as ZIP/));
    const sizes: string[] = [];
    for (const name of Object.keys(zip.files).sort()) {
      const img = await loadImage(Buffer.from(await zip.files[name].async("uint8array")));
      sizes.push(`${img.width}x${img.height}`);
    }
    expect(sizes).toEqual(["1224x1584", "1584x1224", "1224x1584", "1584x1224"]);
  });

  test("page numbers land at the displayed bottom of a rotated page, not its stored bottom", async ({ page }) => {
    await upload(page, "/pdf/page-numbers", "pdf-rotations.pdf");
    await page.getByRole("button", { name: /^Add page numbers/ }).click();
    await page.getByText("Done!").waitFor();
    const bytes = await download(page, /^Download/);
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), disableFontFace: true }).promise;
    const p2 = await doc.getPage(2); // stored with /Rotate 90 -> displayed landscape
    const vp = p2.getViewport({ scale: 1 });
    const items = (await p2.getTextContent()).items.filter((i) => "str" in i && i.str.trim() === "2") as { transform: number[] }[];
    expect(items.length).toBeGreaterThan(0);
    const last = items[items.length - 1];
    const [x, y] = vp.convertToViewportPoint(last.transform[4], last.transform[5]);
    expect(Math.abs(x - vp.width / 2)).toBeLessThan(30); // horizontally centred as displayed
    expect(y).toBeGreaterThan(vp.height - 50); // and at the bottom as displayed (viewport y grows downward)
  });

  test("watermark text the PDF fonts cannot draw gives a plain-language message, not an encoding error", async ({ page }) => {
    await upload(page, "/pdf/watermark", "pdf-multipage.pdf");
    await page.locator("input[type=text], input:not([type])").first().fill("Done ✓");
    await page.getByRole("button", { name: /^Add watermark/ }).click();
    await expect(page.getByText(/can't draw/)).toBeVisible();
    await expect(page.getByText(/WinAnsi/)).toHaveCount(0);
  });
});

test.describe("PDF compress tells the truth", () => {
  test("shows what the file contains first, merges duplicate images losslessly, reports real sizes", async ({ page }) => {
    await upload(page, "/pdf/compress", "pdf-dup-images.pdf");
    await expect(page.getByText(/exact repeats/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/4 embedded images/)).toBeVisible();
    await page.getByLabel(/^Lossless/).check();
    await page.getByRole("button", { name: /^Compress / }).click();
    await page.getByText("Done!").waitFor();
    await expect(page.getByText(/Merged 3 duplicate images/)).toBeVisible();
    const out = await download(page, /^Download/);
    expect(out.length).toBeLessThan(fs.statSync(fixture("pdf-dup-images.pdf")).size * 0.4);
    expect((await PDFDocument.load(out)).getPageCount()).toBe(4);
  });

  test("an image-only scan barely changes losslessly (and says so first) but shrinks a lot when the user opts into lower quality", async ({ page }) => {
    const original = fs.statSync(fixture("pdf-scanned-small.pdf")).size;
    await upload(page, "/pdf/compress", "pdf-scanned-small.pdf");
    await expect(page.getByText(/Lossless optimization will barely change/)).toBeVisible({ timeout: 20_000 });
    await page.getByLabel(/^Lossless/).check();
    await page.getByRole("button", { name: /^Compress / }).click();
    await page.getByText("Done!").waitFor();
    await expect(page.getByText("No significant change")).toBeVisible();
    await expect(page.getByText(/little left to squeeze/)).toBeVisible();

    await upload(page, "/pdf/compress", "pdf-scanned-small.pdf");
    await page.getByLabel(/^Balanced/).check();
    await page.getByRole("button", { name: /^Compress / }).click();
    await page.getByText("Done!").waitFor();
    await expect(page.getByText(/Re-encoded 2 images at reduced quality/)).toBeVisible();
    const out = await download(page, /^Download/);
    expect(out.length).toBeLessThan(original * 0.7);
    expect((await PDFDocument.load(out)).getPageCount()).toBe(2);
  });
});

test.describe("Image tools protect transparency and say what they did", () => {
  test("compress: a transparent PNG defaults to a format that keeps transparency", async ({ page }) => {
    await upload(page, "/image/compress", "img-photo-transparent.png");
    await expect(page.locator("select").first()).toHaveValue("webp");
    await page.getByRole("button", { name: /^Compress 1 image/ }).click();
    await page.getByText("Done!").waitFor();
    expect((await pixelAt(await download(page, /^Download/), 2, 2))[3]).toBeLessThan(10);
  });

  test("compress: choosing JPG for a transparent image warns first, and fills white rather than black", async ({ page }) => {
    await upload(page, "/image/compress", "img-photo-transparent.png");
    await page.locator("select").first().selectOption("jpeg");
    await expect(page.getByRole("note").first()).toContainText(/transparent areas/);
    await page.getByRole("button", { name: /^Compress 1 image/ }).click();
    await page.getByText("Done!").waitFor();
    const [r, g, b] = await pixelAt(await download(page, /^Download/), 2, 2);
    expect(Math.min(r, g, b)).toBeGreaterThan(240);
  });

  test("compress: an already-optimized JPG comes back unchanged instead of larger", async ({ page }) => {
    await upload(page, "/image/compress", "img-photo-small-optimized.jpg");
    await page.getByRole("button", { name: /^Compress 1 image/ }).click();
    await page.getByText("Done!").waitFor();
    await expect(page.getByText(/original is returned unchanged/)).toBeVisible();
    expect((await download(page, /^Download/)).equals(fs.readFileSync(fixture("img-photo-small-optimized.jpg")))).toBe(true);
  });

  test("resize, rotate and crop keep a PNG a PNG by default", async ({ page }) => {
    for (const route of ["/image/resize", "/image/rotate", "/image/crop"]) {
      await upload(page, route, "img-photo-transparent.png");
      await expect(page.locator("select").last()).toHaveValue("png");
    }
  });

  test("crop: dragging on the preview draws the box under the pointer and crops exactly that region", async ({ page, isMobile }) => {
    test.skip(isMobile, "mouse drag; the touch path shares the same pointer handlers");
    await upload(page, "/image/crop", "img-quadrants.png");
    await page.locator("select").last().selectOption("png");
    const preview = page.getByTestId("crop-preview");
    await expect(preview).toBeVisible();
    const box = (await preview.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.1);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 10 });
    await page.mouse.up();
    const rect = (await page.getByTestId("crop-rect").boundingBox())!;
    expect(Math.abs(rect.x - (box.x + box.width * 0.1))).toBeLessThan(2);
    expect(Math.abs(rect.x + rect.width - (box.x + box.width * 0.6))).toBeLessThan(2);
    await page.getByRole("button", { name: /^Crop image/ }).click();
    await page.getByText("Done!").waitFor();
    const img = await loadImage(await download(page, /^Download/));
    expect(`${img.width}x${img.height}`).toBe("200x150"); // 10%..60% of 400x300
  });
});

test.describe("PDF metadata removal", () => {
  test("clears every document-information entry and keeps the content", async ({ page }) => {
    await upload(page, "/pdf/metadata", "pdf-metadata.pdf");
    await expect(page.getByText("QA Author")).toBeVisible();
    await page.getByRole("button", { name: /^Remove metadata/ }).click();
    await page.getByText("Done!").waitFor();
    const out = await download(page, /^Download/);
    const doc = await PDFDocument.load(out, { updateMetadata: false });
    expect([doc.getTitle(), doc.getAuthor(), doc.getSubject(), doc.getCreator(), doc.getProducer()]).toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect(doc.getPageCount()).toBe(2);
    expect(out.toString("latin1")).not.toContain("QA Author");
  });
});

test.describe("Text tools", () => {
  const run = async (page: Page, route: string, input: string, button: RegExp) => {
    await page.goto(route);
    await page.locator("main textarea").first().fill(input);
    await page.getByRole("button", { name: button }).click();
  };

  test("CSV with an unclosed quote is reported, not silently mangled", async ({ page }) => {
    await run(page, "/data/csv-to-json", 'a,b\n"unterminated,1\n', /^Convert/);
    await expect(page.getByText(/never closed/)).toBeVisible();
  });

  test("JSON to CSV writes nested values as JSON text, never [object Object]", async ({ page }) => {
    await run(page, "/data/json-to-csv", '[{"a":{"b":1},"c":[1,2]}]', /^Convert/);
    const out = await page.locator("main textarea").nth(1).inputValue();
    expect(out).not.toContain("[object Object]");
    expect(out).toContain('"{""b"":1}"');
  });

  test("XML pretty-print keeps the xml declaration", async ({ page }) => {
    await run(page, "/data/xml-formatter", '<?xml version="1.0" encoding="UTF-8"?><a><b>1</b></a>', /^Format/);
    expect(await page.locator("main textarea").nth(1).inputValue()).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>\n<a>/);
  });

  test("case converter keeps accented letters", async ({ page }) => {
    await page.goto("/data/case-converter");
    await page.locator("select").first().selectOption({ label: "kebab-case" });
    await page.locator("main textarea").first().fill("café au lait, it's Ünïcode");
    await page.getByRole("button", { name: /^Convert case/ }).click();
    expect(await page.locator("main textarea").nth(1).inputValue()).toBe("café-au-lait-its-ünïcode");
  });

  test("text diff says when the two texts are identical", async ({ page }) => {
    await page.goto("/data/text-diff");
    const tas = page.locator("main textarea");
    await tas.nth(0).fill("same\ntext");
    await tas.nth(1).fill("same\ntext");
    await page.getByRole("button", { name: /^Compare/ }).click();
    await expect(page.getByText(/No differences/)).toBeVisible();
  });
});

test.describe("Documents", () => {
  test("TXT to PDF: characters the PDF fonts cannot draw are reported, not turned into an encoding error", async ({ page }) => {
    await page.goto("/document/txt-to-pdf");
    await page.locator("main textarea").first().fill("Done ✓ and 日本語");
    await page.getByRole("button", { name: /^Convert/ }).click();
    await expect(page.getByText(/is ready/)).toBeVisible();
    await expect(page.getByRole("note")).toContainText(/replaced with "\?"/);
    await expect(page.getByText(/WinAnsi/)).toHaveCount(0);
    expect((await PDFDocument.load(await download(page, /^Download/))).getPageCount()).toBe(1);
  });

  test("editing the text after converting drops the stale Download button", async ({ page }) => {
    await page.goto("/document/txt-to-pdf");
    await page.locator("main textarea").first().fill("first version");
    await page.getByRole("button", { name: /^Convert/ }).click();
    await expect(page.getByRole("button", { name: /^Download/ })).toBeVisible();
    await page.locator("main textarea").first().fill("second version");
    await expect(page.getByRole("button", { name: /^Download/ })).toHaveCount(0);
  });

  test("Markdown to HTML: tables render, snake_case survives, and javascript: links are removed", async ({ page }) => {
    await page.goto("/document/markdown-to-html");
    await page.locator("main textarea").first().fill("| A | B |\n| - | - |\n| 1 | 2 |\n\nuse my_var_name [bad](javascript:alert(1)) [ok](https://example.com)");
    await page.getByRole("button", { name: /^Convert/ }).click();
    const html = await page.locator("main textarea").nth(1).inputValue();
    expect(html).toContain("<table>");
    expect(html).toContain("my_var_name");
    expect(html).not.toMatch(/javascript:/i);
    expect(html).toContain('href="https://example.com"');
  });
});

test.describe("Home page", () => {
  test("the file chosen on the home page is already loaded in the tool it leads to, and specific tools come first", async ({ page }) => {
    await page.goto("/");
    await page.locator('input[type="file"]').first().setInputFiles(fixture("img-quadrants.png"));
    const first = page.locator("p:has-text('Available actions') + div a").first();
    await expect(first).toHaveAttribute("href", /\/convert\/png-to-/); // a PNG-specific converter outranks generic image tools
    await page.getByRole("button", { name: /^Show all \d+ tools/ }).click();
    await page.locator("p:has-text('Available actions') + div a[href='/image/compress']").click();
    await expect(page).toHaveURL(/\/image\/compress/);
    await expect(page.getByText("img-quadrants.png")).toBeVisible();
  });
});

test.describe("Editor search reflects edits", () => {
  test("search finds corrected native text and typed text, and no longer finds the text that was replaced", async ({ page, isMobile }) => {
    test.skip(isMobile, "search lives in the side panel; the drawer flow is covered elsewhere");
    await upload(page, "/pdf/editor", "pdf-multipage.pdf");
    await expect(page.locator('[data-testid="page-surface"]').first()).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: /Edit text: Page 1 of 6/ }).first().click();
    const dialog = page.getByRole("dialog", { name: "Edit text" });
    await dialog.locator("input[type=text], textarea").first().fill("Chapter ONE of 6");
    await dialog.getByRole("button", { name: /^Save/ }).click();
    await page.locator("summary", { hasText: /^Search/ }).click();
    const search = page.getByLabel("Search document text");
    await search.fill("Chapter ONE");
    await expect(page.getByText("1 of 1").first()).toBeVisible();
    await search.fill("Page 1 of 6");
    await expect(page.getByText("No matches")).toBeVisible();
  });
});
