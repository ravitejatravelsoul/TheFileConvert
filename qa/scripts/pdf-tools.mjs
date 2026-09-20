// Phase 3 (non-editor, non-OCR) PDF tools through the real UI; every output is re-opened independently.
import { launch, open, setRange, runAction, download, pdfTexts, pdfPixels, pxAt, near, pdfLibLoad, imageInfo, pageLabel, rec, save, fx, fs, PDFDocument } from "./lib.mjs";
import { degrees } from "pdf-lib";

const { browser, page, errors } = await launch();
const guard = async (tool, test, fn) => { try { await fn(); } catch (e) { rec(tool, test, "FAIL", String(e).slice(0, 220)); } };

// ---------- MERGE ----------
await guard("pdf-merge", "merge 14p + 3p", async () => {
  await open(page, "/pdf/merge", ["PDF-10-many-pages.pdf", "PDF-08-metadata.pdf"]);
  const r = await runAction(page, /^Merge 2 PDFs/); const [f] = await download(page, "merge-a");
  const t = await pdfTexts(f.path); const labels = t.map((x) => pageLabel(x.text));
  const exp = [...Array.from({ length: 14 }, (_, i) => `${i + 1}/14`), "1/3", "2/3", "3/3"];
  rec("pdf-merge", "14p + 3p in order", r.ok && JSON.stringify(labels) === JSON.stringify(exp) ? "PASS" : "FAIL", `${t.length} pages; ${labels.join(",")}`);
});
await guard("pdf-merge", "reorder inputs (move down) then merge", async () => {
  await open(page, "/pdf/merge", ["PDF-10-many-pages.pdf", "PDF-08-metadata.pdf"]);
  await page.getByRole("button", { name: "Move PDF-08-metadata.pdf up" }).click();
  await runAction(page, /^Merge 2 PDFs/); const [f] = await download(page, "merge-b");
  const labels = (await pdfTexts(f.path)).map((x) => pageLabel(x.text));
  rec("pdf-merge", "input order changed via ↑ button respected", labels[0] === "1/3" && labels[3] === "1/14" && labels.length === 17 ? "PASS" : "FAIL", labels.slice(0, 5).join(","));
});
await guard("pdf-merge", "merge scan + rotated + form keeps pages", async () => {
  await open(page, "/pdf/merge", ["PDF-07-rotated.pdf", "PDF-12-scanned-ocr.pdf", "PDF-09-form.pdf"]);
  const r = await runAction(page, /^Merge 3 PDFs/); const [f] = await download(page, "merge-c");
  const t = await pdfTexts(f.path); const rot = t.slice(0, 6).map((x) => x.rotate);
  const px = await pdfPixels(f.path, 7, 0.4);
  const nonWhite = [...px.d].filter((v, i) => i % 4 === 0 && v < 200).length;
  rec("pdf-merge", "rotated+scanned+form (9 pages, rotations kept, scan renders)", r.ok && t.length === 9 && JSON.stringify(rot) === "[0,90,180,270,90,0]" && nonWhite > 500 ? "PASS" : "FAIL", `pages=${t.length} rot=${rot} scanNonWhite=${nonWhite}`);
});
await guard("pdf-merge", "corrupt PDF gives clear error", async () => {
  await open(page, "/pdf/merge", ["PDF-10-many-pages.pdf", "PDF-11-corrupt.pdf"]);
  const r = await runAction(page, /^Merge 2 PDFs/);
  rec("pdf-merge", "corrupt input → error message", !r.ok && r.text ? "PASS" : "FAIL", r.text.slice(0, 140));
});
await guard("pdf-merge", "single file / remove", async () => {
  await open(page, "/pdf/merge", ["PDF-10-many-pages.pdf", "PDF-08-metadata.pdf"]);
  await page.getByRole("button", { name: "Remove PDF-08-metadata.pdf" }).click();
  const btn = page.getByRole("button", { name: /^Merge/ });
  rec("pdf-merge", "one file left: button state", "INFO", `${await btn.innerText()} disabled=${await btn.isDisabled()}`);
});

