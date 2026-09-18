"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { loadPdfJsDocument, renderPageToCanvas } from "@/lib/processors/pdfjs-utils";
import {
  pdfRectToViewport,
  viewportToPdfPoint,
  viewportDimensions,
  type Rect,
} from "@/lib/editor/coordinates";
import { viewportSpecForPage, effectiveRotation, type EditorDocument, type EditorObject, type EditorPage, type RgbColor } from "@/lib/editor/types";
import type { NativeTextRegion } from "@/lib/editor/nativeText";
import type { OcrPageResult } from "@/lib/processors/ocr";
import { confidenceTier } from "@/lib/processors/ocr";
import { estimateRegionColors, computeEditPadding, type PixelSource } from "@/lib/editor/regionColor";
import { composeOcrPatch, type ComposeOcrPatchResult } from "@/lib/editor/scanPatch";
import type { EditorWorkspaceApi, ToolId, SearchMatch } from "./useEditorWorkspace";
import type { ToolOptions } from "./toolOptions";
import { rgbToCss } from "./toolOptions";
import { ObjectView } from "./ObjectView";

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
  ocrColors?: OcrColorEstimate;
  /** Renders a real, export-identical raster preview of what typing `newText` would look
   * like (scanned-text pipeline only — see scanPatch.ts) — synchronous, cheap enough to call
   * on every keystroke for a single word. Null/undefined when the page canvas isn't
   * available (e.g. still rendering) or the edit is a native-text replacement. */
  composePreview?: (newText: string) => ComposeOcrPatchResult | null;
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
  const overlayRef = useRef<HTMLDivElement>(null);
  const file = doc.sourceFiles[page.sourceFileId];
  const spec = useMemo(() => viewportSpecForPage(page, zoom), [page, zoom]);
  const dims = useMemo(() => viewportDimensions(spec), [spec]);

  const [dragState, setDragState] = useState<{
    mode: "draw-rect" | "move" | "resize" | "freehand";
    objectId?: string;
    handle?: string;
    startPdf: { x: number; y: number };
    currentPdf?: { x: number; y: number };
    originRect?: Rect;
    points?: { x: number; y: number }[];
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
      const canvas = await renderPageToCanvas(pdfDoc, page.sourcePageIndex + 1, spec.scale, effectiveRotation(page));
      if (cancelled) return;
      const host = canvasHostRef.current;
      if (!host) return;
      host.innerHTML = "";
      host.appendChild(canvas);
      baseCanvasRef.current = canvas;
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
    const x0 = Math.max(0, Math.floor(areaPx.x));
    const y0 = Math.max(0, Math.floor(areaPx.y));
    const x1 = Math.min(canvas.width, Math.ceil(areaPx.x + areaPx.width));
    const y1 = Math.min(canvas.height, Math.ceil(areaPx.y + areaPx.height));
    const w = Math.max(1, x1 - x0);
    const h = Math.max(1, y1 - y0);
    let imgData: ImageData | null = null;
    try {
      imgData = ctx.getImageData(x0, y0, w, h);
    } catch {
      return null; // e.g. a tainted canvas — fall back to defaults rather than throwing
    }
    return {
      width: canvas.width,
      height: canvas.height,
      getPixel(x, y) {
        const lx = Math.max(0, Math.min(w - 1, Math.round(x) - x0));
        const ly = Math.max(0, Math.min(h - 1, Math.round(y) - y0));
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
      const sampleYs = [wordRectPx.y, wordRectPx.y + wordRectPx.height / 2, wordRectPx.y + wordRectPx.height];
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
   * section 11) used in place of this word's own box bottom. */
  function requestOcrEdit(text: string, pdfBox: Rect, confidence: number, baselinePdfY?: number) {
    const paddingPt = computeEditPadding(pdfBox.height, confidence);
    const wordRectPx = pdfRectToViewport(spec, pdfBox);
    const paddingPx = paddingPt * spec.scale;
    // Sample wide enough to the right to check for verified expansion room too (up to one
    // more word-width), not just the tight padding ring used for background/text color.
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

    const paddedPdfBox: Rect = {
      x: pdfBox.x - paddingPt,
      y: pdfBox.y - paddingPt,
      width: pdfBox.width + paddingPt * 2 + safeExpansionPt,
      height: pdfBox.height + paddingPt * 2,
    };
    const patchRectPx = pdfRectToViewport(spec, paddedPdfBox);
    const baselinePx = baselinePdfY !== undefined ? pdfRectToViewport(spec, { x: 0, y: baselinePdfY, width: 0, height: 0 }).y : wordRectPx.y + wordRectPx.height;

    // Always offer the raster-patch pipeline when the canvas is readable — even when the
    // older variance-based `estimate.complex` flag is set. That flag was calibrated for the
    // old "can a single flat color safely fill the whole box" question; the raster pipeline
    // clones real local texture instead of a flat fill and runs its own, more precise
    // line-overlap safety check (see scanPatch.ts's `unsafe`), so it can succeed in plenty of
    // cases the old flag would have blocked outright (e.g. a word merely *near* a ruling
    // line, not actually overlapping it).
    const composePreview =
      source
        ? (newText: string) =>
            composeOcrPatch({
              source,
              wordRectPx,
              patchRectPx,
              baselinePx,
              originalText: text,
              newText,
              backgroundColor: estimate.backgroundColor,
              textColor: estimate.textColor,
              pixelScale: PATCH_PIXEL_SCALE,
              styleCacheKey: page.id,
            })
        : undefined;

    onRequestTextEdit({
      kind: "ocr",
      pageId: page.id,
      text,
      confidence,
      pdfBox: paddedPdfBox,
      ocrColors: { ...estimate, paddingPt },
      composePreview,
    });
  }

  function handleOverlayPointerDown(e: React.PointerEvent) {
    if (e.target !== overlayRef.current && (e.target as HTMLElement).dataset.surfaceBackground !== "true") return;
    const pdfPoint = pointFromEvent(e);

    if (pendingPlacement) {
      const width = Math.min(200, pendingPlacement.naturalWidth * 0.5 || 150);
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
      });
      return;
    }

    if (activeTool === "draw") {
      setDragState({ mode: "freehand", startPdf: pdfPoint, points: [pdfPoint] });
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
      setDragState({ mode: "draw-rect", startPdf: pdfPoint });
      return;
    }

    // select tool clicking empty space: deselect
    api.setSelectedObjectId(null);
  }

  function handleOverlayPointerMove(e: React.PointerEvent) {
    if (!dragState) return;
    const pdfPoint = pointFromEvent(e);

    if (dragState.mode === "freehand") {
      setDragState({ ...dragState, points: [...(dragState.points ?? []), pdfPoint] });
      return;
    }

    if (dragState.mode === "draw-rect") {
      setDragState({ ...dragState, currentPdf: pdfPoint });
      return;
    }

    if (dragState.mode === "move" && dragState.objectId && dragState.originRect) {
      const dx = pdfPoint.x - dragState.startPdf.x;
      const dy = pdfPoint.y - dragState.startPdf.y;
      api.previewObject(dragState.objectId, { x: dragState.originRect.x + dx, y: dragState.originRect.y + dy });
      return;
    }

    if (dragState.mode === "resize" && dragState.objectId && dragState.originRect && dragState.handle) {
      const rect = resizeRect(dragState.originRect, dragState.handle, pdfPoint.x - dragState.startPdf.x, pdfPoint.y - dragState.startPdf.y);
      api.previewObject(dragState.objectId, rect);
      return;
    }
  }

  function handleOverlayPointerUp(e: React.PointerEvent) {
    if (!dragState) return;
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
        });
      }
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
          api.setCropDraft({ pageId: page.id, rect: { x: x0, y: y0, width, height } });
        }
        setDragState(null);
        return;
      }

      let created = false;
      if (width > MIN_OBJECT_SIZE && height > MIN_OBJECT_SIZE) {
        created = createDrawnObject(activeTool, { x: x0, y: y0, width, height }, toolOptions, page.id, api);
      }
      setDragState(null);
      if (!created && activeTool !== "select") api.setActiveTool("select");
      return;
    }

    if (dragState.mode === "move" || dragState.mode === "resize") {
      api.commitPreview();
      setDragState(null);
    }
  }

  function startObjectMove(e: React.PointerEvent, obj: EditorObject) {
    if (activeTool !== "select") return;
    e.stopPropagation();
    api.setSelectedObjectId(obj.id);
    const pdfPoint = pointFromEvent(e);
    setDragState({ mode: "move", objectId: obj.id, startPdf: pdfPoint, originRect: { x: obj.x, y: obj.y, width: obj.width, height: obj.height } });
  }

  function startObjectResize(e: React.PointerEvent, obj: EditorObject, handle: string) {
    e.stopPropagation();
    const pdfPoint = pointFromEvent(e);
    setDragState({ mode: "resize", objectId: obj.id, handle, startPdf: pdfPoint, originRect: { x: obj.x, y: obj.y, width: obj.width, height: obj.height } });
  }

  // Live preview rect for draw-rect drags (whiteout/shape/annotation/crop), computed each render.
  const liveDrawRect: Rect | null =
    dragState?.mode === "draw-rect" && dragState.currentPdf
      ? (() => {
          const cur = dragState.currentPdf!;
          const x0 = Math.min(dragState.startPdf.x, cur.x);
          const y0 = Math.min(dragState.startPdf.y, cur.y);
          return { x: x0, y: y0, width: Math.abs(cur.x - dragState.startPdf.x), height: Math.abs(cur.y - dragState.startPdf.y) };
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

  return (
    <div
      className="relative inline-block select-none"
      style={{ width: dims.width, height: dims.height }}
      data-testid="page-surface"
      data-page-id={page.id}
    >
      <div ref={canvasHostRef} className="pointer-events-none absolute inset-0" aria-hidden="true" />
      <div
        ref={overlayRef}
        data-surface-background="true"
        className="absolute inset-0"
        style={{ cursor: activeTool === "select" ? "default" : "crosshair" }}
        onPointerDown={handleOverlayPointerDown}
        onPointerMove={handleOverlayPointerMove}
        onPointerUp={handleOverlayPointerUp}
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
              style={{ left: vRect.x, top: vRect.y, width: vRect.width, height: vRect.height, cursor: activeTool === "select" ? "text" : "inherit" }}
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
              style={{ left: vRect.x, top: vRect.y, width: vRect.width, height: vRect.height, cursor: activeTool === "select" ? "text" : "inherit" }}
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
              style={{ left: vRect.x, top: vRect.y, width: vRect.width, height: vRect.height, cursor: activeTool === "select" ? "text" : "inherit" }}
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
                requestOcrEdit(word.text, word.pdfBox, word.confidence, baselinePdfY);
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
                style={{ left: vRect.x, top: vRect.y, width: vRect.width, height: vRect.height }}
              />
            );
          })}

        {activeMatch && (
          <div
            className="pointer-events-none absolute rounded-sm bg-yellow-300/50 ring-2 ring-yellow-500"
            style={pdfRectToViewport(spec, activeMatch.pdfBox)}
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
          />
        ))}

        {liveDrawRect && activeTool !== "crop" && (
          <div
            className="pointer-events-none absolute border-2 border-dashed"
            style={{
              ...pdfRectToViewport(spec, liveDrawRect),
              borderColor: rgbToCss(toolOptions.color),
              backgroundColor: activeTool === "whiteout" ? "white" : "transparent",
            }}
          />
        )}

        {cropRectForDisplay && <CropOverlay spec={spec} pageDims={dims} rect={cropRectForDisplay} />}
      </div>
    </div>
  );
}

