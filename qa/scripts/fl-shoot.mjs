// Screenshots of pages at a viewport: node qa/scripts/fl-shoot.mjs <outDir> <width>x<height> [--full] path1 path2 ...
// BASE env overrides the server (default http://localhost:3000). Fails on console errors or horizontal overflow.
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const [, , outDir, size, ...rest] = process.argv;
const full = rest.includes("--full");
const paths = rest.filter((a) => a !== "--full");
const [width, height] = size.split("x").map(Number);
const BASE = process.env.BASE ?? "http://localhost:3000";
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: width < 800 ? 3 : 1, isMobile: width < 800, hasTouch: width < 800 });
const page = await context.newPage();
const problems = [];
page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));

for (const p of paths) {
  await page.goto(BASE + p, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 0) problems.push(`${p}: horizontal overflow ${overflow}px at ${width}px`);
  const name = (p === "/" ? "home" : p.replace(/^\//, "").replace(/\//g, "_")) + `-${width}.png`;
  await page.screenshot({ path: path.join(outDir, name), fullPage: full });
  console.log("shot", name);
}
await browser.close();
if (problems.length) {
  console.log("PROBLEMS:\n" + problems.join("\n"));
  process.exitCode = 1;
}