// ---------- SPLIT ----------
await guard("pdf-split", "split 14p into 5-page files", async () => {
  await open(page, "/pdf/split", ["PDF-10-many-pages.pdf"]);
  await page.getByLabel("Pages per file").fill("5");
  const r = await runAction(page, /^Split PDF/); const files = await download(page, "split-a");
  const counts = []; for (const f of files) counts.push((await pdfTexts(f.path)).length);
  const first = (await pdfTexts(files[0].path)).map((x) => pageLabel(x.text)).join(",");
  rec("pdf-split", "5 per file → 3 files (5,5,4), contiguous pages", r.ok && JSON.stringify(counts.sort()) === "[4,5,5]" && first === "1/14,2/14,3/14,4/14,5/14" ? "PASS" : "FAIL", `files=${files.map((f) => f.name).join(",")} counts=${counts} first=${first}`);
});
await guard("pdf-split", "split 1 per file", async () => {
  await open(page, "/pdf/split", ["PDF-10-many-pages.pdf"]);
  const r = await runAction(page, /^Split PDF/); const files = await download(page, "split-b");
  rec("pdf-split", "1 per file → 14 single-page PDFs", r.ok && files.length === 14 ? "PASS" : "FAIL", `${files.length} files`);
});
await guard("pdf-split", "value larger than page count", async () => {
  await open(page, "/pdf/split", ["PDF-10-many-pages.pdf"]);
  await page.getByLabel("Pages per file").fill("50");
  const r = await runAction(page, /^Split PDF/);
  rec("pdf-split", "50 per file on 14p", "INFO", r.ok ? `ok: ${(await page.locator("main").innerText()).split("\n").filter((l) => /\.pdf/.test(l)).join("; ")}` : `error: ${r.text}`);
});

// ---------- EXTRACT ----------
await guard("pdf-extract-pages", "1-3,5,8-10", async () => {
  await open(page, "/pdf/extract-pages", ["PDF-10-many-pages.pdf"]);
  await page.getByLabel(/Pages to extract/).fill("1-3,5,8-10");
  const r = await runAction(page, /^Extract pages/); const [f] = await download(page, "extract-a");
  const labels = (await pdfTexts(f.path)).map((x) => pageLabel(x.text).split("/")[0]).join(",");
  rec("pdf-extract-pages", "ranges 1-3,5,8-10", r.ok && labels === "1,2,3,5,8,9,10" ? "PASS" : "FAIL", labels);
});
for (const bad of ["99", "abc", "0"]) await guard("pdf-extract-pages", "invalid " + bad, async () => {
  await open(page, "/pdf/extract-pages", ["PDF-10-many-pages.pdf"]);
  await page.getByLabel(/Pages to extract/).fill(bad);
  const r = await runAction(page, /^Extract pages/);
  rec("pdf-extract-pages", `invalid range "${bad}" rejected with message`, !r.ok && r.text ? "PASS" : "FAIL", r.ok ? "produced a file!" : r.text.slice(0, 120));
});
await guard("pdf-extract-pages", "reversed range", async () => {
  await open(page, "/pdf/extract-pages", ["PDF-10-many-pages.pdf"]); await page.getByLabel(/Pages to extract/).fill("5-2");
  await runAction(page, /^Extract pages/); const [f] = await download(page, "extract-rev");
  const labels = (await pdfTexts(f.path)).map((x) => pageLabel(x.text).split("/")[0]).join(",");
  rec("pdf-extract-pages", 'reversed range "5-2" treated as 2-5 (documented, unit-tested)', labels === "2,3,4,5" ? "PASS" : "FAIL", labels);
});
await guard("pdf-extract-pages", "scanned PDF pages", async () => {
  await open(page, "/pdf/extract-pages", ["PDF-12-scanned-ocr.pdf"]);
  await page.getByLabel(/Pages to extract/).fill("2");
  await runAction(page, /^Extract pages/); const [f] = await download(page, "extract-b");
  const px = await pdfPixels(f.path, 1, 0.4);
  rec("pdf-extract-pages", "scan page 2 extracted (1 page, renders)", (await pdfTexts(f.path)).length === 1 && [...px.d].filter((v, i) => i % 4 === 0 && v < 200).length > 500 ? "PASS" : "FAIL", `size=${fs.statSync(f.path).size}`);
});

