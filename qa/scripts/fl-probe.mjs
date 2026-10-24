// Opens a fixture in the editor and saves a screenshot (desktop or --mobile). For quick visual checks.
//   node qa/scripts/fl-probe.mjs <fixture> <out.png> [--mobile]
import { launch, open, addFiles } from "./fl-lib.mjs";

const [, , fixture, out, flag] = process.argv;
const { browser, page, errors } = await launch({ mobile: flag === "--mobile" });
await open(page, "/pdf-editor");
await addFiles(page, [fixture]);
await page.getByTestId("editor-workspace").waitFor({ timeout: 60_000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: out });
console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "no console errors");
await browser.close();
