// Mobile acceptance on a Pixel 7 profile: taps and real touch drags (CDP touch events) through the main flows.
//   node qa/scripts/fl-mobile.mjs
import { launch, open, download, size, pdfInfo, rec, save, shot, fx, fs } from "./fl-lib.mjs";
const only = process.argv[2];
import { PDFDocument } from "pdf-lib";

const { browser, ctx, page, errors } = await launch({ mobile: true });
const cdp = await ctx.newCDPSession(page);
let touchId = 1;

/** One real finger gesture: touchStart → touchMoves → touchEnd, each gesture with its own touch id. */
async function touchDrag([x0, y0], [x1, y1], steps = 12) {
  const id = touchId++;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0, id }] });
  for (let i = 1; i <= steps; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + ((x1 - x0) * i) / steps, y: y0 + ((y1 - y0) * i) / steps, id }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(300);
  // Chrome drops the click of the first tap that follows a synthetic CDP touch sequence — shown by
  // qa/scripts/touch-diagnostic.mjs to happen even when the drag touched no app element at all. A throwaway
  // tap in the empty left gutter absorbs it, so the real taps that follow are counted.
  await page.touchscreen.tap(4, 400);
  await page.waitForTimeout(200);
}
const centre = (b) => [b.x + b.width / 2, b.y + b.height / 2];
async function noOverflow(label) {
  const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (o > 0) throw new Error(`${label}: horizontal overflow ${o}px`);
}
async function step(tool, test, fn) {
  try {
    await fn();
  } catch (e) {
    const shotName = `fail-${tool.replace(/\W+/g, "-")}.png`;
    await page.screenshot({ path: `qa/evidence/fresh/out/${shotName}` }).catch(() => {});
    rec(tool, test, "FAIL", { error: String(e).slice(0, 400), screenshot: shotName });
  }
}
async function tapChoose(buttonName, files) {
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: buttonName }).first().tap()]);
  await chooser.setFiles(files.map(fx));
}

await step("Homepage (mobile)", "tap Choose file → smart suggestions → Compress PDF custom 700 KB", async () => {
  await open(page, "/");
  await noOverflow("home");
  await shot(page, "02-homepage-mobile.png");
  await shot(page, "02b-homepage-mobile-full.png", { full: true });
  await tapChoose("Choose file", ["FL-PDF-02-scan-4mb.pdf"]);
  await page.getByText("What do you want to do?").waitFor();
  await shot(page, "02c-homepage-mobile-suggestions.png");
  await page.getByRole("button", { name: /^Compress$/ }).tap();
  await page.waitForURL(/\/compress-pdf$/);
  await page.getByText("How small do you need it?").waitFor();
  await page.getByRole("radio", { name: "Custom", exact: true }).tap();
  await page.getByLabel("Custom target size").fill("700");
  await page.getByRole("radio", { name: "KB", exact: true }).tap();
  await noOverflow("compress-pdf");
  await page.getByRole("button", { name: /^Compress to under 700 KB/ }).tap();
  await page.getByTestId("result").waitFor({ timeout: 300_000 });
  const out = await download(page, page.getByRole("button", { name: /^Download/ }), "m-cpdf");
  const info = await pdfInfo(out);
  rec("Compress PDF", "mobile: homepage hand-off + custom 700 KB", size(out) <= 700_000 && info.pages === 3 ? "PASS" : "FAIL", { output: size(out), pages: info.pages });
});

await step("Compress Image", "mobile: custom 300 KB", async () => {
  await open(page, "/compress-image");
  await tapChoose("Choose image", ["FL-IMG-01-large.jpg"]);
  await page.getByRole("radio", { name: "Custom", exact: true }).tap();
  await page.getByLabel("Custom target size").fill("300");
  await page.getByRole("radio", { name: "KB", exact: true }).tap();
  await page.getByRole("button", { name: /^Compress to under 300 KB/ }).tap();
  await page.getByTestId("result").waitFor({ timeout: 300_000 });
  await noOverflow("compress-image result");
  await shot(page, "06c-compress-image-mobile.png");
  const out = await download(page, page.getByRole("button", { name: /^Download/ }), "m-cimg");
  rec("Compress Image", "mobile: custom 300 KB", size(out) <= 300_000 ? "PASS" : "FAIL", { output: size(out) });
});

await step("Image Converter", "mobile: WebP → JPG", async () => {
  await open(page, "/convert-image");
  await tapChoose("Choose images", ["FL-IMG-05-photo.webp"]);
  await page.getByRole("radio", { name: /^JPG/ }).tap();
  await noOverflow("converter");
  await page.getByRole("button", { name: "Convert to JPG" }).tap();
  await page.getByTestId("result").waitFor();
  const out = await download(page, page.getByRole("button", { name: "Download JPG" }), "m-conv");
  const head = fs.readFileSync(out).subarray(0, 2);
  rec("Image Converter", "mobile: WebP → JPG", head[0] === 0xff && head[1] === 0xd8 ? "PASS" : "FAIL", { output: size(out) });
});

await step("Merge PDF", "mobile: touch-drag reorder then merge", async () => {
  await open(page, "/merge-pdf");
  await tapChoose("Choose PDFs", ["FL-PDF-09a-merge.pdf", "FL-PDF-09b-merge.pdf", "FL-PDF-09c-merge.pdf"]);
  await page.getByText("9 pages in total", { exact: false }).waitFor();
  const handle = page.getByRole("button", { name: "Drag FL-PDF-09c-merge.pdf" });
  await handle.scrollIntoViewIfNeeded();
  const from = centre(await handle.boundingBox());
  const to = centre(await page.getByRole("button", { name: "Drag FL-PDF-09a-merge.pdf" }).boundingBox());
  await touchDrag(from, [to[0], to[1] - 6]);
  await noOverflow("merge");
  await shot(page, "10b-merge-mobile.png");
  await page.getByRole("button", { name: "Merge 3 PDFs" }).tap();
  await page.getByTestId("result").waitFor();
  const out = await download(page, page.getByRole("button", { name: "Download merged PDF" }), "m-merge");
  const first = (await pdfInfo(out)).texts[0].match(/(ALPHA|BRAVO|CHARLIE)/)?.[1];
  rec("Merge PDF", "mobile: touch-drag reorder then merge", first === "CHARLIE" ? "PASS" : "FAIL", { firstDocument: first });
});