// ---------- DELETE ----------
await guard("pdf-delete-pages", "delete 2,4-6", async () => {
  await open(page, "/pdf/delete-pages", ["PDF-10-many-pages.pdf"]);
  await page.getByLabel(/Pages to delete/).fill("2,4-6");
  const r = await runAction(page, /^Delete pages/); const [f] = await download(page, "delete-a");
  const labels = (await pdfTexts(f.path)).map((x) => pageLabel(x.text).split("/")[0]).join(",");
  rec("pdf-delete-pages", "delete 2,4-6 leaves 1,3,7-14", r.ok && labels === "1,3,7,8,9,10,11,12,13,14" ? "PASS" : "FAIL", labels);
});
await guard("pdf-delete-pages", "delete all pages", async () => {
  await open(page, "/pdf/delete-pages", ["PDF-10-many-pages.pdf"]);
  await page.getByLabel(/Pages to delete/).fill("1-14");
  const r = await runAction(page, /^Delete pages/);
  rec("pdf-delete-pages", "deleting every page is refused with a message", !r.ok && r.text ? "PASS" : "FAIL", r.ok ? "produced a file" : r.text.slice(0, 140));
});
await guard("pdf-delete-pages", "out of range", async () => {
  await open(page, "/pdf/delete-pages", ["PDF-10-many-pages.pdf"]);
  await page.getByLabel(/Pages to delete/).fill("40");
  const r = await runAction(page, /^Delete pages/);
  rec("pdf-delete-pages", "page 40 of 14 rejected", !r.ok && r.text ? "PASS" : "FAIL", r.text.slice(0, 120));
});

// ---------- ROTATE ----------
await guard("pdf-rotate", "rotate all 90 on already-rotated PDF", async () => {
  await open(page, "/pdf/rotate", ["PDF-07-rotated.pdf"]);
  const r = await runAction(page, /^Rotate PDF/); const [f] = await download(page, "rotate-a");
  const rot = (await pdfTexts(f.path)).map((x) => x.rotate);
  rec("pdf-rotate", "0,90,180,270,90,0 + 90° → 90,180,270,0,180,90", r.ok && JSON.stringify(rot) === "[90,180,270,0,180,90]" ? "PASS" : "FAIL", `${rot}`);
});
await guard("pdf-rotate", "rotate pages 2,4 by 180", async () => {
  await open(page, "/pdf/rotate", ["PDF-10-many-pages.pdf"]);
  await page.locator("select").selectOption({ label: "180°" });
  await page.getByLabel(/Pages \(optional\)/).fill("2,4");
  await runAction(page, /^Rotate PDF/); const [f] = await download(page, "rotate-b");
  const t = await pdfTexts(f.path); const rot = t.slice(0, 5).map((x) => x.rotate);
  rec("pdf-rotate", "only selected pages 2,4 rotated 180", JSON.stringify(rot) === "[0,180,0,180,0]" && t.length === 14 ? "PASS" : "FAIL", `${rot}`);
});
await guard("pdf-rotate", "rotate 270 on scanned PDF: dimensions swap and content renders", async () => {
  await open(page, "/pdf/rotate", ["PDF-12-scanned-ocr.pdf"]);
  await page.locator("select").selectOption({ label: "270° clockwise" });
  await runAction(page, /^Rotate PDF/); const [f] = await download(page, "rotate-c");
  const t = await pdfTexts(f.path); const px = await pdfPixels(f.path, 1, 0.3);
  rec("pdf-rotate", "scan rotated 270 (landscape render)", t[0].rotate === 270 && px.w > px.h ? "PASS" : "FAIL", `rot=${t[0].rotate} ${px.w}x${px.h}`);
});

