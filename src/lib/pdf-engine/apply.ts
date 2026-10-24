/** Writes rewritten content streams back into a PDF document (the page's own content, or Form XObjects). */
import { PDFName, PDFRawStream, type PDFPage } from "pdf-lib";
import type { PageContent } from "./interpreter";

/** Replaces the page's content with one Flate stream. */
function writePageContent(page: PDFPage, bytes: Uint8Array) {
  const ctx = page.doc.context;
  const stream = ctx.flateStream(bytes);
  const ref = ctx.register(stream);
  page.node.set(PDFName.of("Contents"), ref);
}

/** Replaces a Form XObject's stream in place (same object number), keeping its dictionary. */
function writeFormContent(page: PDFPage, content: PageContent, key: string, bytes: Uint8Array) {
  const info = content.streams.get(key);
  if (!info?.ref) throw new Error(`No form for ${key}`);
  const ctx = page.doc.context;
  const old = ctx.lookup(info.ref);
  if (!(old instanceof PDFRawStream)) throw new Error("The form is not a stream");
  const dict: Record<string, unknown> = {};
  for (const [k, v] of old.dict.entries()) {
    const name = k.decodeText();
    if (name === "Length" || name === "Filter" || name === "DecodeParms") continue;
    dict[name] = v;
  }
  const stream = ctx.flateStream(bytes, dict as never);
  ctx.assign(info.ref, stream);
}

export function commitStreams(page: PDFPage, content: PageContent, streams: Map<string, Uint8Array>) {
  for (const [key, bytes] of streams) {
    if (key === "page") writePageContent(page, bytes);
    else writeFormContent(page, content, key, bytes);
  }
}
