// Review screenshots for the visual polish pass, plus layout sanity checks at five viewports.
//   BASE=http://localhost:3000 node qa/scripts/polish-shots.mjs [outDir]
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = path.resolve(process.argv[2] ?? "qa/review/fresh-launch-polish");
fs.mkdirSync(OUT, { recursive: true });
const FX = path.resolve("qa/fresh-scenario-fixtures");
const browser = await chromium.launch();
const problems = [];

async function ctxFor(w, h) {
  const mobile = w < 500;
  return browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
}
async function settle(page) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(900);
}
async function check(page, label) {
  const r = await page.evaluate(() => {
    const overflow = document.documentElement.scrollWidth - window.innerWidth;
    // Visible text that is cut off at the viewport edge.
    const cut = [...document.querySelectorAll("h1,h2,h3,p,a,button")]
      .filter((e) => e.offsetParent && e.getBoundingClientRect().width > 0)
      .filter((e) => {
        const r = e.getBoundingClientRect();
        return r.right > window.innerWidth + 1 || r.left < -1;
      })
      .map((e) => (e.textContent || "").trim().slice(0, 40));
    // Tap targets smaller than 44px on touch layouts.
    const small = matchMedia("(pointer: coarse)").matches
      ? [...document.querySelectorAll("main a, main button, header a, header button")]
          .filter((e) => e.offsetParent)
          .filter((e) => {
            const r = e.getBoundingClientRect();
            return r.width > 0 && (r.height < 40 || r.width < 40) && !(e.closest("p") || e.closest("li p"));
          })
          .map((e) => (e.getAttribute("aria-label") || e.textContent || "").trim().slice(0, 30))
      : [];
    return { overflow, cut: [...new Set(cut)].slice(0, 5), small: [...new Set(small)].slice(0, 8) };
  });
  if (r.overflow > 0 || r.cut.length) problems.push({ label, ...r });
  return r;
}
async function shot(page, name, opts = {}) {
  await page.screenshot({ path: path.join(OUT, name), ...opts });
}

const SIZES = [
  [390, 844],
  [430, 932],
  [768, 1024],
  [1440, 900],
  [1920, 1080],
];

// Homepage at every size (full page) + layout checks.
for (const [w, h] of SIZES) {
  const ctx = await ctxFor(w, h);
  const page = await ctx.newPage();
  await page.goto(BASE + "/");
  await settle(page);
  const r = await check(page, `home ${w}x${h}`);
  console.log(`home ${w}x${h}`, JSON.stringify(r));
  const tag = w === 1440 ? "homepage-desktop" : w === 390 ? "homepage-mobile" : `homepage-${w}x${h}`;
  await shot(page, `${tag}.png`, { fullPage: true });
  if (w === 1440 || w === 390) await shot(page, w === 1440 ? "hero-desktop.png" : "hero-mobile.png");
  if (w === 1440) {
    await page.locator("#popular-heading").scrollIntoViewIfNeeded();
    await page.locator("#popular-heading").evaluate((e) => window.scrollBy(0, e.getBoundingClientRect().top - 90));
    await page.waitForTimeout(400);
    await shot(page, "popular-tools.png");
    await page.locator("footer").scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.locator("footer").screenshot({ path: path.join(OUT, "footer.png") });
    // Open a nav dropdown.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole("button", { name: "Compress" }).first().click();
    await page.waitForTimeout(400);
    await shot(page, "nav-dropdown.png", { clip: { x: 0, y: 0, width: 1440, height: 520 } });
  }
  await ctx.close();
}

// Tool pages.
const TOOLS = [
  ["compress-pdf", "PDF-B-mixed-800k.pdf"],
  ["compress-image", "IMAGE-B-photo-500k.jpg"],
  ["merge-pdf", ["PDF-K-native-text.pdf", "PDF-N-metadata-rich.pdf", "PDF-J-mixed-page-sizes.pdf"]],
  ["organize-pdf", "PDF-H-multipage-text-image.pdf"],
];
for (const [w, h] of [
  [1440, 900],
  [390, 844],
]) {
  const suffix = w === 390 ? "-mobile" : "";
  for (const [route, files] of TOOLS) {
    const ctx = await ctxFor(w, h);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/${route}`);
    await settle(page);
    await check(page, `${route} empty ${w}`);
    await shot(page, `${route}-empty${suffix}.png`);
    await page.getByTestId("file-input").first().setInputFiles((Array.isArray(files) ? files : [files]).map((f) => path.join(FX, f)));
    await page.waitForTimeout(2500);
    await check(page, `${route} loaded ${w}`);
    await shot(page, `${route}${suffix}.png`, { fullPage: w !== 390 ? false : false });
    if (route.startsWith("compress")) {
      await page.getByRole("button", { name: /^Compress to under/ }).click();
      await page.getByTestId("result").waitFor({ timeout: 120_000 });
      await page.waitForTimeout(500);
      await check(page, `${route} result ${w}`);
      await shot(page, `${route}-result${suffix}.png`);
    }
    await ctx.close();
  }
}

// Editor.
for (const [w, h, name] of [
  [1440, 900, "pdf-editor-desktop"],
  [390, 844, "pdf-editor-mobile"],
]) {
  const ctx = await ctxFor(w, h);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/pdf-editor`);
  await settle(page);
  await shot(page, `${name}-empty.png`);
  await page.getByTestId("file-input").first().setInputFiles(path.join(FX, "PDF-K-native-text.pdf"));
  await page.getByTestId("page-surface").first().waitFor();
  await page.waitForTimeout(1500);
  await check(page, `editor ${w}`);
  await shot(page, `${name}.png`);
  await ctx.close();
}

await browser.close();
console.log(problems.length ? `PROBLEMS ${JSON.stringify(problems, null, 1)}` : "NO LAYOUT PROBLEMS");
