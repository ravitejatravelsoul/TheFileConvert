import { inflate } from "./zlib";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef, PDFStream, type PDFContext, type PDFObject, type SaveOptions } from "pdf-lib";

/** Thrown when a PDF this app produced fails its own integrity check. The file is never offered. */
export class OutputIntegrityError extends Error {
  constructor(public readonly problems: string[]) {
    super("The result didn't pass our file check, so it wasn't saved. Please try again — if it keeps happening, this PDF may be damaged.");
    this.name = "OutputIntegrityError";
  }
}

function danglingRefs(context: PDFContext): number {
  let missing = 0;
  const seen = new Set<PDFObject>();
  const visit = (obj: PDFObject | undefined) => {
    if (!obj || seen.has(obj)) return;
    if (obj instanceof PDFRef) {
      if (!context.lookup(obj)) missing++;
      return;
    }
    seen.add(obj);
    const dict = obj instanceof PDFStream ? obj.dict : obj instanceof PDFDict ? obj : null;
    if (dict) for (const [, v] of dict.entries()) visit(v);
    else if (obj instanceof PDFArray) for (let i = 0; i < obj.size(); i++) visit(obj.get(i));
  };
  for (const [, obj] of context.enumerateIndirectObjects()) visit(obj);
  return missing;
}

const latin1 = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);

interface XrefEntry {
  type: 0 | 1 | 2;
  /** type 1: byte offset; type 2: object-stream number */
  a: number;
  /** type 1: generation; type 2: index in the object stream */
  b: number;
}

/**
 * Reads the file's final cross-reference section the way strict readers (Acrobat, Windows, qpdf) do —
 * by byte offset, not by scanning — and checks it against the objects actually there. pdf-lib and pdf.js
 * re-read leniently and would accept a file whose xref and trailer are inconsistent, so this is the check
 * that tells an openable file from one that only some viewers can repair.
 */
async function checkXref(bytes: Uint8Array): Promise<string[]> {
  const problems: string[] = [];
  const tailText = latin1(bytes.subarray(Math.max(0, bytes.length - 2048)));
  const start = Number([...tailText.matchAll(/startxref\s+(\d+)/g)].pop()?.[1]);
  if (!Number.isFinite(start) || start <= 0 || start >= bytes.length) return ["startxref points outside the file"];

  const entries = new Map<number, XrefEntry>();
  let trailer = "";
  const at = latin1(bytes.subarray(start, Math.min(bytes.length, start + 64)));
  if (at.startsWith("xref")) {
    // Classic table: "xref", then subsections "first count" of 20-byte entries, then "trailer << … >>".
    const text = latin1(bytes.subarray(start));
    const end = text.indexOf("trailer");
    if (end < 0) return ["xref table has no trailer"];
    const lines = text.slice(4, end).split(/\r\n|\r|\n/).map((l) => l.trim()).filter(Boolean);
    let num = -1;
    for (const line of lines) {
      const sub = /^(\d+) (\d+)$/.exec(line);
      const ent = /^(\d{10}) (\d{5}) ([nf])$/.exec(line);
      if (sub) num = Number(sub[1]);
      else if (ent && num >= 0) {
        if (entries.has(num)) problems.push(`object ${num} listed twice in the xref table`);
        entries.set(num, { type: ent[3] === "n" ? 1 : 0, a: Number(ent[1]), b: Number(ent[2]) });
        num++;
      } else return [...problems, `malformed xref line "${line.slice(0, 30)}"`];
    }
    trailer = text.slice(end, end + 2048);
  } else {
    // Cross-reference stream: "N G obj << /Type /XRef /W [..] /Index [..] /Size .. >> stream … endstream".
    const head = latin1(bytes.subarray(start, Math.min(bytes.length, start + 4096)));
    const m = /^\d+ \d+ obj\s*(<<[\s\S]*?>>)\s*stream(\r\n|\n|\r)/.exec(head);
    if (!m || !/\/Type\s*\/XRef/.test(m[1])) return ["startxref does not point at a cross-reference table or stream"];
    trailer = m[1];
    const length = Number(/\/Length (\d+)/.exec(m[1])?.[1]);
    const w = (/\/W\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(m[1]) ?? []).slice(1).map(Number);
    const size = Number(/\/Size (\d+)/.exec(m[1])?.[1]);
    const index = (/\/Index\s*\[([\d\s]+)\]/.exec(m[1])?.[1] ?? `0 ${size}`).trim().split(/\s+/).map(Number);
    if (!Number.isFinite(length) || w.length !== 3) return ["cross-reference stream dictionary is incomplete"];
    const dataStart = start + m[0].length;
    let data = bytes.subarray(dataStart, dataStart + length);
    if (/\/Filter\s*\/FlateDecode/.test(m[1])) {
      try {
        data = await inflate(data);
      } catch {
        return ["cross-reference stream does not decompress"];
      }
    } else if (/\/Filter/.test(m[1])) return problems; // an encoding we don't read; leave it to the parse checks
    if (/\/Predictor\s+1[0-5]/.test(m[1])) {
      // PNG "Up" predictor rows (pdf-lib doesn't write these, but other producers do).
      const cols = w[0] + w[1] + w[2];
      const rows = Math.floor(data.length / (cols + 1));
      const out = new Uint8Array(rows * cols);
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out[r * cols + c] = (data[r * (cols + 1) + 1 + c] + (r > 0 ? out[(r - 1) * cols + c] : 0)) & 0xff;
      data = out;
    }
    const field = (pos: number, width: number) => {
      let v = 0;
      for (let i = 0; i < width; i++) v = v * 256 + data[pos + i];
      return v;
    };
    let pos = 0;
    for (let s = 0; s + 1 < index.length; s += 2) {
      for (let k = 0; k < index[s + 1]; k++) {
        const num = index[s] + k;
        const type = (w[0] === 0 ? 1 : field(pos, w[0])) as 0 | 1 | 2;
        const entry = { type, a: field(pos + w[0], w[1]), b: field(pos + w[0] + w[1], w[2]) };
        pos += w[0] + w[1] + w[2];
        if (entries.has(num)) problems.push(`object ${num} listed twice in the xref stream`);
        entries.set(num, entry);
      }
    }
  }

  if (/\/Prev\s+\d+/.test(trailer)) return problems; // incremental file: only its newest section is ours to judge
  const size = Number(/\/Size (\d+)/.exec(trailer)?.[1]);
  const maxNum = Math.max(0, ...entries.keys());
  if (!(size > maxNum)) problems.push(`trailer /Size ${size} doesn't cover object ${maxNum}`);

  for (const [num, e] of entries) {
    if (e.type === 1) {
      const header = latin1(bytes.subarray(e.a, Math.min(bytes.length, e.a + 32)));
      const found = /^\s*(\d+)\s+(\d+)\s+obj/.exec(header);
      if (!found || Number(found[1]) !== num || Number(found[2]) !== e.b) problems.push(`xref entry for object ${num} ${e.b} doesn't point at that object`);
    } else if (e.type === 2) {
      const container = entries.get(e.a);
      if (!container || container.type !== 1) problems.push(`object ${num} is in object stream ${e.a}, which doesn't exist`);
    }
  }
  const root = /\/Root (\d+) (\d+) R/.exec(trailer);
  if (!root) problems.push("trailer has no /Root");
  else {
    const e = entries.get(Number(root[1]));
    const gen = Number(root[2]);
    if (!e || e.type === 0 || (e.type === 1 && e.b !== gen) || (e.type === 2 && gen !== 0)) problems.push(`trailer /Root ${root[1]} ${root[2]} R has no matching object`);
  }
  if (problems.length > 12) return [...problems.slice(0, 12), `…and ${problems.length - 12} more`];
  return problems;
}

