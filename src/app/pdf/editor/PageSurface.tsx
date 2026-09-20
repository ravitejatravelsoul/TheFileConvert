"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { loadPdfJsDocument, renderPageToCanvas } from "@/lib/processors/pdfjs-utils";
import {
  pdfRectToViewport,
  rectToCssStyle,
  pdfRectToCssStyle,
  pdfToViewportPoint,
  viewportToPdfPoint,
  viewportRectToPdf,
  resizeViewportRect,
  clampRectToBox,
  viewportDimensions,
  type Rect,
  type ResizeHandle,
} from "@/lib/editor/coordinates";
import { viewportSpecForPage, effectiveRotation, type EditorDocument, type EditorObject, type EditorPage, type RgbColor } from "@/lib/editor/types";
import type { NativeTextRegion } from "@/lib/editor/nativeText";
import type { OcrPageResult } from "@/lib/processors/ocr";
import { confidenceTier } from "@/lib/processors/ocr";
import { estimateRegionColors, computeEditPadding, type PixelSource } from "@/lib/editor/regionColor";
import { composeOcrPatch, type ComposeOcrPatchResult } from "@/lib/editor/scanPatch";
import { computeChangedSpan, computeChangedSubRect, type CharBox } from "@/lib/editor/textDiff";
import type { EditorWorkspaceApi, ToolId, SearchMatch } from "./useEditorWorkspace";
import type { ToolOptions } from "./toolOptions";
import { rgbToCss } from "./toolOptions";
import { ObjectView } from "./ObjectView";
import { startCornerForDrag } from "@/lib/editor/shapeGeometry";

export interface OcrColorEstimate {
  backgroundColor: RgbColor;
  textColor: RgbColor;
  complex: boolean;
  /** Padding (PDF points) already folded into `pdfBox` below the request — the caller
   * doesn't need to add its own. */
  paddingPt: number;
}

export interface EditableRegionRequest {
  kind: "native" | "ocr";
  pageId: string;
  text: string;
  confidence?: number;
  /** The tight region to whiteout/patch — for OCR requests this already includes the
   * calibrated padding (see computeEditPadding), so it's slightly larger than the raw OCR
   * word/line box it was derived from. */
  pdfBox: Rect;
  /** The recognized word's own box, without the padding `pdfBox` adds — where the word's ink
   * (and so its baseline) really is. Used to place the invisible searchable-text run. */
  wordPdfBox?: Rect;
  ocrColors?: OcrColorEstimate;
  /** Renders a real, export-identical raster preview of what typing `newText` would look
   * like (scanned-text pipeline only — see scanPatch.ts) — synchronous, cheap enough to call
   * on every keystroke for a single word. Recomputes the *changed-substring* region fresh on
   * every call (see textDiff.ts), since which characters actually changed shifts as the user
   * types — so the returned `pdfBox` is the tight patch region actually used, not the whole
   * word's box (that's still available as this request's own top-level `pdfBox`). Null/
   * undefined when the page canvas isn't available (e.g. still rendering) or the edit is a
   * native-text replacement. */
  composePreview?: (newText: string) => { patch: ComposeOcrPatchResult; pdfBox: Rect } | null;
}

interface PageSurfaceProps {
  api: EditorWorkspaceApi;
  page: EditorPage;
  doc: EditorDocument;
  zoom: number;
  toolOptions: ToolOptions;
  nativeRegions: NativeTextRegion[] | undefined;
  ocrResult: OcrPageResult | undefined;
  showOcrOverlay: boolean;
  activeMatch: SearchMatch | null;
  onRequestTextEdit: (request: EditableRegionRequest) => void;
  pendingPlacement: { kind: "image" | "signature"; dataUrl: string; naturalWidth: number; naturalHeight: number } | null;
  onPlacementComplete: () => void;
}

const MIN_OBJECT_SIZE = 8;
/** Height (points) given to an underline/strikethrough dragged as a flat line. */
const LINE_ANNOTATION_HEIGHT = 12;

/** Tools that stay armed after each use, so several annotations in a row don't need the tool
 * re-selected every time. They end when another tool is chosen, on Escape, or on Select. */
export const PERSISTENT_TOOLS: ReadonlySet<ToolId> = new Set<ToolId>([
  "highlight",
  "underline",
  "strikethrough",
  "draw",
  "whiteout",
  "shape-rectangle",
  "shape-ellipse",
  "shape-line",
  "shape-arrow",
]);

