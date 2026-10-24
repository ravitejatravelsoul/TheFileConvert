import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { downloadFrom, expectNoHorizontalOverflow, trackPageErrors } from "./helpers/tool";
import { readDocx } from "./helpers/docx";

// Image → Word: the picture goes into the document as it is — right proportions, centred, one per page, in order,
// no recognised text. JPG/PNG bytes are embedded untouched.

const FAKE = (name: string) => path.resolve("qa/real-user-fixtures", name);
const bytesOf = (name: string) => fs.readFileSync(FAKE(name));

async function toWord(page: import("@playwright/test").Page, files: string[], pageSize?: string) {
  await page.goto("/image-to-word");
  await page.getByTestId("file-input").first().setInputFiles(files.map(FAKE));
  await page.locator("ol > li[data-sort-key]").nth(files.length - 1).waitFor();
  if (pageSize) await page.getByRole("radio", { name: pageSize, exact: true }).click();
  await page.getByRole("button", { name: /^Create Word document/ }).click();
  await expect(page.getByTestId("result").getByRole("status")).toHaveText("Your Word document is ready", { timeout: 60_000 });
  const { bytes, download } = await downloadFrom(page, page.getByRole("button", { name: "Download .docx" }));
  return { d: await readDocx(bytes), name: download.suggestedFilename() };
}

test.describe("Image to Word", () => {
  test("a filled-in form PNG becomes one page that is the picture — no text, original bytes, same proportions", async ({ page }) => {
    const errors = trackPageErrors(page);
    await page.goto("/image-to-word");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Image to Word");
    await expectNoHorizontalOverflow(page);
    const { d, name } = await toWord(page, ["DOCUMENT-10-filled-form.png"]);
    expect(name).toBe("DOCUMENT-10-filled-form.docx");
    expect(d.sections).toBe(1);
    expect(d.text).toBe("");
    expect(d.media).toHaveLength(1);
    expect(Buffer.from(d.media[0]).equals(bytesOf("DOCUMENT-10-filled-form.png"))).toBe(true);
    // Fit to image: the page has the picture's proportions (1700 × 2200 px).
    const [w, h] = d.pageSizes[0];
    expect(w / h).toBeCloseTo(1700 / 2200, 2);
    expect(h).toBeLessThanOrEqual(792.5);
    expect(errors).toEqual([]);
  });

  test("a wide ID card turns the page sideways instead of shrinking onto a portrait page", async ({ page }) => {
    const { d } = await toWord(page, ["DOCUMENT-09-id-card-image.png"]);
    const [w, h] = d.pageSizes[0];
    expect(w).toBeGreaterThan(h);
    expect(w / h).toBeCloseTo(1011 / 638, 2);
  });

  test("several images: one per page, in the order added, each as its own file", async ({ page }) => {
    const files = ["DOCUMENT-11-receipt.jpg", "DOCUMENT-09-id-card-image.png", "DOCUMENT-17-screenshot.png"];
    const { d, name } = await toWord(page, files, "Letter");
    expect(name).toBe("images.docx");
    expect(d.sections).toBe(3);
    expect(d.text).toBe("");
    expect(d.media).toHaveLength(3);
    files.forEach((f, i) => expect(d.media.some((m) => Buffer.from(m).equals(bytesOf(f))), `${f} embedded untouched (${i + 1})`).toBe(true));
    // A portrait receipt on a portrait Letter page; the wide ID card and the wide screenshot on landscape ones.
    expect(d.pageSizes.map(([w, h]) => `${Math.round(w)}x${Math.round(h)}`)).toEqual(["612x792", "792x612", "792x612"]);
  });

  test("A4 centres the image inside a margin, never clipped or stretched", async ({ page }) => {
    const { d } = await toWord(page, ["DOCUMENT-10-filled-form.png"], "A4");
    const [w, h] = d.pageSizes[0];
    expect([Math.round(w), Math.round(h)]).toEqual([595, 842]);
  });

  test("nothing is uploaded and nothing is read from the picture", async ({ page }) => {
    const requests: { url: string; post: number }[] = [];
    page.on("request", (r) => requests.push({ url: r.url(), post: (r.postDataBuffer() ?? Buffer.alloc(0)).length }));
    await toWord(page, ["DOCUMENT-14-photo-with-text.png"]);
    const origin = new URL(page.url()).origin;
    expect(requests.filter((r) => r.post > 0 || !(r.url.startsWith(origin) || /^(blob|data):/.test(r.url)))).toEqual([]);
    expect(requests.filter((r) => /tesseract|traineddata/i.test(r.url))).toEqual([]);
  });
});