// ---------- REORDER ----------
await guard("pdf-reorder", "drag-and-drop page 3 to position 1", async () => {
  await open(page, "/pdf/reorder", ["PDF-10-many-pages.pdf"]);
  await page.locator('[data-page="3"]').waitFor();
  await page.locator('[data-page="3"]').dragTo(page.locator('[data-page="1"]'));
  const order = await page.locator("[data-page]").evaluateAll((els) => els.map((e) => e.getAttribute("data-page")).slice(0, 5).join(","));
  await runAction(page, /^Export reordered PDF/); const [f] = await download(page, "reorder-a");
  const labels = (await pdfTexts(f.path)).map((x) => pageLabel(x.text).split("/")[0]).slice(0, 5).join(",");
  rec("pdf-reorder", "drag page 3 onto 1 → UI order matches exported PDF", order === "3,1,2,4,5" && labels === "3,1,2,4,5" ? "PASS" : "FAIL", `ui=${order} pdf=${labels}`);
});
await guard("pdf-reorder", "move buttons", async () => {
  await open(page, "/pdf/reorder", ["PDF-10-many-pages.pdf"]);
  await page.getByRole("button", { name: "Move page 1 later" }).click();
  await page.getByRole("button", { name: "Move page 14 earlier" }).click();
  await runAction(page, /^Export reordered PDF/); const [f] = await download(page, "reorder-b");
  const labels = (await pdfTexts(f.path)).map((x) => pageLabel(x.text).split("/")[0]).join(",");
  rec("pdf-reorder", "↔ buttons then export", labels === "2,1,3,4,5,6,7,8,9,10,11,12,14,13" ? "PASS" : "FAIL", labels);
});

// ---------- IMAGES → PDF ----------
await guard("images-to-pdf", "png+jpg A4", async () => {
  await open(page, "/pdf/images-to-pdf", ["IMAGE-11-quadrants.png", "IMAGE-06-small-optimized.jpg"]);
  const r = await runAction(page, /^Create PDF from 2 images/); const [f] = await download(page, "i2p-a");
  const t = await pdfTexts(f.path); const px = await pdfPixels(f.path, 1, 1);
  // quadrant image drawn scaled into the page: TL red, TR green, BL blue, BR yellow near the corners of the drawn area
  const w = px.w, h = px.h; const tl = pxAt(px, w * 0.25, h * 0.4), tr = pxAt(px, w * 0.75, h * 0.4);
  rec("images-to-pdf", "2 images → 2 A4 pages, first page shows the image", r.ok && t.length === 2 && Math.abs(t[0].w - 595) < 3 && (near(tl, [255, 0, 0], 60) || near(tr, [0, 255, 0], 60)) ? "PASS" : "FAIL", `pages=${t.length} ${t[0]?.w}x${t[0]?.h} tl=${tl} tr=${tr}`);
});
await guard("images-to-pdf", "letter + fit + margin, webp/transparent png", async () => {
  await open(page, "/pdf/images-to-pdf", ["IMAGE-04-transparent.png", "IMAGE-13-landscape.jpg", "IMAGE-05-flat-logo.png"]);
  await setRange(page, "Margin", 0); await page.locator("select").selectOption({ label: "Fit to image size" });
  const r = await runAction(page, /^Create PDF from 3 images/); const [f] = await download(page, "i2p-b");
  const t = await pdfTexts(f.path);
  rec("images-to-pdf", "fit-to-image, transparent PNG + JPG + logo (3 pages)", r.ok && t.length === 3 ? "PASS" : "FAIL", t.map((x) => `${Math.round(x.w)}x${Math.round(x.h)}`).join(" ") + ` bytes=${fs.statSync(f.path).size}`);
  const px = await pdfPixels(f.path, 1, 0.3); const c = pxAt(px, px.w / 2, px.h / 2), corner = pxAt(px, 2, 2);
  rec("images-to-pdf", "transparent PNG corner becomes white (not black)", corner[0] > 200 && corner[1] > 200 && corner[2] > 200 ? "PASS" : "FAIL", `corner=${corner} centre=${c}`);
});
await guard("images-to-pdf", "US Letter", async () => {
  await open(page, "/pdf/images-to-pdf", ["IMAGE-12-portrait.jpg"]);
  await page.locator("select").selectOption({ label: "US Letter" });
  await runAction(page, /^Create PDF from 1 image/); const [f] = await download(page, "i2p-c");
  const t = await pdfTexts(f.path); rec("images-to-pdf", "US Letter page size 612x792", Math.abs(t[0].w - 612) < 2 && Math.abs(t[0].h - 792) < 2 ? "PASS" : "FAIL", `${t[0].w}x${t[0].h}`);
});
await guard("images-to-pdf", "unsupported/svg file", async () => {
  await open(page, "/pdf/images-to-pdf", ["DOC-02-markdown.md"]);
  const msg = (await page.locator("main").innerText()).slice(0, 300).replace(/\n+/g, " | ");
  rec("images-to-pdf", "non-image upload", "INFO", msg.slice(0, 200));
});