/** Pointer travel (px) under which a press-and-release on an object counts as a click, not a drag. */
const CLICK_SLOP_PX = 4;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function PageSurface({
  api,
  page,
  doc,
  zoom,
  toolOptions,
  nativeRegions,
  ocrResult,
  showOcrOverlay,
  activeMatch,
  onRequestTextEdit,
  pendingPlacement,
  onPlacementComplete,
}: PageSurfaceProps) {
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  /** Device pixels per CSS pixel the base canvas was drawn at (see the render effect). */
  const canvasRatioRef = useRef(1);
  const overlayRef = useRef<HTMLDivElement>(null);
  const file = doc.sourceFiles[page.sourceFileId];
  const spec = useMemo(() => viewportSpecForPage(page, zoom), [page, zoom]);
  const dims = useMemo(() => viewportDimensions(spec), [spec]);

  const [dragState, setDragState] = useState<{
    mode: "draw-rect" | "move" | "resize" | "freehand" | "crop-resize";
    objectId?: string;
    handle?: string;
    startPdf: { x: number; y: number };
    currentPdf?: { x: number; y: number };
    originRect?: Rect;
    points?: { x: number; y: number }[];
    /** Client-space pointer position at press, to tell a click from a drag. */
    clientStart?: { x: number; y: number };
    moved?: boolean;
    /** Whether the pressed object was already selected before this press (click-to-edit text). */
    wasSelected?: boolean;
  } | null>(null);

  const activeTool = api.state.activeTool;
  const objects = useMemo(() => doc.objects.filter((o) => o.pageId === page.id), [doc.objects, page.id]);

  // Render the base page image whenever page/zoom/rotation changes.
  useEffect(() => {
    let cancelled = false;
    if (!file) return;
    (async () => {
      const pdfDoc = await loadPdfJsDocument(file);
      if (cancelled) return;
      // Draw at the display's pixel ratio (capped at 2x to bound memory) so text is crisp on
      // HiDPI/scaled screens; everything else in the editor keeps working in CSS pixels.
      const ratio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      const canvas = await renderPageToCanvas(pdfDoc, page.sourcePageIndex + 1, spec.scale, effectiveRotation(page), ratio);
      if (cancelled) return;
      const host = canvasHostRef.current;
      if (!host) return;
      host.innerHTML = "";
      host.appendChild(canvas);
      baseCanvasRef.current = canvas;
      canvasRatioRef.current = ratio;
    })();
    return () => {
      cancelled = true;
    };
  }, [file, page, spec.scale]);

  function pointFromEvent(e: React.PointerEvent): { x: number; y: number } {
    const rect = overlayRef.current!.getBoundingClientRect();
    const vx = e.clientX - rect.left;
    const vy = e.clientY - rect.top;
    return viewportToPdfPoint(spec, { x: vx, y: vy });
  }

  /** Reads a rectangular slice of the page's own rendered canvas once (fast) and exposes
   * it as a PixelSource — the canvas's own pixel buffer is 1:1 with viewport CSS pixels
   * (see renderPageToCanvas), so a viewport-pixel rect maps directly onto it. */
  function canvasPixelSource(areaPx: Rect): PixelSource | null {
    const canvas = baseCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return null;
    // Callers speak viewport CSS pixels; the canvas buffer may be denser (see canvasRatioRef),
    // so translate at this one boundary and expose the same CSS-pixel coordinate space back.
    const ratio = canvasRatioRef.current;
    const x0 = Math.max(0, Math.floor(areaPx.x * ratio));
    const y0 = Math.max(0, Math.floor(areaPx.y * ratio));
    const x1 = Math.min(canvas.width, Math.ceil((areaPx.x + areaPx.width) * ratio));
    const y1 = Math.min(canvas.height, Math.ceil((areaPx.y + areaPx.height) * ratio));
    const w = Math.max(1, x1 - x0);
    const h = Math.max(1, y1 - y0);
    let imgData: ImageData | null = null;
    try {
      imgData = ctx.getImageData(x0, y0, w, h);
    } catch {
      return null; // e.g. a tainted canvas — fall back to defaults rather than throwing
    }
    return {
      width: canvas.width / ratio,
      height: canvas.height / ratio,
      getPixel(x, y) {
        const lx = Math.max(0, Math.min(w - 1, Math.round(x * ratio) - x0));
        const ly = Math.max(0, Math.min(h - 1, Math.round(y * ratio) - y0));
        const i = (ly * w + lx) * 4;
        const d = imgData!.data;
        return [d[i], d[i + 1], d[i + 2], d[i + 3]];
      },
    };
  }

  /** Checks rightward from the word's own edge, in a few steps, for genuinely blank
   * (background-colored) space to grow a longer replacement into — the "expand into
   * available whitespace only if verified" rule: a longer replacement is allowed extra
   * room only as far as the scan is actually confirmed blank there, never past real
   * neighboring content. Returns how many viewport pixels are safe to grow into. */
  function findSafeExpansionPx(source: PixelSource, wordRectPx: Rect, backgroundColor: RgbColor, maxExtraPx: number): number {
    const bg: [number, number, number] = [backgroundColor.r * 255, backgroundColor.g * 255, backgroundColor.b * 255];
    const steps = 6;
    const stepSize = maxExtraPx / steps;
    let safe = 0;
    for (let i = 1; i <= steps; i++) {
      const testX = wordRectPx.x + wordRectPx.width + i * stepSize;
      let allBackground = true;
      // Inside the word's own height, not on its edges: the bottom edge routinely sits right on a
      // form's underline or table rule, which would read as "not blank" and forbid any growth.
      const sampleYs = [0.25, 0.5, 0.75].map((f) => wordRectPx.y + wordRectPx.height * f);
      for (const testY of sampleYs) {
        const [r, g, b, a] = source.getPixel(testX, testY);
        if (a < 10) continue;
        const dist = Math.hypot(r - bg[0], g - bg[1], b - bg[2]);
        if (dist > 45) {
          allBackground = false;
          break;
        }
      }
      if (!allBackground) break;
      safe = i * stepSize;
    }
    return safe;
  }

  /** Higher-density render scale for the composed raster patch, relative to this page's own
   * on-screen viewport pixels — the patch is small (one word) so a few extra samples per
   * viewport px keeps the exported PDF's embedded image sharp instead of blurry when it ends
   * up scaled to print/zoom resolution. */
  const PATCH_PIXEL_SCALE = 3;

  /** Shared by both word- and line-level OCR click targets: samples the local background
   * and text color from the rendered scan (never assumes white), computes a small
   * calibrated padding, checks for genuinely blank space to grow into for a longer
   * replacement, and hands the caller a ready-to-edit request. `baselinePdfY`, when given
   * (word-level edits only), is a same-line-neighbor-informed baseline estimate (spec
   * section 11) used in place of this word's own box bottom. `chars`, when given (word-level
   * edits only), enables patching just the characters that actually changed instead of the
   * whole word — see computePatchForText below. */
  function requestOcrEdit(
    text: string,
    pdfBox: Rect,
    confidence: number,
    baselinePdfY?: number,
    chars?: CharBox[],
    voterWords?: { text: string; pdfBox: Rect; confidence: number }[]
  ) {
    const paddingPt = computeEditPadding(pdfBox.height, confidence);
    const wordRectPx = pdfRectToViewport(spec, pdfBox);
    const paddingPx = paddingPt * spec.scale;
    // Sample wide enough to the right to check for verified expansion room too (up to one
    // more word-width), not just the tight padding ring used for background/text color. This
    // buffer covers the *whole* word up front and is reused for every keystroke's possibly
    // much smaller changed-substring sub-rect below — re-reading canvas pixels per keystroke
    // would be wasteful when they're already sitting in this one captured buffer.
    const maxExtraPx = wordRectPx.width;
    const samplingAreaPx: Rect = {
      x: wordRectPx.x - paddingPx * 2,
      y: wordRectPx.y - paddingPx * 2,
      width: wordRectPx.width + paddingPx * 4 + maxExtraPx,
      height: wordRectPx.height + paddingPx * 4,
    };
    const source = canvasPixelSource(samplingAreaPx);
    const estimate = source
      ? estimateRegionColors(source, wordRectPx, paddingPx)
      : { backgroundColor: { r: 1, g: 1, b: 1 }, textColor: { r: 0, g: 0, b: 0 }, complex: false };
    const safeExpansionPx = source && !estimate.complex ? findSafeExpansionPx(source, wordRectPx, estimate.backgroundColor, maxExtraPx) : 0;
    const safeExpansionPt = safeExpansionPx / spec.scale;

    // The whole word's own padded box — kept as this request's top-level `pdfBox` (used by
    // the "Detected" display, the native-text path, and as the object rect for the unsafe/
    // manual-overlay fallback, none of which need the tighter changed-substring geometry
    // below to still behave correctly).
    const paddedPdfBox: Rect = {
      x: pdfBox.x - paddingPt,
      y: pdfBox.y - paddingPt,
      width: pdfBox.width + paddingPt * 2 + safeExpansionPt,
      height: pdfBox.height + paddingPt * 2,
    };
    const baselinePx = baselinePdfY !== undefined ? pdfRectToViewport(spec, { x: 0, y: baselinePdfY, width: 0, height: 0 }).y : wordRectPx.y + wordRectPx.height;

    // Always offer the raster-patch pipeline when the canvas is readable — even when the
    // older variance-based `estimate.complex` flag is set. That flag was calibrated for the
    // old "can a single flat color safely fill the whole box" question; the raster pipeline
    // clones real local texture instead of a flat fill and runs its own, more precise
    // line-overlap safety check (see scanPatch.ts's `unsafe`), so it can succeed in plenty of
    // cases the old flag would have blocked outright (e.g. a word merely *near* a ruling
    // line, not actually overlapping it).
    // Same-line neighbors set in the same typeface, each with its own small pixel buffer, so the
    // font matcher judges the document's face from several words rather than only the edited one.
    const styleVoters = source
      ? (voterWords ?? []).flatMap((v) => {
          const rectPx = pdfRectToViewport(spec, v.pdfBox);
          const pad = computeEditPadding(v.pdfBox.height, v.confidence) * spec.scale;
          const voterSource = canvasPixelSource({ x: rectPx.x - pad * 2, y: rectPx.y - pad * 2, width: rectPx.width + pad * 4, height: rectPx.height + pad * 4 });
          if (!voterSource) return [];
          const colors = estimateRegionColors(voterSource, rectPx, pad);
          return [{ source: voterSource, rectPx, text: v.text, backgroundColor: colors.backgroundColor, textColor: colors.textColor }];
        })
      : [];
    const composePreview = source
      ? (newText: string) => {
          // Recomputed fresh on every keystroke: which characters actually changed shifts as
          // the user types (e.g. "2026" -> "2" -> "20" -> "202" -> "2028" each has a
          // different diff against the original), so the patch geometry can't be fixed once
          // at click time — this is the core of the "patch only what changed" fix (spec
          // sections 2-5).
          const span = computeChangedSpan(text, newText);
          // Only a same-length swap of digits (2026 -> 2028, $182.50 -> $182.60) is patched as
          // just the changed characters. Anything else (letters, or a longer/shorter result such
          // as degree -> graduate) redraws the whole word in one face: a partial patch there leaves
          // half old glyphs beside half new ones, has no room to grow, and its per-character
          // boxes are too imprecise to cut a letter cleanly.
          const digitSwap =
            span.originalMiddle.length === span.replacementMiddle.length &&
            /^[0-9]+$/.test(span.originalMiddle) &&
            /^[0-9]+$/.test(span.replacementMiddle);
          const changedPdfBox = (digitSwap ? computeChangedSubRect(chars, text, span) : null) ?? pdfBox;
          const targetPaddingPt = computeEditPadding(changedPdfBox.height, confidence);
          const targetRectPx = pdfRectToViewport(spec, changedPdfBox);
          const targetPaddingPx = targetPaddingPt * spec.scale;
          const targetEstimate = estimateRegionColors(source, targetRectPx, targetPaddingPx);
          const targetMaxExtraPx = targetRectPx.width;
          const targetSafeExpansionPx = !targetEstimate.complex
            ? findSafeExpansionPx(source, targetRectPx, targetEstimate.backgroundColor, targetMaxExtraPx)
            : 0;
          const targetSafeExpansionPt = targetSafeExpansionPx / spec.scale;
          // A replacement with descenders (g, j, p, q, y) needs room below the original word's box
          // when that word had none ("Smith" -> "Smyth"), or its tails would be clipped.
          const descenderRoomPt = /[gjpqy,;]/.test(newText) && !/[gjpqy,;]/.test(text) ? changedPdfBox.height * 0.3 : 0;
          const paddedTargetPdfBox: Rect = {
            x: changedPdfBox.x - targetPaddingPt,
            y: changedPdfBox.y - targetPaddingPt - descenderRoomPt,
            width: changedPdfBox.width + targetPaddingPt * 2 + targetSafeExpansionPt,
            height: changedPdfBox.height + targetPaddingPt * 2 + descenderRoomPt,
          };
          const patch = composeOcrPatch({
            source,
            wordRectPx: targetRectPx,
            patchRectPx: pdfRectToViewport(spec, paddedTargetPdfBox),
            baselinePx,
            originalText: digitSwap ? span.originalMiddle : text,
            newText: digitSwap ? span.replacementMiddle : newText,
            backgroundColor: targetEstimate.backgroundColor,
            textColor: targetEstimate.textColor,
            pixelScale: PATCH_PIXEL_SCALE,
            styleCacheKey: page.id,
            // A single changed character rarely carries enough shape information to match
            // confidently on its own — offer the whole original word (e.g. "12/20/2026") as
            // a richer style reference; scanPatch.ts only uses it when it actually has more
            // ink than the tight changed-substring box.
            styleReferenceRectPx: wordRectPx,
            styleReferenceText: text,
            styleVoters,
          });
          return patch ? { patch, pdfBox: paddedTargetPdfBox } : null;
        }
      : undefined;

    onRequestTextEdit({
      kind: "ocr",
      pageId: page.id,
      text,
      confidence,
      pdfBox: paddedPdfBox,
      wordPdfBox: pdfBox,
      ocrColors: { ...estimate, paddingPt },
      composePreview,
    });
  }

  /** Keeps receiving this pointer's move/up events even after it leaves the page, so a stroke
   * or drag that overshoots the edge still ends cleanly instead of sticking "down". */
  function capturePointer(e: React.PointerEvent) {
    try {
      overlayRef.current?.setPointerCapture(e.pointerId);
    } catch {
      // Capture is best-effort (e.g. the pointer already ended); dragging still works without it.
    }
  }

  function releasePointer(e: React.PointerEvent) {
    try {
      if (overlayRef.current?.hasPointerCapture(e.pointerId)) overlayRef.current.releasePointerCapture(e.pointerId);
    } catch {
      // Already released.
    }
  }

  function handleOverlayPointerDown(e: React.PointerEvent) {
    // Only the primary button / a real touch or pen contact starts an interaction.
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const onBackground = e.target === overlayRef.current || (e.target as HTMLElement).dataset.surfaceBackground === "true";
    // With the Select tool, only a press on empty page starts anything (objects and text
    // regions handle their own presses). Every other tool works anywhere on the page: the
    // objects and text regions beneath are click-through while such a tool is armed.
    if (activeTool === "select" && !onBackground) return;
    const pdfPoint = pointFromEvent(e);

    if (pendingPlacement) {
      // Natural pixels at 96 dpi → points (0.75), kept to a sensible on-page size: not a speck
      // for a small icon, not wider than a page for a big photo.
      // A signature is drawn on a large pad, so it comes in at half size; a picture at 96 dpi.
      const factor = pendingPlacement.kind === "signature" ? 0.5 : 0.75;
      const width = Math.min(240, Math.max(pendingPlacement.kind === "signature" ? 60 : 48, (pendingPlacement.naturalWidth || 200) * factor));
      const height = width * (pendingPlacement.naturalHeight / pendingPlacement.naturalWidth || 1);
      api.addObject({
        id: api.newObjectId(),
        type: pendingPlacement.kind,
        pageId: page.id,
        x: pdfPoint.x - width / 2,
        y: pdfPoint.y - height / 2,
        width,
        height,
        dataUrl: pendingPlacement.dataUrl,
      });
      onPlacementComplete();
      return;
    }

    if (activeTool === "add-text") {
      const width = 160;
      const height = toolOptions.fontSize * 1.4;
      api.addObjectAndSelect({
        id: api.newObjectId(),
        type: "added-text",
        pageId: page.id,
        x: pdfPoint.x,
        y: pdfPoint.y - height / 2,
        width,
        height,
        text: "New text",
        fontSize: toolOptions.fontSize,
        color: toolOptions.color,
        align: toolOptions.align,
        bold: toolOptions.bold,
      }, { startEditing: true, selectAllOnEdit: true });
      // Don't let this press's own default action (focusing the page) steal focus back from
      // the text box that just opened.
      e.preventDefault();
      return;
    }

    if (activeTool === "draw") {
      capturePointer(e);
      setDragState({ mode: "freehand", startPdf: pdfPoint, currentPdf: pdfPoint, points: [pdfPoint] });
      return;
    }

    if (
      activeTool === "whiteout" ||
      activeTool === "shape-rectangle" ||
      activeTool === "shape-ellipse" ||
      activeTool === "shape-line" ||
      activeTool === "shape-arrow" ||
      activeTool === "highlight" ||
      activeTool === "underline" ||
      activeTool === "strikethrough" ||
      activeTool === "crop"
    ) {
      capturePointer(e);
      // currentPdf starts at the press point so the preview exists from the first frame.
      setDragState({ mode: "draw-rect", startPdf: pdfPoint, currentPdf: pdfPoint });
      return;
    }

    // select tool clicking empty space: deselect
    api.setSelectedObjectId(null);
  }

  function handleOverlayPointerMove(e: React.PointerEvent) {
    if (!dragState) return;
    const pdfPoint = pointFromEvent(e);

    if (dragState.mode === "freehand") {
      // Use the browser's coalesced sub-frame samples (when it provides them) so a fast
      // scribble stays smooth instead of turning into a few long straight segments.
      const native = e.nativeEvent as PointerEvent;
      const samples = typeof native.getCoalescedEvents === "function" ? native.getCoalescedEvents() : [];
      const rect = overlayRef.current!.getBoundingClientRect();
      const extra = samples.length > 1
        ? samples.map((s) => viewportToPdfPoint(spec, { x: s.clientX - rect.left, y: s.clientY - rect.top }))
        : [pdfPoint];
      setDragState((d) => (d && d.mode === "freehand" ? { ...d, currentPdf: pdfPoint, points: [...(d.points ?? []), ...extra] } : d));
      return;
    }

    if (dragState.mode === "draw-rect") {
      setDragState((d) => (d && d.mode === "draw-rect" ? { ...d, currentPdf: pdfPoint } : d));
      return;
    }

    if (dragState.mode === "crop-resize" && dragState.originRect && dragState.handle && dragState.clientStart) {
      const vRect = resizeViewportRect(
        pdfRectToViewport(spec, dragState.originRect),
        dragState.handle as ResizeHandle,
        e.clientX - dragState.clientStart.x,
        e.clientY - dragState.clientStart.y,
        { minSize: 24 }
      );
      api.setCropDraft({ pageId: page.id, rect: clampRectToBox(viewportRectToPdf(spec, vRect), page.mediaBox) });
      return;
    }

    const traveled = dragState.clientStart ? Math.hypot(e.clientX - dragState.clientStart.x, e.clientY - dragState.clientStart.y) : Infinity;
    if (!dragState.moved && traveled > CLICK_SLOP_PX) setDragState((d) => (d ? { ...d, moved: true } : d));
    // A press that hasn't traveled past the click slop is still a click; don't nudge the object.
    if (traveled <= CLICK_SLOP_PX && !dragState.moved) return;

    if (dragState.mode === "move" && dragState.objectId && dragState.originRect) {
      const dx = pdfPoint.x - dragState.startPdf.x;
      const dy = pdfPoint.y - dragState.startPdf.y;
      api.previewObject(dragState.objectId, { x: dragState.originRect.x + dx, y: dragState.originRect.y + dy });
      return;
    }

    if (dragState.mode === "resize" && dragState.objectId && dragState.originRect && dragState.handle && dragState.clientStart) {
      const obj = objects.find((o) => o.id === dragState.objectId);
      // Resize in viewport space (handles are named by what's on screen), then convert once —
      // so a corner is the right corner on rotated pages too. Pictures keep their proportions.
      const vRect = resizeViewportRect(
        pdfRectToViewport(spec, dragState.originRect),
        dragState.handle as ResizeHandle,
        e.clientX - dragState.clientStart.x,
        e.clientY - dragState.clientStart.y,
        { keepAspect: obj?.type === "image" || obj?.type === "signature", minSize: MIN_OBJECT_SIZE * spec.scale }
      );
      api.previewObject(dragState.objectId, viewportRectToPdf(spec, vRect));
      return;
    }
  }

  function handleOverlayPointerCancel(e: React.PointerEvent) {
    releasePointer(e);
    if (dragState && (dragState.mode === "move" || dragState.mode === "resize") && dragState.moved) api.commitPreview();
    setDragState(null);
  }

  function handleOverlayPointerUp(e: React.PointerEvent) {
    if (!dragState) return;
    releasePointer(e);
    const pdfPoint = pointFromEvent(e);

    if (dragState.mode === "freehand") {
      const points = [...(dragState.points ?? []), pdfPoint];
      const xs = points.map((p) => p.x);
      const ys = points.map((p) => p.y);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const width = Math.max(...xs) - minX;
      const height = Math.max(...ys) - minY;
      if (points.length > 1) {
        api.addObject({
          id: api.newObjectId(),
          type: "drawing",
          pageId: page.id,
          x: minX,
          y: minY,
          width: Math.max(width, 1),
          height: Math.max(height, 1),
          points: points.map((p) => ({ x: p.x - minX, y: p.y - minY })),
          color: toolOptions.color,
          strokeWidth: toolOptions.strokeWidth,
        }, { select: false });
      }
      // The Draw tool stays armed for the next stroke.
      setDragState(null);
      return;
    }

    if (dragState.mode === "draw-rect") {
      const x0 = Math.min(dragState.startPdf.x, pdfPoint.x);
      const y0 = Math.min(dragState.startPdf.y, pdfPoint.y);
      const width = Math.abs(pdfPoint.x - dragState.startPdf.x);
      const height = Math.abs(pdfPoint.y - dragState.startPdf.y);

      if (activeTool === "crop") {
        if (width > MIN_OBJECT_SIZE && height > MIN_OBJECT_SIZE) {
          const clamped = clampRectToBox({ x: x0, y: y0, width, height }, page.mediaBox);
          if (clamped.width > MIN_OBJECT_SIZE && clamped.height > MIN_OBJECT_SIZE) api.setCropDraft({ pageId: page.id, rect: clamped });
        }
        setDragState(null);
        return;
      }

      // A drag too small to be an object (a stray click) is ignored, and — for the persistent
      // tools — leaves the tool armed rather than dropping back to Select.
      // Underline and strikethrough are a *line*: dragging straight along a word (almost no height)
      // is exactly how they're used, so a flat drag is enough — it gets a text-line-high box whose
      // bottom edge (underline) or middle (strikethrough) sits on the line that was dragged.
      let rect = { x: x0, y: y0, width, height };
      if ((activeTool === "underline" || activeTool === "strikethrough") && width > MIN_OBJECT_SIZE && height <= MIN_OBJECT_SIZE) {
        const centerY = (dragState.startPdf.y + pdfPoint.y) / 2;
        rect = { x: x0, y: activeTool === "underline" ? centerY : centerY - LINE_ANNOTATION_HEIGHT / 2, width, height: LINE_ANNOTATION_HEIGHT };
      }
      if (rect.width > MIN_OBJECT_SIZE && rect.height > MIN_OBJECT_SIZE) {
        const created = buildDrawnObject(activeTool, rect, toolOptions, page.id, api.newObjectId(), {
          start: dragState.startPdf,
          end: pdfPoint,
        });
        // Persistent tools stay armed for the next one. A new shape is also selected (so its
        // color/stroke can be tweaked right away); highlights/underlines/whiteouts aren't, so
        // a run of them doesn't keep re-selecting and swapping the properties panel.
        if (created) api.addObject(created, { select: created.type === "shape" });
      }
      setDragState(null);
      return;
    }

    if (dragState.mode === "crop-resize") {
      setDragState(null);
      return;
    }

    if (dragState.mode === "move" || dragState.mode === "resize") {
      if (dragState.moved) {
        api.commitPreview();
      } else if (dragState.mode === "move" && dragState.objectId && dragState.wasSelected) {
        // A plain click on an already-selected text box drops the caret into it — the same
        // "click again to edit" behavior as Canva/PowerPoint — without needing a double-click.
        const obj = objects.find((o) => o.id === dragState.objectId);
        if (obj?.type === "added-text") api.setEditingObjectId(obj.id);
      }
      setDragState(null);
    }
  }

  function startObjectMove(e: React.PointerEvent, obj: EditorObject) {
    if (activeTool !== "select") return;
    e.stopPropagation();
    const wasSelected = api.state.selectedObjectId === obj.id;
    api.setSelectedObjectId(obj.id);
    capturePointer(e);
    const pdfPoint = pointFromEvent(e);
    setDragState({
      mode: "move",
      objectId: obj.id,
      startPdf: pdfPoint,
      originRect: { x: obj.x, y: obj.y, width: obj.width, height: obj.height },
      clientStart: { x: e.clientX, y: e.clientY },
      wasSelected,
    });
  }

  function startCropResize(e: React.PointerEvent, handle: string) {
    const draft = api.state.cropDraft;
    if (!draft || draft.pageId !== page.id) return;
    e.stopPropagation();
    capturePointer(e);
    setDragState({
      mode: "crop-resize",
      handle,
      startPdf: pointFromEvent(e),
      originRect: draft.rect,
      clientStart: { x: e.clientX, y: e.clientY },
    });
  }

  function startObjectResize(e: React.PointerEvent, obj: EditorObject, handle: string) {
    e.stopPropagation();
    capturePointer(e);
    const pdfPoint = pointFromEvent(e);
    setDragState({
      mode: "resize",
      objectId: obj.id,
      handle,
      startPdf: pdfPoint,
      originRect: { x: obj.x, y: obj.y, width: obj.width, height: obj.height },
      clientStart: { x: e.clientX, y: e.clientY },
    });
  }

  // Live preview rect for draw-rect drags (whiteout/shape/annotation/crop), computed each render.
  const liveDrawRect: Rect | null =
    dragState?.mode === "draw-rect" && dragState.currentPdf
      ? (() => {
          const cur = dragState.currentPdf!;
          const x0 = Math.min(dragState.startPdf.x, cur.x);
          const y0 = Math.min(dragState.startPdf.y, cur.y);
          const r = { x: x0, y: y0, width: Math.abs(cur.x - dragState.startPdf.x), height: Math.abs(cur.y - dragState.startPdf.y) };
          return activeTool === "crop" ? clampRectToBox(r, page.mediaBox) : r;
        })()
      : null;

  // What crop rect (if any) to visualize: an in-progress drag takes priority over a
  // not-yet-applied draft, which takes priority over an already-applied crop box.
  const cropDraftForPage = api.state.cropDraft?.pageId === page.id ? api.state.cropDraft.rect : null;
  const appliedCropRect: Rect | null = page.cropBox
    ? { x: page.cropBox[0], y: page.cropBox[1], width: page.cropBox[2] - page.cropBox[0], height: page.cropBox[3] - page.cropBox[1] }
    : null;
  const cropRectForDisplay: Rect | null =
    activeTool === "crop" && liveDrawRect ? liveDrawRect : (cropDraftForPage ?? appliedCropRect);

  // The invisible click targets over recognized/native text are only live for the Select tool
  // (and not mid-placement of an image/signature): with any drawing tool armed they must be
  // click-through, or a press over text would hit the target instead of starting the stroke.
  const regionsActive = activeTool === "select" && !pendingPlacement;

  const livePreviewObject: EditorObject | null =
    liveDrawRect && activeTool !== "crop"
      ? buildDrawnObject(activeTool, liveDrawRect, toolOptions, page.id, "live-preview", {
          start: dragState!.startPdf,
          end: dragState!.currentPdf ?? dragState!.startPdf,
        })
      : null;

  return (
    <div
      className="relative mx-auto inline-block shrink-0 select-none"
      style={{ width: dims.width, height: dims.height }}
      data-testid="page-surface"
      data-page-id={page.id}
    >
      <div ref={canvasHostRef} className="pointer-events-none absolute inset-0" aria-hidden="true" />
      <div
        ref={overlayRef}
        data-surface-background="true"
        className="absolute inset-0"
        style={{
          cursor: activeTool === "select" ? "default" : "crosshair",
          // Drawing tools own touch/pen gestures on the page (so a stroke isn't turned into a
          // scroll); with Select the page still scrolls under a finger.
          touchAction: activeTool === "select" && !dragState ? "auto" : "none",
        }}
        onPointerDown={handleOverlayPointerDown}
        onPointerMove={handleOverlayPointerMove}
        onPointerUp={handleOverlayPointerUp}
        onPointerCancel={handleOverlayPointerCancel}
      >
        {/* Native text regions */}
        {nativeRegions?.map((region) => {
          const vRect = pdfRectToViewport(spec, region.pdfBox);
          return (
            <button
              key={region.id}
              type="button"
              aria-label={`Edit text: ${region.text}`}
              className="absolute rounded-sm border border-transparent hover:border-[var(--brand)] hover:bg-[var(--brand)]/10"
              style={{ ...rectToCssStyle(vRect), cursor: regionsActive ? "text" : "inherit", pointerEvents: regionsActive ? "auto" : "none" }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => {
                if (activeTool !== "select") return;
                onRequestTextEdit({ kind: "native", pageId: page.id, text: region.text, pdfBox: region.pdfBox });
              }}
            />
          );
        })}

        {/* OCR line regions — a lower-priority fallback target for clicking whitespace
            within a line that no word button covers; word buttons render after these and
            sit on top, so a click on an actual word always hits the word, never the line. */}
        {ocrResult?.lines.map((line, i) => {
          const vRect = pdfRectToViewport(spec, line.pdfBox);
          const wordsInLine = ocrResult.words.filter((w) => Math.abs(w.pdfBox.y - line.pdfBox.y) < line.pdfBox.height * 0.5);
          const lineConfidence =
            wordsInLine.length > 0 ? wordsInLine.reduce((sum, w) => sum + w.confidence, 0) / wordsInLine.length : 75;
          return (
            <button
              key={`ocr-line-${i}`}
              type="button"
              aria-label={`Edit recognized line: ${line.text}`}
              title="Click a specific word above to edit just that word"
              className="absolute rounded-sm border border-transparent hover:border-[var(--brand)]/40"
              style={{ ...rectToCssStyle(vRect), cursor: regionsActive ? "text" : "inherit", pointerEvents: regionsActive ? "auto" : "none" }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => {
                if (activeTool !== "select") return;
                requestOcrEdit(line.text, line.pdfBox, lineConfidence);
              }}
            />
          );
        })}

        {/* OCR word regions — the primary editable target: clicking a word edits only that
            word's bounding box, never the whole line (see requestOcrEdit / regionColor.ts). */}
        {ocrResult?.words.map((word, i) => {
          const vRect = pdfRectToViewport(spec, word.pdfBox);
          return (
            <button
              key={`ocr-word-${i}`}
              type="button"
              aria-label={`Edit recognized word: ${word.text}`}
              className="absolute rounded-[2px] border border-transparent transition-colors hover:border-[var(--brand)] hover:bg-[var(--brand)]/15"
              style={{ ...rectToCssStyle(vRect), cursor: regionsActive ? "text" : "inherit", pointerEvents: regionsActive ? "auto" : "none" }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                if (activeTool !== "select") return;
                e.stopPropagation();
                // Same-line neighbors' own box-bottom, median'd, gives a steadier baseline
                // estimate than this one word's box alone (spec section 11) — falls back to
                // this word's own box inside requestOcrEdit when there are no neighbors.
                const sameLine = (ocrResult?.words ?? []).filter(
                  (w) => w !== word && Math.abs(w.pdfBox.y - word.pdfBox.y) < word.pdfBox.height * 0.4
                );
                const baselinePdfY =
                  sameLine.length > 0 ? median(sameLine.map((w) => w.pdfBox.y)) : undefined;
                // Up to four nearest words of the same kind (digits vs. capitals vs. ordinary
                // text) in the same run of text — reached by hopping word to word across ordinary
                // spaces, so a bold label or a separate field further along the line (a form's
                // "Name:" / "UNTIL") isn't evidence about this word's face.
                const kindOf = (t: string) => (/\d/.test(t) ? "digit" : t === t.toUpperCase() ? "caps" : "text");
                const maxGap = word.pdfBox.height * 1.2;
                // Words with and without descenders/ascenders have different box bottoms, so line
                // membership here is judged on the vertical centre, not the bottom edge.
                const centreY = (b: Rect) => b.y + b.height / 2;
                const lineMates = (ocrResult?.words ?? []).filter((w) => w !== word && Math.abs(centreY(w.pdfBox) - centreY(word.pdfBox)) < word.pdfBox.height * 0.5);
                const run = new Set<typeof word>();
                const walk = (dir: 1 | -1) => {
                  let edge = word.pdfBox;
                  const ordered = lineMates.filter((w) => (dir === 1 ? w.pdfBox.x > word.pdfBox.x : w.pdfBox.x < word.pdfBox.x)).sort((a, b) => dir * (a.pdfBox.x - b.pdfBox.x));
                  for (const w of ordered) {
                    const gap = dir === 1 ? w.pdfBox.x - (edge.x + edge.width) : edge.x - (w.pdfBox.x + w.pdfBox.width);
                    if (gap > maxGap) break;
                    run.add(w);
                    edge = w.pdfBox;
                  }
                };
                walk(1);
                walk(-1);
                // Digits and all-caps fields (a date, an amount, a heading) sit apart from their
                // siblings with big gaps, so for those any same-line word of the same kind and
                // similar height counts, however far away.
                if (kindOf(word.text) !== "text") {
                  for (const w of lineMates) if (Math.abs(w.pdfBox.height / word.pdfBox.height - 1) < 0.2) run.add(w);
                }
                const voterWords = [...run]
                  .filter((w) => kindOf(w.text) === kindOf(word.text) && w.text.replace(/\W/g, "").length >= 2)
                  .sort((a, b) => Math.abs(a.pdfBox.x - word.pdfBox.x) - Math.abs(b.pdfBox.x - word.pdfBox.x))
                  .slice(0, 4);
                requestOcrEdit(word.text, word.pdfBox, word.confidence, baselinePdfY, word.chars, voterWords);
              }}
            />
          );
        })}

        {showOcrOverlay &&
          ocrResult?.words.map((word, i) => {
            const vRect = pdfRectToViewport(spec, word.pdfBox);
            const tier = confidenceTier(word.confidence);
            const color = tier === "high" ? "border-[var(--accent-mint)]" : tier === "medium" ? "border-[var(--brand)]" : "border-red-500";
            return (
              <div
                key={`ocr-word-${i}`}
                className={`pointer-events-none absolute rounded-[2px] border ${color} opacity-60`}
                style={rectToCssStyle(vRect)}
              />
            );
          })}

        {activeMatch && (
          <div
            className="pointer-events-none absolute rounded-sm bg-yellow-300/50 ring-2 ring-yellow-500"
            style={pdfRectToCssStyle(spec, activeMatch.pdfBox)}
          />
        )}

        {objects.map((obj) => (
          <ObjectView
            key={obj.id}
            object={obj}
            spec={spec}
            selected={api.state.selectedObjectId === obj.id}
            interactive={activeTool === "select"}
            onPointerDownBody={(e) => startObjectMove(e, obj)}
            onPointerDownHandle={(e, handle) => startObjectResize(e, obj, handle)}
            onSelect={() => api.setSelectedObjectId(obj.id)}
            editing={api.state.editingObjectId === obj.id}
            selectAllOnEdit={api.state.editSelectAll}
            onStartEdit={() => api.setEditingObjectId(obj.id)}
            onStopEdit={() => api.setEditingObjectId(null)}
            onTextChange={(text) => api.updateObject(obj.id, { text }, { coalesceKey: `text:${obj.id}` })}
            onAutoHeight={(heightPx) => {
              const h = heightPx / spec.scale;
              // Grow/shrink downward from the top edge (PDF y is up, so the bottom edge moves).
              api.previewObject(obj.id, { height: h, y: obj.y + obj.height - h });
            }}
          />
        ))}

        {/* Live preview while dragging out a shape/annotation/whiteout: the very same object that
            will be created on release, drawn in the same place, so what you see is what you get. */}
        {liveDrawRect && activeTool !== "crop" && livePreviewObject && (
          <ObjectView
            object={livePreviewObject}
            spec={spec}
            selected={false}
            interactive={false}
            onPointerDownBody={() => {}}
            onPointerDownHandle={() => {}}
            onSelect={() => {}}
          />
        )}

        {/* Live freehand stroke: extends under the pointer as it moves (same round-cap stroke the
            finished drawing uses). */}
        {dragState?.mode === "freehand" && (dragState.points?.length ?? 0) > 0 && (
          <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={dims.width} height={dims.height} aria-hidden="true" data-testid="live-stroke">
            <polyline
              points={(dragState.points ?? []).map((p) => {
                const v = pdfToViewportPoint(spec, p);
                return `${v.x},${v.y}`;
              }).join(" ")}
              fill="none"
              stroke={rgbToCss(toolOptions.color)}
              strokeWidth={Math.max(1, toolOptions.strokeWidth * spec.scale)}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}

        {cropRectForDisplay && (
          <CropOverlay
            spec={spec}
            pageDims={dims}
            rect={cropRectForDisplay}
            onHandleDown={cropDraftForPage && !liveDrawRect ? startCropResize : undefined}
          />
        )}
      </div>
    </div>
  );
}

