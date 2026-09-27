// Temporary diagnostic: pointer/click event log around a CDP touch drag followed by a tap.
import { launch, open, fx } from "./fl-lib.mjs";
const { browser, ctx, page } = await launch({ mobile: true });
const cdp = await ctx.newCDPSession(page);
await open(page, "/organize-pdf");
const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Choose PDF" }).tap()]);
await chooser.setFiles(fx("FL-PDF-05-multipage.pdf"));
await page.locator("ol > li[data-sort-key]").nth(11).waitFor();
await page.evaluate(() => {
  window.__log = [];
  for (const t of ["pointerdown", "pointerup", "pointercancel", "click", "touchstart", "touchend"])
    window.addEventListener(t, (e) => window.__log.push(`${t}:${e.pointerType ?? ""}:${e.target?.getAttribute?.("aria-label") ?? e.target?.tagName}`), true);
});
const b = async (n) => {
  const r = await page.getByRole("button", { name: n, exact: true }).boundingBox();
  return [r.x + r.width / 2, r.y + r.height / 2];
};
const [x0, y0] = await b("Drag Page 3");
const [x1, y1] = await b("Drag Page 1");
await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0, id: 1 }] });
for (let i = 1; i <= 10; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + ((x1 - x0) * i) / 10, y: y0 + ((y1 - y0) * i) / 10, id: 1 }] });
await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
await page.waitForTimeout(700);
console.log("after drag:", await page.evaluate(() => window.__log.splice(0)));
await page.getByRole("button", { name: "Rotate Page 2 right", exact: true }).tap();
await page.waitForTimeout(400);
console.log("after tap 1:", await page.evaluate(() => window.__log.splice(0)));
await page.getByRole("button", { name: "Rotate Page 2 right", exact: true }).tap();
await page.waitForTimeout(400);
console.log("after tap 2:", await page.evaluate(() => window.__log.splice(0)));
console.log("rotated label:", await page.locator("li[aria-label*='Page 2,']").first().getAttribute("aria-label"));
await browser.close();
