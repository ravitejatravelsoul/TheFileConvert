import type { DrawingObjectData, ShapeObjectData } from "./types";

/** Which corner of a shape's (PDF-space, y-up) box a line/arrow starts from; it ends at the
 * opposite corner. "bl" = bottom-left → top-right, which is what a line always was before
 * direction was recorded, so shapes saved without one keep rendering the same way. */
export type LineStartCorner = "bl" | "br" | "tl" | "tr";

/** Picks the start corner for a line/arrow dragged from `start` to `end` (PDF space), so the
 * finished line runs exactly where the user dragged — not always bottom-left → top-right. */
export function startCornerForDrag(start: { x: number; y: number }, end: { x: number; y: number }): LineStartCorner {
  const left = start.x <= end.x;
  const bottom = start.y <= end.y;
  return `${bottom ? "b" : "t"}${left ? "l" : "r"}` as LineStartCorner;
}

/** Start and end points (PDF space) of a line or arrow shape. */
export function lineEndpoints(shape: Pick<ShapeObjectData, "x" | "y" | "width" | "height" | "startCorner">): {
  start: { x: number; y: number };
  end: { x: number; y: number };
} {
  const corner = shape.startCorner ?? "bl";
  const startX = corner.endsWith("l") ? shape.x : shape.x + shape.width;
  const endX = corner.endsWith("l") ? shape.x + shape.width : shape.x;
  const startY = corner.startsWith("b") ? shape.y : shape.y + shape.height;
  const endY = corner.startsWith("b") ? shape.y + shape.height : shape.y;
  return { start: { x: startX, y: startY }, end: { x: endX, y: endY } };
}

/** The natural extents of a freehand stroke's points (they're stored relative to the stroke's
 * own min corner, so min is 0). Never below 1, so a dot or a perfectly straight stroke doesn't
 * divide by zero when the box is resized. */
export function drawingExtents(d: Pick<DrawingObjectData, "points">): { w: number; h: number } {
  let w = 1;
  let h = 1;
  for (const p of d.points) {
    if (p.x > w) w = p.x;
    if (p.y > h) h = p.y;
  }
  return { w, h };
}

/** A stroke's points as absolute PDF-space coordinates, stretched to fill the object's current
 * box — so resizing a drawing scales the ink, in the editor *and* in the exported file. */
export function drawingPdfPoints(d: Pick<DrawingObjectData, "points" | "x" | "y" | "width" | "height">): { x: number; y: number }[] {
  const { w, h } = drawingExtents(d);
  const sx = d.width / w;
  const sy = d.height / h;
  return d.points.map((p) => ({ x: d.x + p.x * sx, y: d.y + p.y * sy }));
}

/** Arrowhead barbs for an arrow from `start` to `end` (PDF space). Shared by the PDF export and
 * the on-canvas preview so both draw the identical head. */
export function arrowHead(
  start: { x: number; y: number },
  end: { x: number; y: number },
  width: number,
  height: number
): { left: { x: number; y: number }; right: { x: number; y: number } } {
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const headLength = Math.max(8, Math.min(24, Math.hypot(width, height) * 0.2));
  const headAngle = Math.PI / 7;
  return {
    left: { x: end.x - headLength * Math.cos(angle - headAngle), y: end.y - headLength * Math.sin(angle - headAngle) },
    right: { x: end.x - headLength * Math.cos(angle + headAngle), y: end.y - headLength * Math.sin(angle + headAngle) },
  };
}

/** Thickness (points) of an underline/strikethrough stroke for an annotation box of this
 * height — used by both export and the on-canvas preview. */
export function annotationLineThickness(boxHeight: number): number {
  return Math.max(1, boxHeight * 0.08);
}
