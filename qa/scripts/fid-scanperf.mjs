// Scanned PDF → Word performance through the real page: total time, the stages the user sees, and how long
// the main thread was blocked (long tasks ≥ 50 ms — a UI freeze shows as a long one).
//   BASE=http://localhost:3000 node qa/scripts/fid-scanperf.mjs file.pdf [file2.pdf …]
import { launch, open, addPaths, rec, save, path } from "./fl-lib.mjs";

const files = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const { browser, page } = await launch({});
for (const file of files) {
  try {
    await open(page, "/pdf-to-word");
    await page.evaluate(() => {
      window.__long = [];
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) window.__long.push(Math.round(e.duration));
      }).observe({ type: "longtask", buffered: false });
    });
    await addPaths(page, [file]);
    await page.getByRole("button", { name: "Convert to Word" }).waitFor({ timeout: 60_000 });
    const stages = [];
    const watch = setInterval(async () => {
      const t = (await page.getByRole("status").allInnerTexts().catch(() => [])).join(" ").split("\n")[0].trim();
      if (t && stages[stages.length - 1] !== t) stages.push(t);
    }, 150);
    const t0 = Date.now();
    await page.getByRole("button", { name: "Convert to Word" }).click();
    await page.getByTestId("result").waitFor({ timeout: 900_000 });
    clearInterval(watch);
    const ms = Date.now() - t0;
    const long = await page.evaluate(() => window.__long);
    const pages = Number(/(\d+)\s*page/.exec(await page.getByTestId("result").innerText())?.[1] ?? 0);
    const max = long.length ? Math.max(...long) : 0;
    rec("Scan → Word performance", path.basename(file), max < 1500 ? "PASS" : "LIMITED", { ms, pages, perPageMs: pages ? Math.round(ms / pages) : null, longTasks: long.length, longestTaskMs: max, over500ms: long.filter((d) => d > 500).length, stages });
  } catch (e) {
    rec("Scan → Word performance", path.basename(file), "FAIL", { error: String(e).slice(0, 300) });
  }
}
await browser.close();
save("fid-scanperf");