// ---------- PDF → IMAGES ----------
await guard("pdf-to-images", "PNG 2x", async () => {
  await open(page, "/pdf/to-images", ["PDF-10-many-pages.pdf"]);
  const r = await runAction(page, /^Convert to images/); const files = await download(page, "p2i-a");
  const img = await imageInfo(files[0].path);
  const dark = [...img.d].filter((v, i) => i % 4 === 0 && v < 100).length;
  rec("pdf-to-images", "14 pages → 14 PNG at 2x (1224x1584), text rendered", r.ok && files.length === 14 && img.w === 1224 && img.h === 1584 && dark > 2000 ? "PASS" : "FAIL", `${files.length} files ${img.w}x${img.h} darkpx=${dark} names=${files.slice(0, 2).map((f) => f.name)}`);
});
await guard("pdf-to-images", "JPG 1x on scan", async () => {
  await open(page, "/pdf/to-images", ["PDF-12-scanned-ocr.pdf"]);
  await page.locator("select").selectOption({ label: "JPG" }); await setRange(page, "Resolution", 1);
  const r = await runAction(page, /^Convert to images/); const files = await download(page, "p2i-b");
  const img = await imageInfo(files[0].path);
  rec("pdf-to-images", "scan → JPG at 1x (612x792), valid JPEG", r.ok && files.length === 2 && img.w === 612 && /\.jpe?g$/i.test(files[0].name) ? "PASS" : "FAIL", `${files.map((f) => f.name)} ${img.w}x${img.h}`);
});
await guard("pdf-to-images", "rotated PDF orientation", async () => {
  await open(page, "/pdf/to-images", ["PDF-07-rotated.pdf"]); await setRange(page, "Resolution", 1);
  await runAction(page, /^Convert to images/); const files = await download(page, "p2i-c");
  const dims = []; for (const f of files) { const i = await imageInfo(f.path); dims.push(`${i.w}x${i.h}`); }
  rec("pdf-to-images", "rotated pages render with rotation applied (landscape for 90/270)", dims.join(",") === "612x792,792x612,612x792,792x612,792x612,612x792" ? "PASS" : "FAIL", dims.join(","));
});

