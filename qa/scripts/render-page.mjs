// node qa/scripts/render-page.mjs in.pdf page scale out.png [cropX cropY cropW cropH (fractions)]
import fs from "node:fs"; import { createCanvas } from "@napi-rs/canvas"; import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
const [, , f, pg, sc, out, ...crop] = process.argv;
const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(f)), useSystemFonts: true, verbosity: 0 }).promise;
const page = await doc.getPage(+pg); const vp = page.getViewport({ scale: +sc });
const c = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height)); const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
await page.render({ canvasContext: ctx, viewport: vp, canvas: c }).promise;
if (crop.length) { const [x, y, w, h] = crop.map(Number); const o = createCanvas(Math.round(c.width * w), Math.round(c.height * h)); o.getContext("2d").drawImage(c, -Math.round(c.width * x), -Math.round(c.height * y)); fs.writeFileSync(out, o.toBuffer("image/png")); } else fs.writeFileSync(out, c.toBuffer("image/png"));
