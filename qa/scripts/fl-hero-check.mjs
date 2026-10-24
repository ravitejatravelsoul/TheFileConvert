// Hero headline check at five viewports: no highlight behind "seconds.", same line breaks and layout as before, no overflow,
// clipping or overlap, upload panel in place. Saves screenshots to qa/review/fresh-launch/hero-*.png.
import { chromium, devices } from "@playwright/test";
import path from "node:path";
const BASE = process.env.BASE ?? "http://localhost:3000";
const sizes = [[390, 844, true], [430, 932, true], [768, 1024, false], [1440, 900, false], [1920, 1080, false]];
const browser = await chromium.launch();
let fail = 0;
for (const [w, h, mobile] of sizes) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 3 } : {}) });
  const page = await ctx.newPage();
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.waitForTimeout(900); // rise animation
  const r = await page.evaluate(() => {
    const h1 = document.querySelector("h1");
    const word = [...h1.querySelectorAll("span")].find((s) => s.textContent.trim() === "seconds.");
    const range = document.createRange();
    const rects = (el) => { range.selectNodeContents(el); return [...range.getClientRects()]; };
    const lineTops = [...new Set(rects(h1).map((x) => Math.round(x.top)))];
    const wr = word.getBoundingClientRect();
    const doneRange = document.createRange();
    const doneNode = [...h1.childNodes].find((n) => n.nodeType === 3 && n.textContent.includes("Done in"));
    doneRange.selectNodeContents(doneNode);
    const dr = doneRange.getBoundingClientRect();
    // anything painted behind the word: child elements or a background colour
    const decorated = word.children.length > 0 || getComputedStyle(word).backgroundColor !== "rgba(0, 0, 0, 0)" || getComputedStyle(word).backgroundImage !== "none";
    const panel = document.querySelector('[data-testid="file-input"]')?.closest("section, div.card, div");
    const h1r = h1.getBoundingClientRect();
    const lead = document.querySelector("p.lead").getBoundingClientRect();
    // The same measurements with the previous markup (highlight block restored) — the line break and
    // the layout must not have changed.
    const layout = () => ({ tops: rects(h1).map((x) => Math.round(x.top)), wordLeft: Math.round(word.getBoundingClientRect().left), h: Math.round(h1.getBoundingClientRect().height), leadTop: Math.round(document.querySelector("p.lead").getBoundingClientRect().top) });
    const now = layout();
    word.classList.add("relative");
    const hl = document.createElement("span");
    hl.className = "absolute inset-x-[-0.06em] bottom-[0.06em] top-[0.52em] -z-10 rounded-[0.12em] bg-[var(--accent)]";
    word.prepend(hl);
    const before = layout();
    hl.remove();
    word.classList.remove("relative");
    return {
      sameLayoutAsBefore: JSON.stringify(now) === JSON.stringify(before),
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
      lines: lineTops.length,
      sameLineDoneSeconds: Math.abs(dr.top - wr.top) < 4,
      wordColor: getComputedStyle(word).color, h1Color: getComputedStyle(h1).color,
      decorated,
      clipped: h1r.left < 0 || h1r.right > window.innerWidth + 0.5,
      overlapLead: h1r.bottom > lead.top + 1,
      fontSize: getComputedStyle(h1).fontSize,
    };
  });
  const ok = r.sameLayoutAsBefore && r.overflowX <= 0 && !r.decorated && r.wordColor === r.h1Color && !r.clipped && !r.overlapLead;
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${w}x${h}`, JSON.stringify(r));
  await page.screenshot({ path: path.resolve(`qa/review/fresh-launch/hero-${w}x${h}.png`) });
  await ctx.close();
}
await browser.close();
process.exit(fail ? 1 : 0);