// ---------- PAGE NUMBERS ----------
await guard("pdf-add-page-numbers", "bottom-right start at 5", async () => {
  await open(page, "/pdf/page-numbers", ["PDF-10-many-pages.pdf"]);
  await page.locator("select").selectOption({ label: "Bottom right" }); await page.getByLabel("Start at").fill("5");
  const r = await runAction(page, /^Add page numbers/); const [f] = await download(page, "pn-a");
  const t = await pdfTexts(f.path);
  const tails = t.map((x) => x.text.split(" ").pop());
  const p1 = await pdfPixels(f.path, 1, 1), o1 = await pdfPixels(fx("PDF-10-many-pages.pdf"), 1, 1);
  // diff region = where the number was drawn
  let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
  for (let y = 0; y < p1.h; y++) for (let x = 0; x < p1.w; x++) { const i = (y * p1.w + x) * 4; if (Math.abs(p1.d[i] - o1.d[i]) > 60) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); } }
  rec("pdf-add-page-numbers", "start=5 → numbers 5..18 present, drawn bottom-right, original text intact", r.ok && tails.join(",") === Array.from({ length: 14 }, (_, i) => i + 5).join(",") && minX > p1.w * 0.6 && minY > p1.h * 0.85 && t[0].text.startsWith("Page 1 of 14") ? "PASS" : "FAIL", `tails=${tails.join(",")} box=${minX}-${maxX},${minY}-${maxY} of ${p1.w}x${p1.h}`);
});
for (const pos of ["Bottom center", "Top left", "Top center", "Top right", "Bottom left"]) await guard("pdf-add-page-numbers", pos, async () => {
  await open(page, "/pdf/page-numbers", ["PDF-07-rotated.pdf"]);
  const sel = page.locator("select"); const opts = await sel.locator("option").allInnerTexts();
  const match = opts.find((o) => o.toLowerCase().includes(pos.toLowerCase())); if (!match) { rec("pdf-add-page-numbers", `position ${pos}`, "INFO", "option absent: " + opts.join("|")); return; }
  await sel.selectOption({ label: match }); await runAction(page, /^Add page numbers/); const [f] = await download(page, "pn-" + pos.replace(/\W/g, ""));
  const t = await pdfTexts(f.path); const ok = t.map((x) => x.text.split(" ").pop()).join(",") === "1,2,3,4,5,6";
  rec("pdf-add-page-numbers", `${pos} on rotated PDF`, ok ? "PASS" : "FAIL", t.map((x) => x.text.split(" ").pop()).join(","));
});
await guard("pdf-add-page-numbers", "scan", async () => {
  await open(page, "/pdf/page-numbers", ["PDF-12-scanned-ocr.pdf"]);
  await runAction(page, /^Add page numbers/); const [f] = await download(page, "pn-scan");
  const t = await pdfTexts(f.path); rec("pdf-add-page-numbers", "numbers added to scanned PDF (text layer contains 1,2)", t.map((x) => x.text).join("|") === "1|2" ? "PASS" : "FAIL", t.map((x) => x.text).join("|"));
});

