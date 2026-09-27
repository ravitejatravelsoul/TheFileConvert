// Reproduces the reported corrupt-output case with the user's own ~3.8 MB scan (the only permitted
// Downloads file), through the real Compress PDF UI, and validates the download with qpdf + MuPDF.
//   BASE=http://localhost:3000 node qa/scripts/fl-repro-real.mjs [targetKB] [tag]
import { execFileSync } from "node:child_process";
import { launch, open, download, size, rec, save } from "./fl-lib.mjs";

const REAL = "C:/Users/ravit/Downloads/TheFileConvert_Scanned_OCR_Test.pdf";
const kb = Number(process.argv[2] ?? 1000);
const tag = process.argv[3] ?? "repro";
const { browser, page } = await launch();
await open(page, "/compress-pdf");
await page.getByTestId("file-input").first().setInputFiles(REAL);
await page.getByRole("radio", { name: "Custom", exact: true }).click();
await page.getByLabel("Custom target size").fill(String(kb));
await page.getByRole("radio", { name: "KB", exact: true }).click();
await page.getByRole("button", { name: /^Compress to under/ }).click();
await page.getByTestId("result").waitFor({ timeout: 300_000 });
const headline = await page.getByTestId("result").getByRole("status").innerText();
const out = await download(page, page.getByRole("button", { name: /^Download/ }), `${tag}-real-${kb}`);
await browser.close();
const check = JSON.parse(execFileSync("python", ["qa/validate/pdfcheck.py", out], { encoding: "utf8" }));
rec("Compress PDF", `user scan → ${kb} KB (${tag})`, check.ok ? "PASS" : "FAIL", { input: size(REAL), target: kb * 1000, output: size(out), headline, check });
save(`repro-${tag}-${kb}`);