await step("Organize PDF", "mobile: touch-drag, rotate, delete, save", async () => {
  await open(page, "/organize-pdf");
  await tapChoose("Choose PDF", ["FL-PDF-05-multipage.pdf"]);
  await page.locator("ol > li[data-sort-key]").nth(11).waitFor();
  const h3 = page.getByRole("button", { name: "Drag Page 3", exact: true });
  await h3.scrollIntoViewIfNeeded();
  const from = centre(await h3.boundingBox());
  const to = centre(await page.getByRole("button", { name: "Drag Page 1", exact: true }).boundingBox());
  await touchDrag(from, to);
  await page.getByRole("button", { name: "Rotate Page 2 right", exact: true }).tap();
  await page.getByRole("button", { name: "Delete Page 12", exact: true }).tap();
  await noOverflow("organize");
  await shot(page, "12b-organize-mobile.png");
  await page.getByRole("button", { name: "Save PDF" }).tap();
  await page.getByTestId("result").waitFor();
  const out = await download(page, page.getByRole("button", { name: "Download PDF" }), "m-organize");
  const info = await pdfInfo(out);
  const labels = info.texts.map((t) => (t.match(/Page (\d+) of 12/) ?? [])[1]);
  const ok = labels[0] === "3" && info.pages === 11 && info.rotations[labels.indexOf("2")] === 90;
  rec("Organize PDF", "mobile: touch-drag, rotate, delete, save", ok ? "PASS" : "FAIL", { labels: labels.join(","), rotations: info.rotations.join(",") });
});

await step("PDF Editor", "mobile: OCR, edit word, add text, draw (touch), crop (touch), export", async () => {
  await open(page, "/pdf-editor");
  await tapChoose("Choose PDF", ["FL-PDF-08-scanned-text.pdf"]);
  await page.getByTestId("page-surface").waitFor({ timeout: 60_000 });
  await noOverflow("editor");
  await page.getByRole("button", { name: "Recognize text" }).tap();
  const word = page.getByRole("button", { name: "Edit recognized word: 12/20/2026" }).first();
  await word.waitFor({ timeout: 240_000 });
  await shot(page, "15-editor-mobile.png");
  await word.tap();
  const dlg = page.getByRole("dialog", { name: "Edit text" });
  await dlg.locator("input[type=text]").fill("12/20/2028");
  await dlg.getByRole("button", { name: "Save correction" }).tap();
  await dlg.waitFor({ state: "hidden" });

  const S = await page.getByTestId("page-surface").boundingBox();
  const at = (fx_, fy) => [S.x + S.width * fx_, S.y + S.height * fy];
  await page.getByRole("button", { name: "Text", exact: true }).tap();
  await page.touchscreen.tap(...at(0.15, 0.86));
  await page.keyboard.type("Mobile check");
  const typed = await page.getByTestId("canvas-text-editor").inputValue();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Draw", exact: true }).tap();
  const drawBefore = await page.locator("[data-object-type=drawing]").count();
  await touchDrag(at(0.55, 0.62), at(0.85, 0.7));
  const drawAfter = await page.locator("[data-object-type=drawing]").count();

  await page.getByRole("button", { name: "More", exact: true }).tap();
  await page.getByRole("menuitemradio", { name: "Crop" }).tap();
  await touchDrag(at(0.03, 0.03), at(0.97, 0.9));
  await page.getByRole("button", { name: "Keep this area" }).tap();
  await shot(page, "15b-editor-mobile-edited.png");

  const out = await download(page, page.getByRole("button", { name: "Export PDF" }), "m-editor");
  const info = await pdfInfo(out);
  const doc = await PDFDocument.load(fs.readFileSync(out));
  const crop = doc.getPage(0).getCropBox();
  const ok = /12\/20\/2028/.test(info.texts[0]) && /Mobile check/.test(info.texts[0]) && typed === "Mobile check" && drawAfter === drawBefore + 1 && crop.height < 780;
  rec("PDF Editor", "mobile: OCR, edit word, add text, draw (touch), crop (touch), export", ok ? "PASS" : "FAIL", {
    typed,
    drawings: `${drawBefore}→${drawAfter}`,
    crop: `${Math.round(crop.width)}x${Math.round(crop.height)}`,
    text: info.texts[0].slice(0, 120),
  });
});

await step("Mobile", "tap targets ≥ 44px on the editor dock and top bar", async () => {
  const small = await page.evaluate(() =>
    [...document.querySelectorAll('[role="toolbar"] button, header button, header a')]
      .filter((el) => el.offsetParent !== null)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { name: el.getAttribute("aria-label") ?? el.textContent?.trim(), w: Math.round(r.width), h: Math.round(r.height) };
      })
      .filter((b) => b.w < 44 || b.h < 44)
  );
  rec("Mobile", "tap targets ≥ 44px on the editor dock and top bar", small.length === 0 ? "PASS" : "FAIL", { small });
});

rec("Mobile", "console errors", errors.length ? "FAIL" : "PASS", errors.length ? { errors } : {});
await browser.close();
save("mobile");