/** Dims everything outside the proposed/applied crop rect using four bands around it,
 * plus a dashed outline — avoids clip-path/mask compatibility quirks for a rectangle. */
function CropOverlay({ spec, pageDims, rect }: { spec: ReturnType<typeof viewportSpecForPage>; pageDims: { width: number; height: number }; rect: Rect }) {
  const v = pdfRectToViewport(spec, rect);
  const bandStyle = "pointer-events-none absolute bg-black/50";
  return (
    <>
      <div className={bandStyle} style={{ left: 0, top: 0, width: pageDims.width, height: v.y }} />
      <div className={bandStyle} style={{ left: 0, top: v.y + v.height, width: pageDims.width, height: Math.max(0, pageDims.height - v.y - v.height) }} />
      <div className={bandStyle} style={{ left: 0, top: v.y, width: v.x, height: v.height }} />
      <div className={bandStyle} style={{ left: v.x + v.width, top: v.y, width: Math.max(0, pageDims.width - v.x - v.width), height: v.height }} />
      <div className="pointer-events-none absolute border-2 border-dashed border-white" style={{ left: v.x, top: v.y, width: v.width, height: v.height }} />
    </>
  );
}

function resizeRect(origin: Rect, handle: string, dxView: number, dyView: number): Rect {
  // dx/dy are already in PDF space deltas (caller passes pdf-space deltas).
  let { x, y, width, height } = origin;
  if (handle.includes("w")) {
    x = origin.x + dxView;
    width = origin.width - dxView;
  }
  if (handle.includes("e")) {
    width = origin.width + dxView;
  }
  if (handle.includes("s")) {
    y = origin.y + dyView;
    height = origin.height - dyView;
  }
  if (handle.includes("n")) {
    height = origin.height + dyView;
  }
  if (width < MIN_OBJECT_SIZE) width = MIN_OBJECT_SIZE;
  if (height < MIN_OBJECT_SIZE) height = MIN_OBJECT_SIZE;
  return { x, y, width, height };
}

function createDrawnObject(tool: ToolId, rect: Rect, options: ToolOptions, pageId: string, api: EditorWorkspaceApi): boolean {
  const id = api.newObjectId();
  if (tool === "whiteout") {
    api.addObjectAndSelect({ id, type: "whiteout", pageId, ...rect });
    return true;
  }
  if (tool === "highlight" || tool === "underline" || tool === "strikethrough") {
    api.addObjectAndSelect({ id, type: "annotation", pageId, ...rect, kind: tool, color: tool === "highlight" ? options.color : options.color });
    return true;
  }
  if (tool.startsWith("shape-")) {
    const shape = tool.replace("shape-", "") as "rectangle" | "ellipse" | "line" | "arrow";
    api.addObjectAndSelect({
      id,
      type: "shape",
      pageId,
      ...rect,
      shape,
      strokeColor: options.color,
      strokeWidth: options.strokeWidth,
      fillColor: options.fillShape ? options.color : undefined,
    });
    return true;
  }
  return false;
}
