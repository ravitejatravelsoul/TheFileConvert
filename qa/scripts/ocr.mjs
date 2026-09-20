// OCR tool through the real UI: timings, TXT accuracy against known ground truth, searchable-PDF verification.
import { launch, open, pdfTexts, pdfPixels, rec, save, fx, fs, path } from "./lib.mjs";

const { browser, page, errors } = await launch();
const guard = async (tool, test, fn) => { try { await fn(); } catch (e) { rec(tool, test, "FAIL", String(e).slice(0, 220)); } };
const REAL = "C:/Users/ravit/Downloads/TheFileConvert_Scanned_OCR_Test.pdf";
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9$/.\-]+/g, " ").split(/\s+/).filter(Boolean);

async function ocr(file, { quality, label }) {
  await open(page, "/pdf/ocr", [file]);
  const n = (await page.getByRole("button", { name: /^Recognize \d+ pages?/ }).innerText()).match(/\d+/)[0];
  if (quality) await page.getByLabel("Quality").selectOption(quality);
  const t0 = Date.now(); await page.getByRole("button", { name: /^Recognize/ }).click();
  await page.getByText("Recognition complete").waitFor({ timeout: 480_000 }); const ms = Date.now() - t0;
  const status = (await page.locator("main").innerText()).match(/\d+ pages? recognized[^\n]*/)?.[0] ?? "";
  const [d1] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download TXT" }).click()]); const txtPath = `qa/evidence/out/ocr-${label}.txt`; await d1.saveAs(txtPath);
  const [d2] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download searchable PDF" }).click()]); const pdfPath = `qa/evidence/out/ocr-${label}.pdf`; await d2.saveAs(pdfPath);
  return { ms, status, txt: fs.readFileSync(txtPath, "utf8"), pdfPath, pages: n, sizes: [fs.statSync(txtPath).size, fs.statSync(pdfPath).size] };
}
function recall(truth, got) { const g = new Map(); for (const w of norm(got)) g.set(w, (g.get(w) ?? 0) + 1); let hit = 0; const t = norm(truth); for (const w of t) if ((g.get(w) ?? 0) > 0) { hit++; g.set(w, g.get(w) - 1); } return { hit, total: t.length, pct: +((hit / t.length) * 100).toFixed(1) }; }

const truth12 = ["INVOICE INV-2024-0158", ...Array.from({ length: 44 }, (_, i) => `Line ${i + 1}: The quick brown fox jumps over the lazy dog ${1000 + i * 7} — invoice ref 50-${i}.`)].join("\n");
for (const [q, label] of [["standard", "PDF12-standard"], ["accurate", "PDF12-accurate"]]) await guard("pdf-ocr", `PDF-12 ${q}`, async () => {
  const opts = await page.goto("http://localhost:3000/pdf/ocr").then(() => null);
  let quality = q; if (q === "accurate") { await open(page, "/pdf/ocr", ["PDF-12-scanned-ocr.pdf"]); const o = await page.getByLabel("Quality").locator("option").evaluateAll((els) => els.map((e) => e.value)); quality = o.find((v) => v !== "standard") ?? "standard"; }
  const r = await ocr("PDF-12-scanned-ocr.pdf", { quality, label });
  const rc = recall(truth12, r.txt); const t = await pdfTexts(r.pdfPath); const all = t.map((x) => x.text).join(" ");
  const search = ["quick brown fox", "INV-2024-0158", "invoice ref"].map((p) => `${p}:${all.toLowerCase().includes(p.toLowerCase())}`).join(" ");
  const p = await pdfPixels(r.pdfPath, 1, 0.5), o = await pdfPixels(fx("PDF-12-scanned-ocr.pdf"), 1, 0.5); let diff = 0; for (let i = 0; i < p.d.length; i += 4) diff += Math.abs(p.d[i] - o.d[i]); const mad = +(diff / (p.d.length / 4)).toFixed(2);
  rec("pdf-ocr", `synthetic 2-page scan, ${q}: ${r.pages} pages in ${(r.ms / 1000).toFixed(1)}s`, rc.pct >= 90 && t.length === 2 && /quick brown fox/i.test(all) && mad < 6 ? "PASS" : "FAIL", `word recall ${rc.pct}% (${rc.hit}/${rc.total}); searchable phrases: ${search}; visual diff vs original scan MAD=${mad}; ${r.status}; pdf ${r.sizes[1]}B (input ${fs.statSync(fx("PDF-12-scanned-ocr.pdf")).size}B)`);
});
const truthReal = ["OFFICIAL RECORD - SCANNED COPY", "Student Information", "Name: John Smith", "This certifies that the requirements for the award of the degree", "VALID FROM 02/08/2026 UNTIL 12/20/2026", "Account Number: 4738 0192 6501", "Invoice Total: $182.50"].join("\n");
await guard("pdf-ocr", "user's real scanned PDF", async () => {
  const r = await ocr(REAL, { label: "REAL-standard" });
  const rc = recall(truthReal, r.txt); const t = await pdfTexts(r.pdfPath); const all = t.map((x) => x.text).join(" ");
  const keys = ["John Smith", "02/08/2026", "12/20/2026", "4738 0192 6501", "$182.50", "OFFICIAL RECORD"].map((k) => `${k}:${all.includes(k)}`).join(" ");
  rec("pdf-ocr", `user's scanned test PDF (2 pages) in ${(r.ms / 1000).toFixed(1)}s`, rc.pct >= 90 ? "PASS" : "FAIL", `recall ${rc.pct}% (${rc.hit}/${rc.total}); key values in searchable PDF: ${keys}; ${r.status}`);
  console.log("TXT HEAD:", r.txt.slice(0, 500).replace(/\n/g, " ⏎ "));
});
await guard("pdf-ocr", "native-text PDF is skipped", async () => {
  await open(page, "/pdf/ocr", ["PDF-10-many-pages.pdf"]); await page.waitForTimeout(2500);
  const t = (await page.locator("main").innerText()); const msg = t.split("\n").filter((l) => /text|native|already|scanned|no pages/i.test(l)).slice(0, 3).join(" | ");
  const btn = page.getByRole("button", { name: /^Recognize/ });
  rec("pdf-ocr", "text PDF: tells user it already has text (does not OCR by default)", /already|real text|has text|selectable/i.test(t) ? "PASS" : "FAIL", `${msg} | button=${(await btn.count()) ? await btn.innerText() : "none"}`);
});
await guard("pdf-ocr", "corrupt PDF", async () => {
  await open(page, "/pdf/ocr", ["PDF-11-corrupt.pdf"]); await page.waitForTimeout(2500);
  const t = await page.locator("main [role=alert]").allInnerTexts(); const m = (await page.locator("main").innerText()).split("\n").filter((l) => /couldn|damaged|corrupt|read/i.test(l))[0] ?? "";
  rec("pdf-ocr", "corrupt PDF → readable message", t.length || m ? "PASS" : "FAIL", (t[0] ?? m).slice(0, 140));
});
rec("(ocr)", "browser console/page errors", errors.length ? "FAIL" : "PASS", errors.slice(0, 3).join(" ;; "));
save("ocr"); await browser.close();
