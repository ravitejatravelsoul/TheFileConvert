import { PDFArray, PDFDict, PDFDocument, PDFRef, PDFStream, type LoadOptions, type PDFContext, type PDFObject } from "pdf-lib";

/**
 * Loads a PDF for modification. Every tool that loads a PDF and saves it again must use this instead of
 * PDFDocument.load directly.
 *
 * Why: PDFs that were edited with an incremental update (very common — scanner apps, signing and
 * "content credentials" tools, Acrobat saves) contain objects with a generation number above 0. pdf-lib
 * writes those back incorrectly: the reference `7 1 R` ends up pointing at nothing (and inside an object
 * stream a generation above 0 isn't even allowed), so strict readers — Acrobat, Windows, qpdf, MuPDF —
 * report the saved file as damaged or unopenable while lenient ones still show it. Renumbering such
 * objects to generation 0 before anything else touches the document makes every save valid.
 */
export async function loadPdfForEditing(bytes: ArrayBuffer | Uint8Array, options: LoadOptions = {}): Promise<PDFDocument> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true, ...options });
  } catch (e) {
    // pdf-lib can't even parse some encrypted files (their object streams are encrypted too).
    if (looksEncrypted(bytes)) throw new EncryptedPdfError();
    throw e;
  }
  // pdf-lib can't decrypt. An encrypted PDF — including the common kind that opens without a password
  // but carries an "owner password" (many bank statements, tickets and forms) — would be written back
  // with its content still encrypted but without the key: blank or unopenable pages. Refuse instead.
  if (doc.isEncrypted) throw new EncryptedPdfError();
  normalizeGenerations(doc.context);
  return doc;
}

/** The PDF is encrypted (with or without an open password); tools that rewrite it can't process it. */
export class EncryptedPdfError extends Error {
  constructor() {
    super("This PDF is protected with a password or encryption, so it can't be changed here. Remove the protection first (for example, print it to a new PDF from your PDF viewer), then try again.");
    this.name = "EncryptedPdfError";
  }
}

function looksEncrypted(bytes: ArrayBuffer | Uint8Array): boolean {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const tail = new TextDecoder("latin1").decode(u8.subarray(Math.max(0, u8.length - 4096)));
  return /\/Encrypt\s+\d+\s+\d+\s+R/.test(tail) || /\/Encrypt\s*<</.test(tail);
}

/** Moves every object with a non-zero generation to a fresh generation-0 number and rewrites every
 * reference to it (in objects and the trailer). Returns how many objects were moved. */
export function normalizeGenerations(context: PDFContext): number {
  const moves = new Map<PDFRef, PDFRef>();
  for (const [ref] of context.enumerateIndirectObjects()) {
    if (ref.generationNumber !== 0) moves.set(ref, context.nextRef());
  }
  if (moves.size === 0) return 0;

  for (const [from, to] of moves) {
    const obj = context.lookup(from);
    if (obj) context.assign(to, obj);
    context.delete(from);
  }

  replaceReferences(context, moves);
  return moves.size;
}

/** Rewrites every reference in the document (objects and trailer) according to `moves`. Used when an
 * object is renumbered or replaced by another, so nothing is left pointing at a removed object. */
export function replaceReferences(context: PDFContext, moves: Map<PDFRef, PDFRef>): void {
  if (moves.size === 0) return;
  const swap = (value: PDFObject | undefined): PDFObject | undefined => (value instanceof PDFRef ? moves.get(value) : undefined);
  const rewrite = (obj: PDFObject | undefined) => {
    const dict = obj instanceof PDFStream ? obj.dict : obj instanceof PDFDict ? obj : null;
    if (dict) {
      for (const [key, value] of dict.entries()) {
        const moved = swap(value);
        if (moved) dict.set(key, moved);
        else rewrite(value);
      }
    } else if (obj instanceof PDFArray) {
      for (let i = 0; i < obj.size(); i++) {
        const value = obj.get(i);
        const moved = swap(value);
        if (moved) obj.set(i, moved);
        else rewrite(value);
      }
    }
  };
  for (const [, obj] of context.enumerateIndirectObjects()) rewrite(obj);
  const trailer = context.trailerInfo;
  for (const key of ["Root", "Info", "Encrypt"] as const) {
    const moved = swap(trailer[key] as PDFObject | undefined);
    if (moved) trailer[key] = moved;
    else rewrite(trailer[key] as PDFObject | undefined);
  }
}
