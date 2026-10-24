/**
 * Content rotation for objects whose content has an "up" — added text, images, signatures and scanned-
 * word corrections.
 *
 * An object's box (x, y, width, height) is always in the page's own unrotated PDF space. Its *content*
 * is additionally turned counter-clockwise by `rotation` inside that box. Content created on a page that
 * is shown rotated by R (its /Rotate plus any turn made in the editor) gets rotation R, so it reads
 * upright on screen and in every viewer — instead of turning sideways with the page, which is what
 * happened to text, signatures and pictures placed on a scan stored sideways with /Rotate 90.
 *
 * The content's own frame: `width` × `height` as the content sees them (swapped against the box for
 * 90/270), origin at the content's bottom-left, y up — the frame text layout and image drawing use.
 */
export type ContentRotation = 0 | 90 | 180 | 270;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function normalizeContentRotation(r: number | undefined): ContentRotation {
  const n = ((((r ?? 0) % 360) + 360) % 360) as number;
  return n === 90 || n === 180 || n === 270 ? n : 0;
}

export function contentFrame(box: Box, rotation?: number) {
  const r = normalizeContentRotation(rotation);
  const swapped = r === 90 || r === 270;
  const width = swapped ? box.height : box.width;
  const height = swapped ? box.width : box.height;
  /** Content-local point (u right, v up from the content's bottom-left) → PDF page point. */
  const toPdf = (u: number, v: number) => {
    switch (r) {
      case 90:
        return { x: box.x + box.width - v, y: box.y + u };
      case 180:
        return { x: box.x + box.width - u, y: box.y + box.height - v };
      case 270:
        return { x: box.x + v, y: box.y + box.height - u };
      default:
        return { x: box.x + u, y: box.y + v };
    }
  };
  /** A content-local rectangle → the PDF-space rectangle it covers. */
  const rectToPdf = (u: number, v: number, w: number, h: number): Box => {
    const a = toPdf(u, v);
    const b = toPdf(u + w, v + h);
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
  };
  return { rotation: r, width, height, toPdf, rectToPdf };
}

/** The box after the content's height changes to `h`, keeping the content's top edge where it is
 * (text boxes grow downward as the user types, whichever way the page is turned). */
export function withContentHeight(box: Box, rotation: number | undefined, h: number): Partial<Box> {
  switch (normalizeContentRotation(rotation)) {
    case 90:
      return { width: h };
    case 180:
      return { height: h };
    case 270:
      return { x: box.x + box.width - h, width: h };
    default:
      return { y: box.y + box.height - h, height: h };
  }
}