/** Dims everything outside the proposed/applied crop rect using four bands around it,
 * plus a dashed outline — avoids clip-path/mask compatibility quirks for a rectangle. */
function CropOverlay({
  spec,
  pageDims,
  rect,
  onHandleDown,
}: {
  spec: ReturnType<typeof viewportSpecForPage>;
  pageDims: { width: number; height: number };
  rect: Rect;
  /** When given, corner handles are shown and start a resize of the crop area. */
  onHandleDown?: (e: React.PointerEvent, handle: string) => void;
}) {
  const v = pdfRectToViewport(spec, rect);
  const bandStyle = "pointer-events-none absolute bg-black/50";
  return (
    <>
      <div className={bandStyle} style={{ left: 0, top: 0, width: pageDims.width, height: v.y }} />
      <div className={bandStyle} style={{ left: 0, top: v.y + v.height, width: pageDims.width, height: Math.max(0, pageDims.height - v.y - v.height) }} />
      <div className={bandStyle} style={{ left: 0, top: v.y, width: v.x, height: v.height }} />
      <div className={bandStyle} style={{ left: v.x + v.width, top: v.y, width: Math.max(0, pageDims.width - v.x - v.width), height: v.height }} />
      <div className="pointer-events-none absolute border-2 border-dashed border-white" style={{ left: v.x, top: v.y, width: v.width, height: v.height }} />
      {onHandleDown &&
        (["nw", "ne", "sw", "se"] as const).map((h) => (
          <div
            key={h}
            data-crop-handle={h}
            onPointerDown={(e) => onHandleDown(e, h)}
            className="absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--brand)] bg-white shadow"
            style={{
              left: h.includes("w") ? v.x : v.x + v.width,
              top: h.startsWith("n") ? v.y : v.y + v.height,
              cursor: h === "nw" || h === "se" ? "nwse-resize" : "nesw-resize",
              touchAction: "none",
            }}
          />
        ))}
    </>
  );
}

