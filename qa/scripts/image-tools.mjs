// Phase 4: image tools through the real UI, outputs decoded independently (napi canvas).
import { launch, open, setRange, runAction, download, imageInfo, pxAt, near, rec, save, fx, fs } from "./lib.mjs";

const { browser, page, errors } = await launch();
const dialogs = []; page.on("dialog", (d) => { dialogs.push(d.message()); d.dismiss(); });
const guard = async (tool, test, fn) => { try { await fn(); } catch (e) { rec(tool, test, "FAIL", String(e).slice(0, 220)); } };
const RED = [255, 0, 0], GREEN = [0, 255, 0], BLUE = [0, 0, 255], YELLOW = [255, 255, 0];
const quad = (img) => { const w = img.w, h = img.h; return [pxAt(img, w * 0.25, h * 0.25), pxAt(img, w * 0.75, h * 0.25), pxAt(img, w * 0.25, h * 0.75), pxAt(img, w * 0.75, h * 0.75)]; };
const isQuad = (img, exp, t = 60) => quad(img).every((p, i) => near(p, exp[i], t));
const magic = (f) => { const b = fs.readFileSync(f); return b.subarray(0, 4).toString("hex") + "/" + b.subarray(8, 12).toString("latin1"); };
const fmtOf = (f) => { const b = fs.readFileSync(f); if (b[0] === 0x89 && b[1] === 0x50) return "png"; if (b[0] === 0xff && b[1] === 0xd8) return "jpeg"; if (b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP") return "webp"; return "?"; };
const psnr = (a, b) => { if (a.w !== b.w || a.h !== b.h) return null; let se = 0; for (let i = 0; i < a.d.length; i += 4) for (let k = 0; k < 3; k++) { const d = a.d[i + k] - b.d[i + k]; se += d * d; } const m = se / (a.w * a.h * 3); return m === 0 ? 99 : +(10 * Math.log10(65025 / m)).toFixed(1); };

// ---------- RESIZE ----------
await guard("image-resize", "width 200 with locked ratio", async () => {
  await open(page, "/image/resize", ["IMAGE-11-quadrants.png"]);
  await page.getByLabel("Width (px)").fill("200"); const h = await page.getByLabel("Height (px)").inputValue();
  const r = await runAction(page, /^Resize 1 image/); const [f] = await download(page, "resize-a"); const i = await imageInfo(f.path);
  rec("image-resize", "200px wide, ratio locked → 200x150, colours correct, PNG", r.ok && i.w === 200 && i.h === 150 && h === "150" && isQuad(i, [RED, GREEN, BLUE, YELLOW]) && fmtOf(f.path) === "png" ? "PASS" : "FAIL", `${i.w}x${i.h} heightField=${h} fmt=${fmtOf(f.path)}`);
});
await guard("image-resize", "unlocked 100x100 + JPG + WebP", async () => {
  for (const [label, fmt] of [["JPG", "jpeg"], ["WebP", "webp"]]) {
    await open(page, "/image/resize", ["IMAGE-11-quadrants.png"]);
    await page.getByLabel("Lock aspect ratio").uncheck(); await page.getByLabel("Width (px)").fill("100"); await page.getByLabel("Height (px)").fill("100"); await page.locator("select").selectOption({ label });
    await runAction(page, /^Resize 1 image/); const [f] = await download(page, "resize-" + fmt); const i = await imageInfo(f.path);
    rec("image-resize", `100x100 unlocked as ${label}`, i.w === 100 && i.h === 100 && fmtOf(f.path) === fmt && isQuad(i, [RED, GREEN, BLUE, YELLOW], 70) ? "PASS" : "FAIL", `${i.w}x${i.h} ${fmtOf(f.path)}`);
  }
});
await guard("image-resize", "upscale huge photo / invalid size", async () => {
  await open(page, "/image/resize", ["IMAGE-01-photo-large.jpg"]); await page.getByText(/^Original: 4200/).waitFor({ timeout: 30000 });
  await page.getByLabel("Width (px)").fill("1000");
  const r = await runAction(page, /^Resize 1 image/); const [f] = await download(page, "resize-photo"); const i = await imageInfo(f.path);
  rec("image-resize", "4200x3000 photo → 1000 wide (JPG in → default format)", r.ok && i.w === 1000 && i.h === 714 ? "PASS" : "FAIL", `${i.w}x${i.h} ${fmtOf(f.path)} ${fs.statSync(f.path).size}B`);
  await open(page, "/image/resize", ["IMAGE-11-quadrants.png"]); await page.getByLabel("Width (px)").fill("0");
  const btn = page.getByRole("button", { name: /^Resize/ }); const dis = await btn.isDisabled(); let msg = ""; if (!dis) { const r2 = await runAction(page, /^Resize/); msg = r2.ok ? "PRODUCED FILE" : r2.text; }
  rec("image-resize", "width 0 refused", dis || (msg && msg !== "PRODUCED FILE") ? "PASS" : "FAIL", dis ? "button disabled" : msg);
});

// ---------- CROP ----------
await guard("image-crop", "sliders: top-left 50%x50%", async () => {
  await open(page, "/image/crop", ["IMAGE-11-quadrants.png"]);
  await setRange(page, "Crop width", 50); await setRange(page, "Crop height", 50); await setRange(page, "Position from left", 0); await setRange(page, "Position from top", 0);
  const r = await runAction(page, /^Crop image/); const [f] = await download(page, "crop-a"); const i = await imageInfo(f.path);
  rec("image-crop", "top-left quarter → 200x150 all red", r.ok && i.w === 200 && i.h === 150 && quad(i).every((p) => near(p, RED)) ? "PASS" : "FAIL", `${i.w}x${i.h} ${quad(i)[0]}`);
});
await guard("image-crop", "sliders: bottom-right", async () => {
  await open(page, "/image/crop", ["IMAGE-11-quadrants.png"]);
  await setRange(page, "Crop width", 50); await setRange(page, "Crop height", 50); await setRange(page, "Position from left", 50); await setRange(page, "Position from top", 50);
  await runAction(page, /^Crop image/); const [f] = await download(page, "crop-b"); const i = await imageInfo(f.path);
  rec("image-crop", "bottom-right quarter → all yellow", i.w === 200 && i.h === 150 && quad(i).every((p) => near(p, YELLOW)) ? "PASS" : "FAIL", `${i.w}x${i.h} ${quad(i)[0]}`);
});
await guard("image-crop", "drag on the picture", async () => {
  await open(page, "/image/crop", ["IMAGE-11-quadrants.png"]);
  const box = await page.locator("main img").first().boundingBox();
  await page.mouse.move(box.x + box.width * 0.02, box.y + box.height * 0.02); await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.45, { steps: 8 }); await page.mouse.up();
  const vals = await page.locator("input[type=range]").evaluateAll((els) => els.map((e) => e.value));
  await runAction(page, /^Crop image/); const [f] = await download(page, "crop-drag"); const i = await imageInfo(f.path);
  rec("image-crop", "mouse drag draws a new box top-left (~43% of image, all red)", i.w >= 150 && i.w <= 200 && quad(i).every((p) => near(p, RED)) ? "PASS" : "FAIL", `sliders=${vals} out=${i.w}x${i.h} ${quad(i)[0]}`);
});
await guard("image-crop", "touch drag (mobile)", async () => { rec("image-crop", "touch — see mobile run", "INFO", "covered in qa/scripts/mobile.mjs"); });

// ---------- ROTATE / FLIP ----------
const rotCases = [["90° clockwise", false, false, [BLUE, RED, YELLOW, GREEN], 300, 400], ["180°", false, false, [YELLOW, BLUE, GREEN, RED], 400, 300], ["No rotation", true, false, [GREEN, RED, YELLOW, BLUE], 400, 300], ["No rotation", false, true, [BLUE, YELLOW, RED, GREEN], 400, 300]];
for (const [rot, fh, fv, exp, w, h] of rotCases) await guard("image-rotate", rot, async () => {
  await open(page, "/image/rotate", ["IMAGE-11-quadrants.png"]);
  await page.locator("select").first().selectOption({ label: rot }); if (fh) await page.getByLabel("Flip horizontal").check(); if (fv) await page.getByLabel("Flip vertical").check();
  const r = await runAction(page, /^Apply/); const [f] = await download(page, "rot-" + rot.replace(/\W/g, "") + fh + fv); const i = await imageInfo(f.path);
  rec("image-rotate", `${rot}${fh ? " + flip H" : ""}${fv ? " + flip V" : ""}`, r.ok && i.w === w && i.h === h && isQuad(i, exp) ? "PASS" : "FAIL", `${i.w}x${i.h} quad=${quad(i).map((p) => p.slice(0, 3).join("/")).join(" ")}`);
});
await guard("image-rotate", "rotate+flip combined & JPG output", async () => {
  await open(page, "/image/rotate", ["IMAGE-12-portrait.jpg"]); await page.locator("select").first().selectOption({ label: "90° clockwise" }); await page.locator("select").nth(1).selectOption({ label: "JPG" });
  await runAction(page, /^Apply/); const [f] = await download(page, "rot-photo"); const i = await imageInfo(f.path);
  rec("image-rotate", "portrait photo 90° → 1600x1000 JPEG", i.w === 1600 && i.h === 1000 && fmtOf(f.path) === "jpeg" ? "PASS" : "FAIL", `${i.w}x${i.h} ${fmtOf(f.path)}`);
});

// ---------- REMOVE METADATA ----------
await guard("image-metadata-remove", "EXIF removed", async () => {
  const before = fs.readFileSync(fx("IMAGE-10-exif.jpg")).toString("latin1");
  await open(page, "/image/remove-metadata", ["IMAGE-10-exif.jpg"]);
  const r = await runAction(page, /^Remove metadata from 1 image/); const [f] = await download(page, "meta-img"); const i = await imageInfo(f.path); const src = await imageInfo(fx("IMAGE-10-exif.jpg"));
  const after = fs.readFileSync(f.path).toString("latin1");
  rec("image-metadata-remove", "input contains AuditCam EXIF; output does not; pixels same size/similar", before.includes("AuditCam") && r.ok && !after.includes("AuditCam") && !after.includes("Exif") && i.w === 1200 && i.h === 800 && psnr(src, i) > 30 ? "PASS" : "FAIL", `inHas=${before.includes("AuditCam")} outHas=${after.includes("AuditCam")} ${i.w}x${i.h} psnr=${psnr(src, i)} fmt=${fmtOf(f.path)} ${fs.statSync(f.path).size}B`);
});
await guard("image-metadata-remove", "PNG input", async () => {
  await open(page, "/image/remove-metadata", ["IMAGE-11-quadrants.png"]);
  const r = await runAction(page, /^Remove metadata from 1 image/); const [f] = await download(page, "meta-png"); const i = await imageInfo(f.path);
  rec("image-metadata-remove", "PNG in → valid image, same colours", r.ok && isQuad(i, [RED, GREEN, BLUE, YELLOW]) ? "PASS" : "FAIL", `${fmtOf(f.path)} ${i.w}x${i.h}`);
});

// ---------- SVG → PNG ----------
await guard("svg-to-png", "default + 2x + transparency", async () => {
  await open(page, "/image/svg-to-png", ["IMAGE-08-vector.svg"]);
  const r = await runAction(page, /^Convert to PNG/); const [f] = await download(page, "svg-a"); const i = await imageInfo(f.path);
  const bg = pxAt(i, 620, 200), rect = pxAt(i, 100, 80);
  rec("svg-to-png", "640x420 SVG → PNG at native size, orange rect + transparent background", r.ok && i.w === 640 && i.h === 420 && bg[3] === 0 && near(rect, [234, 88, 12], 30) ? "PASS" : "FAIL", `${i.w}x${i.h} bgAlpha=${bg[3]} rect=${rect}`);
  await open(page, "/image/svg-to-png", ["IMAGE-08-vector.svg"]); await page.getByLabel("Width (px)").fill("1280");
  await runAction(page, /^Convert to PNG/); const [g] = await download(page, "svg-b"); const j = await imageInfo(g.path);
  rec("svg-to-png", "width 1280 → 1280x840 crisp", j.w === 1280 && j.h === 840 ? "PASS" : "FAIL", `${j.w}x${j.h}`);
});
await guard("svg-to-png", "malicious SVG", async () => {
  dialogs.length = 0;
  await open(page, "/image/svg-to-png", ["IMAGE-09-malicious.svg"]);
  const r = await runAction(page, /^Convert to PNG/);
  let detail = r.ok ? "converted" : "refused: " + r.text.slice(0, 100);
  if (r.ok) { const [f] = await download(page, "svg-evil"); const i = await imageInfo(f.path); detail += ` ${i.w}x${i.h} px=${pxAt(i, 50, 50)}`; }
  await page.waitForTimeout(500);
  rec("svg-to-png", "script/onload/external image in SVG: no script ran, no dialog", dialogs.length === 0 ? "PASS" : "FAIL", `${detail}; dialogs=${dialogs.length}`);
});
await guard("svg-to-png", "invalid SVG", async () => {
  fs.writeFileSync("qa/evidence/broken.svg", "<svg><not closed");
  await open(page, "/image/svg-to-png", [`${process.cwd()}/qa/evidence/broken.svg`]);
  const r = await runAction(page, /^Convert to PNG/);
  rec("svg-to-png", "broken SVG → clear error", !r.ok && r.text ? "PASS" : "FAIL", r.text.slice(0, 120));
});

// ---------- 6 CONVERTERS ----------
const conv = [["jpg-to-png", "IMAGE-12-portrait.jpg", "png"], ["png-to-jpg", "IMAGE-03-photo.png", "jpeg"], ["jpg-to-webp", "IMAGE-13-landscape.jpg", "webp"], ["webp-to-jpg", "IMAGE-07-photo.webp", "jpeg"], ["png-to-webp", "IMAGE-03-photo.png", "webp"], ["webp-to-png", "IMAGE-07-photo.webp", "png"]];
for (const [id, file, fmt] of conv) await guard(id, "convert", async () => {
  await open(page, "/convert/" + id, [file]);
  const uiText = await page.locator("main").innerText();
  const r = await runAction(page, /^Convert/); const res = (await page.locator("main").innerText());
  const [f] = await download(page, "conv-" + id); const i = await imageInfo(f.path); const src = await imageInfo(fx(file));
  const p = psnr(src, i); const insize = fs.statSync(fx(file)).size, outsize = fs.statSync(f.path).size;
  const wording = /compress/i.test(res.split("How it works")[0]) ? "UI calls it compression!" : "no 'compress' wording";
  rec(id, `${file} → ${fmt}`, r.ok && fmtOf(f.path) === fmt && i.w === src.w && i.h === src.h && p > 30 && !/compress/i.test(res.split("How it works")[0].replace(/compressed at/, "")) ? "PASS" : "FAIL", `${src.w}x${src.h} → ${i.w}x${i.h} ${fmtOf(f.path)} psnr=${p} bytes ${insize}→${outsize} (${(((insize - outsize) / insize) * 100).toFixed(1)}%) ${wording}`);
});
await guard("png-to-jpg", "transparent PNG", async () => {
  await open(page, "/convert/png-to-jpg", ["IMAGE-04-transparent.png"]); await page.getByRole("note").waitFor({ timeout: 20000 }).catch(() => {});
  const warn = (await page.locator("main").innerText()).match(/[^\n]*transparen[^\n]*/i)?.[0] ?? "";
  await runAction(page, /^Convert/); const [f] = await download(page, "conv-png2jpg-alpha"); const i = await imageInfo(f.path); const corner = pxAt(i, 3, 3);
  rec("png-to-jpg", "transparent PNG → JPG: warned, background is white (not black)", warn && corner[0] > 230 && corner[1] > 230 && corner[2] > 230 ? "PASS" : "FAIL", `warning="${warn.slice(0, 90)}" corner=${corner}`);
});
await guard("png-to-webp", "transparent PNG keeps alpha", async () => {
  await open(page, "/convert/png-to-webp", ["IMAGE-04-transparent.png"]);
  await runAction(page, /^Convert/); const [f] = await download(page, "conv-png2webp-alpha"); const i = await imageInfo(f.path); const corner = pxAt(i, 3, 3);
  rec("png-to-webp", "alpha preserved in WebP", corner[3] === 0 && fmtOf(f.path) === "webp" ? "PASS" : "FAIL", `corner alpha=${corner[3]}`);
});
await guard("webp-to-png", "transparent WebP keeps alpha", async () => {
  await open(page, "/convert/webp-to-png", ["IMAGE-14-transparent.webp"]);
  await runAction(page, /^Convert/); const [f] = await download(page, "conv-webp2png-alpha"); const i = await imageInfo(f.path);
  rec("webp-to-png", "alpha preserved in PNG", pxAt(i, 3, 3)[3] === 0 && fmtOf(f.path) === "png" ? "PASS" : "FAIL", `corner alpha=${pxAt(i, 3, 3)[3]}`);
});
await guard("jpg-to-png", "batch of 2", async () => {
  await open(page, "/convert/jpg-to-png", ["IMAGE-12-portrait.jpg", "IMAGE-13-landscape.jpg"]);
  const r = await runAction(page, /^Convert 2 files/); const files = await download(page, "conv-batch");
  rec("jpg-to-png", "2 files → ZIP of 2 PNGs", r.ok && files.length === 2 && files.every((f) => fmtOf(f.path) === "png") ? "PASS" : "FAIL", files.map((f) => f.name).join(","));
});
await guard("jpg-to-png", "wrong file type", async () => {
  await open(page, "/convert/jpg-to-png", ["DOC-02-markdown.md"]); await page.getByText(/supported by/).waitFor({ timeout: 10000 }).catch(() => {});
  const msg = (await page.locator("main").innerText()).replace(/\n+/g, " | ");
  rec("jpg-to-png", "non-image upload refused", /isn.t supported|not supported/i.test(msg) ? "PASS" : "FAIL", (msg.match(/[^|]*supported[^|]*/) ?? [""])[0]);
});

rec("(all image tools)", "browser console/page errors", errors.length ? "FAIL" : "PASS", errors.slice(0, 3).join(" ;; "));
save("image-tools"); await browser.close();
