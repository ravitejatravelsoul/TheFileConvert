import fs from "node:fs"; import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
const [f, pg] = process.argv.slice(2); const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(f)), verbosity: 0 }).promise; const p = await doc.getPage(+pg); const t = await p.getTextContent();
console.log(t.items.filter((i) => i.str.trim()).slice(0, 8).map((i) => `${i.str.slice(0, 40)} @${i.transform[4].toFixed(0)},${i.transform[5].toFixed(0)}`).join("\n"));
console.log("...", t.items.filter((i) => /EDITED|AUDIT/.test(i.str)).map((i) => `${i.str} @${i.transform[4].toFixed(0)},${i.transform[5].toFixed(0)}`));