/** The object a drag with the given tool produces — used both for the live preview while
 * dragging and for the object created on release, so the two can never disagree. drag gives
 * the actual press and current points (PDF space), which a line/arrow needs to keep its
 * direction (the normalized rect alone can't say which way it was drawn). */
function buildDrawnObject(
  tool: ToolId,
  rect: Rect,
  options: ToolOptions,
  pageId: string,
  id: string,
  drag?: { start: { x: number; y: number }; end: { x: number; y: number } }
): EditorObject | null {
  if (tool === "whiteout") return { id, type: "whiteout", pageId, ...rect };
  if (tool === "highlight" || tool === "underline" || tool === "strikethrough") {
    return { id, type: "annotation", pageId, ...rect, kind: tool, color: options.color };
  }
  if (tool.startsWith("shape-")) {
    const shape = tool.replace("shape-", "") as "rectangle" | "ellipse" | "line" | "arrow";
    return {
      id,
      type: "shape",
      pageId,
      ...rect,
      shape,
      strokeColor: options.color,
      strokeWidth: options.strokeWidth,
      fillColor: options.fillShape ? options.color : undefined,
      startCorner: (shape === "line" || shape === "arrow") && drag ? startCornerForDrag(drag.start, drag.end) : undefined,
    };
  }
  return null;
}
