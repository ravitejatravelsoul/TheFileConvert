/**
 * Editing an image that is already in the PDF: move, resize, rotate, replace, delete.
 *
 * An image is drawn by a `Do` (or an inline `BI … EI`) under the current transformation matrix. To change where it is drawn,
 * the operation is wrapped — `q <X> cm … Q` — with X chosen so that the new placement is exactly the requested one; the
 * operation itself and everything around it are untouched, and the page's flips and scales (a producer's base `cm`) are
 * accounted for. Deleting removes the operation. Replacing draws another image XObject in the same place.
 */
import { PDFDict, PDFName, PDFRef, type PDFDocument, type PDFPage } from "pdf-lib";
import { commitStreams } from "./apply";
import { interpretPage, invert, mul, type ImagePlacement, type Matrix, type PageContent } from "./interpreter";
import { StreamEditor } from "./streamedit";
import { fmtNum, serName } from "./tokenizer";

export type ImageEditResult = { ok: true } | { ok: false; reason: string };

const fail = (reason: string): ImageEditResult => ({ ok: false, reason });

/** Unit square → page for a rectangle `box` (page space, y up) turned by `degrees` about its centre. */
export function matrixForBox(box: { x: number; y: number; width: number; height: number }, degrees = 0): Matrix {
  const a = (degrees * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  // unit square corner (0,0) → page: centre + R·(−w/2, −h/2)
  const ox = cx + cos * (-box.width / 2) - sin * (-box.height / 2);
  const oy = cy + sin * (-box.width / 2) + cos * (-box.height / 2);
  return [box.width * cos, box.width * sin, -box.height * sin, box.height * cos, ox, oy];
}

/** The page-space transform that takes the image from where it is to where `target` (unit square → page) puts it. */
export function placementDelta(from: Matrix, to: Matrix): Matrix {
  return mul(invert(from), to);
}

function streamEditor(content: PageContent, placement: ImagePlacement): StreamEditor | null {
  const st = content.streams.get(placement.streamKey);
  return st ? new StreamEditor(st.bytes, st.ops) : null;
}

/** Puts the image at `target` (unit square → page space). */
export function placeImage(page: PDFPage, content: PageContent, placement: ImagePlacement, target: Matrix): ImageEditResult {
  const ed = streamEditor(content, placement);
  if (!ed) return fail("The page content couldn't be read.");
  // new CTM = X × CTM_here must equal `target`  →  X = target × CTM_here⁻¹
  const x = mul(target, invert(placement.ctm));
  ed.insertBefore(placement.opIndex, `q ${x.map(fmtNum).join(" ")} cm`);
  ed.insertAfter(placement.opIndex, "Q");
  commitStreams(page, content, new Map([[placement.streamKey, ed.build().bytes]]));
  return { ok: true };
}

export function deleteImage(page: PDFPage, content: PageContent, placement: ImagePlacement): ImageEditResult {
  const ed = streamEditor(content, placement);
  if (!ed) return fail("The page content couldn't be read.");
  ed.delete(placement.opIndex);
  commitStreams(page, content, new Map([[placement.streamKey, ed.build().bytes]]));
  return { ok: true };
}

/**
 * Draws `image` where `placement` is, fitted inside its box (aspect ratio kept, centred), and removes the old one.
 * The new image is added to the resources of the stream that holds the old one.
 */
export async function replaceImage(doc: PDFDocument, page: PDFPage, content: PageContent, placement: ImagePlacement, image: { bytes: Uint8Array; mime: "image/png" | "image/jpeg" }): Promise<ImageEditResult> {
  const ed = streamEditor(content, placement);
  const st = content.streams.get(placement.streamKey);
  if (!ed || !st) return fail("The page content couldn't be read.");
  const embedded = image.mime === "image/png" ? await doc.embedPng(image.bytes) : await doc.embedJpg(image.bytes);
  const ctx = doc.context;
  let res: PDFDict | undefined = st.resources ?? page.node.Resources();
  if (!res) {
    res = ctx.obj({}) as PDFDict;
    page.node.set(PDFName.of("Resources"), res);
  }
  let xobjects = ctx.lookup(res.get(PDFName.of("XObject"))) as PDFDict | undefined;
  if (!(xobjects instanceof PDFDict)) {
    xobjects = ctx.obj({}) as PDFDict;
    res.set(PDFName.of("XObject"), xobjects);
  }
  let i = 1;
  while (xobjects.has(PDFName.of(`TFCImg${i}`))) i++;
  const name = `TFCImg${i}`;
  xobjects.set(PDFName.of(name), embedded.ref as PDFRef);

  // fit the new picture inside the old box: scale the unit square (about its centre) so its aspect matches the picture's
  const m = placement.matrix;
  const wOld = Math.hypot(m[0], m[1]);
  const hOld = Math.hypot(m[2], m[3]);
  const aOld = wOld / hOld;
  const aNew = embedded.width / embedded.height;
  const sx = aNew > aOld ? 1 : aNew / aOld;
  const sy = aNew > aOld ? aOld / aNew : 1;
  // scale about the centre (0.5, 0.5) of the unit square
  const fit: Matrix = [sx, 0, 0, sy, 0.5 - 0.5 * sx, 0.5 - 0.5 * sy];
  const target = mul(fit, m);
  const x = mul(target, invert(placement.ctm));
  ed.replace(placement.opIndex, `q ${x.map(fmtNum).join(" ")} cm ${serName(name)} Do Q`);
  commitStreams(page, content, new Map([[placement.streamKey, ed.build().bytes]]));
  void interpretPage;
  return { ok: true };
}

/**
 * The page-space transform that takes an image drawn in `oldBox` (as it appears now) to `newBox`, turned by `degrees` about the
 * new box's centre. Pass it, composed after the image's current matrix, to `placeImage`.
 */
export function boxTransform(oldBox: { x: number; y: number; width: number; height: number }, newBox: { x: number; y: number; width: number; height: number }, degrees = 0): Matrix {
  return placementDelta(matrixForBox(oldBox), matrixForBox(newBox, degrees));
}

/** The image's matrix after applying `transform` (page space) to its current placement. */
export function transformedPlacement(placement: ImagePlacement, transform: Matrix): Matrix {
  return mul(placement.matrix, transform);
}