// ---------- WATERMARK ----------
await guard("pdf-watermark", "text watermark", async () => {
  await open(page, "/pdf/watermark", ["PDF-10-many-pages.pdf"]);
  await page.getByLabel("Watermark text").fill("AUDIT MARK"); await setRange(page, "Opacity", 0.5); await setRange(page, "Rotation", 30);
  const r = await runAction(page, /^Add watermark/); const [f] = await download(page, "wm-a");
  const t = await pdfTexts(f.path); const all = t.every((x) => x.text.includes("AUDIT MARK") && x.text.startsWith("Page"));
  const p = await pdfPixels(f.path, 1, 1), o = await pdfPixels(fx("PDF-10-many-pages.pdf"), 1, 1);
  let changed = 0; for (let i = 0; i < p.d.length; i += 4) if (Math.abs(p.d[i] - o.d[i]) > 30) changed++;
  const cx = pxAt(p, p.w / 2, p.h / 2);
  rec("pdf-watermark", "text on all 14 pages, visible mark, original text preserved", r.ok && t.length === 14 && all && changed > 1500 ? "PASS" : "FAIL", `pages=${t.length} allHaveMark=${all} changedPx=${changed}`);
});
await guard("pdf-watermark", "rotated+scanned", async () => {
  await open(page, "/pdf/watermark", ["PDF-07-rotated.pdf"]);
  await runAction(page, /^Add watermark/); const [f] = await download(page, "wm-b");
  const t = await pdfTexts(f.path);
  const px = []; for (const n of [1, 2, 3, 4]) { const p = await pdfPixels(f.path, n, 0.6); const o = await pdfPixels(fx("PDF-07-rotated.pdf"), n, 0.6); let c = 0; for (let i = 0; i < p.d.length; i += 4) if (Math.abs(p.d[i] - o.d[i]) > 30) c++; px.push(c); }
  rec("pdf-watermark", "watermark visible on rotated pages 1-4 (rotation-aware)", t.length === 6 && px.every((c) => c > 300) && t.every((x) => x.text.includes("CONFIDENTIAL")) ? "PASS" : "FAIL", `changed px=${px} texts=${t.filter((x) => x.text.includes("CONFIDENTIAL")).length}/6`);
});
await guard("pdf-watermark", "empty text", async () => {
  await open(page, "/pdf/watermark", ["PDF-10-many-pages.pdf"]); await page.getByLabel("Watermark text").fill("");
  const btn = page.getByRole("button", { name: /^Add watermark/ }); const dis = await btn.isDisabled();
  let msg = ""; if (!dis) { const r = await runAction(page, /^Add watermark/); msg = r.ok ? "produced file" : r.text; }
  rec("pdf-watermark", "empty watermark text", dis || msg.length > 0 && msg !== "produced file" ? "PASS" : "FAIL", dis ? "button disabled" : msg);
});
await guard("pdf-watermark", "unicode text", async () => {
  await open(page, "/pdf/watermark", ["PDF-10-many-pages.pdf"]); await page.getByLabel("Watermark text").fill("Café ✓ 日本");
  const r = await runAction(page, /^Add watermark/);
  rec("pdf-watermark", "non-Latin text handled (file or clear message)", "INFO", r.ok ? "produced file" : r.text.slice(0, 160));
});

// ---------- METADATA ----------
await guard("pdf-metadata", "view + remove", async () => {
  await open(page, "/pdf/metadata", ["PDF-08-metadata.pdf"]); await page.getByText("Audit Title").waitFor({ timeout: 15000 }).catch(() => {});
  const shown = (await page.locator("main").innerText());
  const sees = ["Audit Title", "Audit Author", "Audit Subject", "Audit Creator"].filter((s) => shown.includes(s));
  const r = await runAction(page, /^Remove metadata/); const [f] = await download(page, "meta-a");
  const d = await pdfLibLoad(f.path);
  const left = { t: d.getTitle(), a: d.getAuthor(), s: d.getSubject(), k: d.getKeywords(), c: d.getCreator(), cd: d.getCreationDate()?.toISOString() };
  const raw = fs.readFileSync(f.path, "latin1");
  rec("pdf-metadata", "metadata shown to the user before removal", sees.length >= 3 ? "PASS" : "FAIL", `visible=${sees.join("|")}`);
  rec("pdf-metadata", "removed: title/author/subject/keywords/creator empty; strings absent in file", r.ok && !left.t && !left.a && !left.s && !left.k && !left.c && !/Audit (Title|Author|Subject|Creator)/.test(raw) ? "PASS" : "FAIL", JSON.stringify(left));
  const t = await pdfTexts(f.path); rec("pdf-metadata", "pages intact after removal", t.length === 3 && t[0].text.startsWith("Page 1") ? "PASS" : "FAIL", `${t.length}p`);
});

console.log("PAGE ERRORS:", errors.length ? errors.join(" ;; ") : "none");
rec("(all pdf tools)", "browser console/page errors", errors.length ? "FAIL" : "PASS", errors.slice(0, 3).join(" ;; "));
save("pdf-tools"); await browser.close();
