import { devices } from "@playwright/test";
import { launch, open } from "./lib.mjs";
const { ctx, page, browser } = await launch({ ...devices["Pixel 7"] });
const cdp = await ctx.newCDPSession(page);
async function touchDrag(x0, y0, x1, y1, steps = 10) { await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0 }] }); for (let i = 1; i <= steps; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + ((x1 - x0) * i) / steps, y: y0 + ((y1 - y0) * i) / steps }] }); await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); }
await open(page, "/pdf/editor", ["PDF-12-scanned-ocr.pdf"]); await page.locator('[data-testid="page-surface"]').first().waitFor(); await page.waitForTimeout(1500);
const B = await page.locator('[data-testid="page-surface"]').first().boundingBox();
const mode = process.argv[2];
if (mode === "rect") { await page.getByRole("button", { name: "Rectangle", exact: true }).tap(); await touchDrag(B.x + 60, B.y + 70, B.x + 200, B.y + 160); console.log("shapes", await page.locator("[data-object-type=shape]").count()); }
await page.getByRole("button", { name: "Text", exact: true }).click();
console.log("active tool pressed:", await page.evaluate(() => [...document.querySelectorAll("button[aria-pressed=true]")].map((b) => b.getAttribute("aria-label") || b.innerText).join(","))); await page.touchscreen.tap(B.x + 100, B.y + 330); await page.waitForTimeout(600); console.log("after 1st tap editors", await page.getByTestId("canvas-text-editor").count()); await page.touchscreen.tap(B.x + 100, B.y + 330); await page.waitForTimeout(600);
console.log("editors", await page.getByTestId("canvas-text-editor").count(), "objects", await page.locator("[data-object-type]").evaluateAll((e) => e.map((x) => x.dataset.objectType)));
await browser.close();
