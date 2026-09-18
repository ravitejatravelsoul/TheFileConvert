"use client";

import { useMemo, useState } from "react";
import type { EditableRegionRequest } from "./PageSurface";
import type { EditorWorkspaceApi } from "./useEditorWorkspace";
import { Button } from "@/components/ui/Button";
import { COLOR_BLACK, COLOR_WHITE } from "@/lib/editor/types";
import { rgbToCss } from "./toolOptions";

interface TextEditModalProps {
  request: EditableRegionRequest;
  api: EditorWorkspaceApi;
  onClose: () => void;
}

/** Rough client-side width estimate for the "this may not fit" warning — doesn't need to
 * match pdf-lib's real font metrics exactly, just needs to catch a replacement that's
 * obviously much wider than the original, matching the shrink-then-tolerate-overflow
 * behavior export.ts actually applies. */
function estimateTextWidthPx(text: string, sizePx: number): number {
  if (typeof document === "undefined") return text.length * sizePx * 0.55;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return text.length * sizePx * 0.55;
  ctx.font = `${sizePx}px Helvetica, Arial, sans-serif`;
  return ctx.measureText(text).width;
}

export function TextEditModal({ request, api, onClose }: TextEditModalProps) {
  const [value, setValue] = useState(request.text);
  const isOcr = request.kind === "ocr";
  const [overlayOnly, setOverlayOnly] = useState(Boolean(request.ocrColors?.complex));

  const box = request.pdfBox;
  const estimatedFontSize = Math.max(6, box.height * 0.8);
  const backgroundColor = request.ocrColors?.backgroundColor ?? COLOR_WHITE;
  const textColor = request.ocrColors?.textColor ?? COLOR_BLACK;

  const widthWarning = useMemo(() => {
    if (!isOcr || box.width <= 0) return false;
    // Preview box is rendered at a fixed height in the modal (see below); scale the font
    // size estimate the same way so the width check is proportionate.
    const previewScale = 28 / estimatedFontSize;
    const naturalWidthPx = estimateTextWidthPx(value || " ", estimatedFontSize * previewScale);
    const availableWidthPx = box.width * previewScale;
    return naturalWidthPx > availableWidthPx * 1.15;
  }, [isOcr, value, box.width, estimatedFontSize]);

  function save() {
    if (value === request.text) {
      onClose();
      return;
    }
    if (request.kind === "native") {
      api.addObject({
        id: api.newObjectId(),
        type: "native-text-replacement",
        pageId: request.pageId,
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        originalText: request.text,
        newText: value,
        fontSize: Math.max(6, box.height * 0.8),
        color: COLOR_BLACK,
      });
    } else {
      api.addObject({
        id: api.newObjectId(),
        type: "ocr-text-replacement",
        pageId: request.pageId,
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        originalText: request.text,
        newText: value,
        confidence: request.confidence ?? 0,
        backgroundColor,
        textColor,
        backgroundComplex: request.ocrColors?.complex ?? false,
        overlayOnly,
      });
    }
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-[var(--radius-lg)] bg-[var(--surface)] p-5 shadow-[var(--shadow-lifted)]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="text-edit-heading"
      >
        <h2 id="text-edit-heading" className="text-base font-semibold text-[var(--foreground)]">
          Edit text
        </h2>
        <p className="mt-2 text-xs text-[var(--foreground-muted)]">
          Detected: <span className="italic">&ldquo;{request.text}&rdquo;</span>
          {isOcr && request.confidence !== undefined && ` (${Math.round(request.confidence)}% confidence)`}
        </p>

        <label className="mt-3 block">
          <span className="mb-1 block text-xs font-medium text-[var(--foreground)]">Replacement</span>
          <input
            autoFocus
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") onClose();
            }}
            className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] px-3 py-2 text-sm outline-none focus:border-[var(--brand)]"
          />
        </label>

        {isOcr && (
          <div className="mt-3">
            <span className="mb-1 block text-xs font-medium text-[var(--foreground)]">Preview</span>
            <div className="flex gap-2">
              <div className="flex-1 overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border)]">
                <p className="border-b border-[var(--border)] bg-[var(--surface-muted)] px-2 py-0.5 text-[10px] text-[var(--foreground-muted)]">
                  Original
                </p>
                <div className="flex h-11 items-center justify-center px-2" style={{ backgroundColor: rgbToCss(backgroundColor) }}>
                  <span className="truncate text-sm" style={{ color: rgbToCss(textColor) }}>
                    {request.text || " "}
                  </span>
                </div>
              </div>
              <div className="flex-1 overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border)]">
                <p className="border-b border-[var(--border)] bg-[var(--surface-muted)] px-2 py-0.5 text-[10px] text-[var(--foreground-muted)]">
                  Edited
                </p>
                <div
                  className="flex h-11 items-center justify-center px-2"
                  style={{ backgroundColor: overlayOnly ? "transparent" : rgbToCss(backgroundColor) }}
                >
                  <span className="truncate text-sm" style={{ color: rgbToCss(textColor) }}>
                    {value || " "}
                  </span>
                </div>
              </div>
            </div>
            <p className="mt-1 text-[10px] text-[var(--foreground-muted)]">
              Colors matched from the scan around this word — the exported PDF uses this same patch, not a plain white box.
            </p>
          </div>
        )}

        {isOcr && request.ocrColors?.complex && (
          <div className="mt-3 rounded-[var(--radius-sm)] bg-[var(--brand-soft)] p-2.5 text-xs text-[var(--brand-strong)]">
            <p className="font-medium">Complex background detected</p>
            <p className="mt-1">
              This area contains graphics or a complex background. Automatic replacement could change its appearance, so the
              correction will be placed as an overlay on top of the original scan instead of covering it.
            </p>
            <label className="mt-2 flex items-center gap-2">
              <input
                type="checkbox"
                checked={overlayOnly}
                onChange={(e) => setOverlayOnly(e.target.checked)}
                className="accent-[var(--brand)]"
              />
              Place corrected text as overlay (recommended)
            </label>
          </div>
        )}

        {widthWarning && (
          <p className="mt-2 rounded-[var(--radius-sm)] bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
            The replacement text is wider than the original space. It will shrink to fit where possible, and may extend
            slightly beyond the original word rather than cover neighboring text.
          </p>
        )}

        {isOcr && !request.ocrColors?.complex && (
          <label className="mt-2 flex items-center gap-2 text-xs text-[var(--foreground-muted)]">
            <input type="checkbox" checked={overlayOnly} onChange={(e) => setOverlayOnly(e.target.checked)} className="accent-[var(--brand)]" />
            Place as overlay instead of covering the original background
          </label>
        )}

        <p className="mt-2 text-xs text-[var(--foreground-muted)]">
          {isOcr
            ? "Scanned PDFs are images. TheFileConvert matches the detected text style and preserves the surrounding scan as closely as possible — for complex backgrounds or unusual fonts, review the preview above before exporting."
            : "Best for short text corrections. Complex formatting, embedded fonts, and paragraph reflow may not be preserved exactly."}
        </p>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save}>Save correction</Button>
        </div>
      </div>
    </div>
  );
}
