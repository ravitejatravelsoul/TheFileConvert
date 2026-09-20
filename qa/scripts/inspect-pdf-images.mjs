import fs from "node:fs"; import { PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
for (const f of process.argv.slice(2)) {
  const d = await PDFDocument.load(fs.readFileSync(f), { updateMetadata: false });
  console.log(f, fs.statSync(f).size, "bytes,", d.getPageCount(), "pages");
  const rows = [];
  for (const [ref, o] of d.context.enumerateIndirectObjects()) {
    if (!(o instanceof PDFRawStream)) continue; const sd = o.dict; if (sd.get(PDFName.of("Subtype"))?.toString() !== "/Image") continue;
    const g = (k) => sd.get(PDFName.of(k))?.toString();
    rows.push(`  ${ref} filter=${g("Filter")} cs=${g("ColorSpace")?.slice(0, 30)} bpc=${g("BitsPerComponent")} ${g("Width")}x${g("Height")} bytes=${o.contents.length} smask=${!!g("SMask")} parms=${g("DecodeParms")?.replace(/\s+/g, " ").slice(0, 70) ?? ""}`);
  }
  console.log(rows.slice(0, 12).join("\n"), rows.length > 12 ? `\n  … ${rows.length} images total` : "");
}
