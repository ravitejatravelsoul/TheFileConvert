// Named review screenshots not produced by the flow scripts: homepage (desktop), tool discovery, footer,
// and before/after crops of the scanned-text edits.
//   BASE=http://127.0.0.1:3100 node qa/scripts/fl-review-shots.mjs
import { launch, open, shot, SHOTS, OUT, fs, path } from "./fl-lib.mjs";
import { loadImage, createCanvas } from "@napi-rs/canvas";

const { browser, page } = await launch();
await open(page, "/");
await page.waitForTimeout(600);
await shot(page, "01-homepage-desktop.png");
await shot(page, "01b-homepage-desktop-full.png", { full: true });
await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Convert" }).click();
await page.waitForTimeout(400);
await shot(page, "01c-nav-menu.png");
await open(page, "/tools");
await shot(page, "16-tool-discovery.png", { full: true });
await open(page, "/");
await page.locator("footer").scrollIntoViewIfNeeded();
await page.locator("footer").screenshot({ path: path.join(SHOTS, "17-footer.png") });
await browser.close();

// Before/after crops of the scanned-text edits (rendered from the exported PDFs by fl-editor.mjs).
async function crop(src, dst, [x, y, w, h]) {
  const img = await loadImage(fs.readFileSync(path.join(OUT, src)));
  const c = createCanvas(Math.round(img.width * w), Math.round(img.height * h));
  c.getContext("2d").drawImage(img, -Math.round(img.width * x), -Math.round(img.height * y));
  fs.writeFileSync(path.join(SHOTS, dst), c.toBuffer("image/png"));
}
for (const [label, box] of [
  ["fixture", [0.03, 0.12, 0.6, 0.18]],
  ["condensed", [0.03, 0.12, 0.6, 0.18]],
  ["user-supplied", [0.0, 0.225, 1, 0.08]],
]) {
  for (const when of ["before", "after"]) await crop(`editor-scan-${label}-${when}.png`, `18-scan-edit-${label}-${when}.png`, box);
}
await crop("editor-native-export-p2.png", "19-native-edit-export.png", [0, 0, 1, 0.75]);
console.log("done");