/**
 * Independent re-read of a finished PDF: it must parse, its trailer must lead to a real catalog and page
 * tree, the page count must be what the tool meant to produce, and no reference may point at an object
 * that isn't there (the failure mode behind "We can't open this file" in strict viewers).
 */
export async function verifyPdfBytes(bytes: Uint8Array, expect: { pages?: number; allowedMissingRefs?: number } = {}): Promise<string[]> {
  const problems: string[] = [];
  const head = latin1(bytes.subarray(0, 1024));
  const tail = latin1(bytes.subarray(Math.max(0, bytes.length - 1024)));
  if (!head.includes("%PDF-")) problems.push("missing %PDF header");
  if (!tail.includes("%%EOF")) problems.push("missing %%EOF");
  if (!/startxref\s+\d+/.test(tail)) problems.push("missing startxref");
  else problems.push(...(await checkXref(bytes)));
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  } catch (e) {
    return [...problems, `does not parse: ${(e as Error).message}`];
  }
  const root = doc.context.trailerInfo.Root;
  const catalog = root instanceof PDFRef ? doc.context.lookup(root) : root;
  if (!(catalog instanceof PDFDict) || !(catalog.lookup(PDFName.of("Pages")) instanceof PDFDict)) {
    problems.push("trailer /Root does not lead to a catalog with a page tree");
    return problems;
  }
  const pages = doc.getPageCount();
  if (pages < 1) problems.push("no pages");
  if (expect.pages !== undefined && pages !== expect.pages) problems.push(`expected ${expect.pages} pages, found ${pages}`);
  const missing = danglingRefs(doc.context);
  if (missing > (expect.allowedMissingRefs ?? 0)) problems.push(`${missing} reference(s) to missing objects`);
  return problems;
}

/** Saves a document and verifies the bytes before anyone sees them. Every tool that writes a PDF uses this. */
export async function savePdfChecked(doc: PDFDocument, options: SaveOptions = {}, expect: { pages?: number } = {}): Promise<Uint8Array> {
  // References that were already broken in the source (rare, but real files have them) are tolerated;
  // any new one is ours and fails the check.
  const allowedMissingRefs = danglingRefs(doc.context);
  const bytes = await doc.save(options);
  const problems = await verifyPdfBytes(bytes, { pages: expect.pages ?? doc.getPageCount(), allowedMissingRefs });
  if (problems.length > 0) throw new OutputIntegrityError(problems);
  return bytes;
}
