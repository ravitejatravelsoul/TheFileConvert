"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { loadPdfJsDocument, renderPageToCanvas } from "@/lib/processors/pdfjs-utils";
import {
  pdfRectToViewport,
  viewportToPdfPoint,
  viewportDimensions,
  type Rect,
} from "@/lib/editor/coordinates";
import { viewportSpecForPage, effectiveRotation, type EditorDocument, type EditorObject, type EditorPage } from "@/lib/editor/types";
import type { NativeTextRegion } from "@/lib/editor/nativeText";
import type { OcrPageResult } from "@/lib/processors/ocr";
import { confidenceTier } from "@/lib/processors/ocr";
import type { EditorWorkspaceApi, ToolId, SearchMatch } from "./useEditorWorkspace";
import type { ToolOptions } from "./toolOptions";
import { rgbToCss } from "./toolOptions";
import { ObjectView } from "./ObjectView";

export interface EditableRegionRequest {
  kind: "native" | "ocr";
  pageId: string;
  text: string;
  confidence?: number;
  pdfBox: Rect;
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
      activeTool === "strikethrough"
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

  // Live preview rect for draw-rect drags (whiteout/shape/annotation), computed each render.
  const liveDrawRect: Rect | null =
    dragState?.mode === "draw-rect" && dragState.currentPdf
      ? (() => {
          const cur = dragState.currentPdf!;
          const x0 = Math.min(dragState.startPdf.x, cur.x);
          const y0 = Math.min(dragState.startPdf.y, cur.y);
          return { x: x0, y: y0, width: Math.abs(cur.x - dragState.startPdf.x), height: Math.abs(cur.y - dragState.startPdf.y) };
        })()
      : null;

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

        {/* OCR line regions (click target) + word confidence overlay */}
        {ocrResult?.lines.map((line, i) => {
          const vRect = pdfRectToViewport(spec, line.pdfBox);
          return (
            <button
              key={`ocr-line-${i}`}
              type="button"
              aria-label={`Edit recognized text: ${line.text}`}
              className="absolute rounded-sm border border-transparent hover:border-[var(--brand)] hover:bg-[var(--brand)]/10"
              style={{ left: vRect.x, top: vRect.y, width: vRect.width, height: vRect.height, cursor: activeTool === "select" ? "text" : "inherit" }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => {
                if (activeTool !== "select") return;
                onRequestTextEdit({ kind: "ocr", pageId: page.id, text: line.text, pdfBox: line.pdfBox });
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

        {liveDrawRect && (
          <div
            className="pointer-events-none absolute border-2 border-dashed"
            style={{
              ...pdfRectToViewport(spec, liveDrawRect),
              borderColor: rgbToCss(toolOptions.color),
              backgroundColor: activeTool === "whiteout" ? "white" : "transparent",
            }}
          />
        )}
      </div>
    </div>
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
