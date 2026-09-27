import { PDFDocument, PDFName, PDFRef } from "pdf-lib";

/**
 * Test-only: appends an incremental update that moves the catalog to a new object at generation 1 — the
 * structure of the user's scan (ReportLab original + a "content credentials" update) that pdf-lib used to
 * write back as an unopenable file. `bytes` must use a classic xref table (save with useObjectStreams: false).
 */
export async function withGenerationOneCatalog(bytes: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes);
  const pagesRef = doc.catalog.get(PDFName.of("Pages")) as PDFRef;
  const text = new TextDecoder("latin1").decode(bytes);
  const prev = Number([...text.matchAll(/startxref\s+(\d+)/g)].pop()![1]);
  // Same object number as the original catalog, next generation — how an incremental update replaces a
  // deleted-then-reused object, and exactly what pdf-lib mis-wrote (two objects both numbered N in one xref).
  const n = (doc.context.trailerInfo.Root as PDFRef).objectNumber;
  const size = doc.context.largestObjectNumber + 1;
  let update = "\n";
  const objOffset = bytes.length + update.length;
  update += `${n} 1 obj\n<< /Type /Catalog /Pages ${pagesRef.objectNumber} 0 R >>\nendobj\n`;
  const xrefOffset = bytes.length + update.length;
  update += `xref\n0 1\n0000000000 65535 f \n${n} 1\n${String(objOffset).padStart(10, "0")} 00001 n \n`;
  update += `trailer\n<< /Size ${size} /Root ${n} 1 R /Prev ${prev} >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  const tail = new Uint8Array([...update].map((c) => c.charCodeAt(0)));
  const out = new Uint8Array(bytes.length + tail.length);
  out.set(bytes);
  out.set(tail, bytes.length);
  return out;
}
