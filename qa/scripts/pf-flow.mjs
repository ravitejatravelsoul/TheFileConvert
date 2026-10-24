// PROCESSING FLOW — "click once, then hands off". Drives the real page in Chromium and records the stage timeline
// of a conversion without any further interaction.
//
//   BASE=http://127.0.0.1:3100 node qa/scripts/pf-flow.mjs pdf-to-word <file> [--starve] [--mobile] [--cold] [--runs=2] [--wait=240]
//
//   --starve   simulates a window that is not being painted (hidden / occluded / behind another window): the browser
//              stops requestAnimationFrame callbacks until the user interacts with the page. Callbacks queue up and
//              run on the first pointer/keyboard event — which is exactly what "it finished when I clicked" looks like.
//   --button="Convert to Word"  the primary action's accessible name (a prefix match)
//   --cold     fresh browser context for every run (empty HTTP cache); otherwise runs share one context (warm).
//
// Prints one JSON line per run: stage timeline (every distinct status text with its time since the click), result time,
// whether any interaction was needed, console errors.
import { chromium, devices } from "@playwright/test";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const route = "/" + (args[0] ?? "pdf-to-word");
const file = path.resolve(args[1]);
const base = process.env.BASE ?? "http://127.0.0.1:3100";
const runs = Number(opt("runs", "1"));
const waitMs = Number(opt("wait", "240")) * 1000;
const buttonName = opt("button", "Convert to Word");

async function context(browser) {
  const ctx = await browser.newContext({ acceptDownloads: true, ...(flag("mobile") ? devices["Pixel 7"] : { viewport: { width: 1440, height: 900 } }) });
  if (flag("starve")) {
    // Frames are not delivered until the user touches the page.
    await ctx.addInitScript(() => {
      const queue = [];
      let starved = true;
      window.__rafQueued = 0;
      window.requestAnimationFrame = (cb) => {
        if (!starved) return setTimeout(() => cb(performance.now()), 0);
        queue.push(cb);
        window.__rafQueued = queue.length;
        return queue.length;
      };
      window.cancelAnimationFrame = () => {};
      const release = () => {
        if (!starved || !window.__armed) return; // the Convert click itself does not count
        starved = false;
        window.__released = performance.now();
        for (const cb of queue.splice(0)) setTimeout(() => cb(performance.now()), 0);
      };
      for (const t of ["pointerdown", "mousedown", "click", "keydown", "touchstart"]) addEventListener(t, release, { capture: true, once: false });
    });
  }
  return ctx;
}

const browser = await chromium.launch();
let shared = null;
for (let run = 1; run <= runs; run++) {
  const ctx = flag("cold") || !shared ? await context(browser) : shared;
  shared = flag("cold") ? null : ctx;
  const page = await ctx.newPage();
  const errors = [];
  const requests = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));
  page.on("request", (r) => /tesseract|traineddata|\.wasm/i.test(r.url()) && requests.push({ t: Date.now(), url: r.url().split("/").slice(-2).join("/") }));
  const t0 = Date.now();
  await page.goto(base + route, { waitUntil: "networkidle" });
  await page.getByTestId("file-input").first().setInputFiles(file);
  const action = page.getByRole("button", { name: buttonName }).first();
  await action.waitFor({ timeout: 60_000 });
  const ready = Date.now();
  const timeline = [];
  const seen = new Set();
  const poll = setInterval(async () => {
    const t = (await page.getByRole("status").allInnerTexts().catch(() => [])).join(" | ").replace(/\s+/g, " ").trim().slice(0, 90);
    if (t && !seen.has(t)) {
      seen.add(t);
      timeline.push([+((Date.now() - click) / 1000).toFixed(1), t]);
    }
  }, 150);
  const click = Date.now();
  await action.click();
  if (flag("starve")) await page.evaluate(() => { window.__armed = true; });
  let result = null;
  let interactions = 0;
  const deadline = click + waitMs;
  let stuckAt = null;
  while (Date.now() < deadline) {
    if (await page.getByTestId("result").count()) {
      result = Date.now();
      break;
    }
    if (await page.locator("main").getByRole("alert").count()) break;
    await new Promise((r) => setTimeout(r, 200));
    // "Hands off": nothing is touched. (With --starve we report the stall after 30 s and then give it one click.)
    if (flag("starve") && !stuckAt && Date.now() - click > 30_000) {
      stuckAt = Date.now();
      const state = await page.evaluate(() => ({ queued: window.__rafQueued, released: window.__released ?? null }));
      console.log(JSON.stringify({ stalled30s: true, state }));
      await page.mouse.click(700, 600); // one click on an empty area
      interactions = 1;
    }
  }
  clearInterval(poll);
  const out = {
    run,
    mode: `${flag("cold") ? "cold" : run === 1 ? "first" : "warm"}${flag("starve") ? "+starved-frames" : ""}${flag("mobile") ? "+mobile" : ""}`,
    file: path.basename(file),
    uploadToReadySec: +((ready - t0) / 1000).toFixed(1),
    resultSec: result ? +((result - click) / 1000).toFixed(1) : null,
    interactionsNeeded: interactions,
    afterClickSec: stuckAt && result ? +((result - stuckAt) / 1000).toFixed(1) : null,
    ocrRequests: requests.length,
    timeline,
    errors: errors.slice(0, 3),
  };
  console.log(JSON.stringify(out));
  await page.close();
  if (flag("cold")) await ctx.close();
}
await browser.close();
