// A conversion must finish while its tab is in the background (behind another tab): headed Chromium, the page is put
// behind a second tab *before* the primary action is pressed, and nothing is touched afterwards.
//   BASE=http://127.0.0.1:3100 node qa/scripts/pf-background-tab.mjs <route> <file> [--button="Convert to Word"] [--wait=90]
import { chromium } from "@playwright/test";
import path from "node:path";
const args = process.argv.slice(2);
const opt = (n, d) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const base = process.env.BASE ?? "http://127.0.0.1:3100";
const b = await chromium.launch({ headless: false });
const ctx = await b.newContext({ viewport: { width: 1200, height: 800 }, acceptDownloads: true });
const p1 = await ctx.newPage();
await p1.goto(base + "/" + args[0], { waitUntil: "networkidle" });
await p1.getByTestId("file-input").first().setInputFiles(path.resolve(args[1]));
const button = p1.getByRole("button", { name: opt("button", "Convert to Word") }).first();
await button.waitFor();
const p2 = await ctx.newPage();
await p2.goto("about:blank");
await p2.bringToFront(); // p1 is now a background tab
await button.dispatchEvent("click"); // pressed once, without bringing the tab forward
const t = Date.now();
let done = false;
const limit = Number(opt("wait", "90")) * 1000;
while (Date.now() - t < limit && !done) {
  await new Promise((r) => setTimeout(r, 500));
  done = (await p1.getByTestId("result").count()) > 0;
}
console.log(JSON.stringify({ route: args[0], file: path.basename(args[1]), finishedInBackgroundTab: done, seconds: +((Date.now() - t) / 1000).toFixed(1), status: (await p1.getByRole("status").allInnerTexts()).join("|").replace(/\s+/g, " ").slice(0, 60) }));
await b.close();
