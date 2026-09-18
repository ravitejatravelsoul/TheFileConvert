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

export function TextEditModal({ request, api, onClose }: TextEditModalProps) {
  const [value, setValue] = useState(request.text);
  const isOcr = request.kind === "ocr";
  const [manualOverlay, setManualOverlay] = useState(false);

  const box = request.pdfBox;
  const backgroundColor = request.ocrColors?.backgroundColor ?? COLOR_WHITE;
  const textColor = request.ocrColors?.textColor ?? COLOR_BLACK;

  // Real, export-identical raster preview (scanned-text pipeline only — see scanPatch.ts):
  // recomposed synchronously on every keystroke so what's shown here is what Apply will
  // actually produce, not an HTML-font approximation (spec section 13). `preview.pdfBox` is
  // the *tight* patch region actually used — scoped to just the changed characters when OCR
  // character geometry allows it, not necessarily the whole word (see PageSurface.tsx).
  const preview = useMemo(() => request.composePreview?.(value) ?? null, [request, value]);
  const patch = preview?.patch ?? null;
  const overlayForced = Boolean(patch?.unsafe);

  function save() {
    if (value === request.text) {
      onClose();
      return;
    }
    if (request.kind === "native") {
      const estimatedFontSize = Math.max(6, box.height * 0.8);
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
        fontSize: estimatedFontSize,
        color: COLOR_BLACK,
      });
      onClose();
      return;
    }

    // Scanned-text path. If the region is unsafe to auto-erase (overlaps a table/border
    // line), Save stays disabled until the user explicitly opts into a manual overlay (see
    // canSave below) — never silently fall back to a risky automatic erase.
    const usePatch = preview && patch && !patch.unsafe && !manualOverlay;
    // The tight changed-substring rect when the patch path is used; the whole word's own
    // padded box for the unsafe/manual-overlay/legacy fallback (which doesn't erase, so the
    // wider box doesn't risk anything — see PageSurface.tsx).
    const objectRect = usePatch ? preview!.pdfBox : box;

    api.addObject({
      id: api.newObjectId(),
      type: "ocr-text-replacement",
      pageId: request.pageId,
      x: objectRect.x,
      y: objectRect.y,
      width: objectRect.width,
      height: objectRect.height,
      originalText: request.text,
      newText: value,
      confidence: request.confidence ?? 0,
      backgroundColor,
      textColor,
      backgroundComplex: overlayForced,
      overlayOnly: manualOverlay,
      patchDataUrl: usePatch ? patch!.dataUrl : undefined,
      fontCandidateId: usePatch ? patch!.fontCandidateId : undefined,
      // The *whole word's* own box, so the invisible searchable-text run below isn't
      // squeezed into a box sized for just the changed characters when they differ.
      searchAnchor: usePatch ? box : undefined,
    });
    onClose();
  }

  const canSave = !overlayForced || manualOverlay;

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
              if (e.key === "Enter" && canSave) save();
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
                  Edited {patch && !manualOverlay && !overlayForced ? "(actual scan style)" : ""}
                </p>
                <div className="flex h-11 items-center justify-center overflow-hidden px-2" style={{ backgroundColor: manualOverlay || overlayForced ? "transparent" : rgbToCss(backgroundColor) }}>
                  {patch && !manualOverlay && !overlayForced ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={patch.dataUrl} alt="" className="max-h-full max-w-full object-contain" />
                  ) : (
                    <span className="truncate text-sm" style={{ color: rgbToCss(textColor) }}>
                      {value || " "}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <p className="mt-1 text-[10px] text-[var(--foreground-muted)]">
              {patch
                ? `Rendered locally from the scan around this word — same image the export will use (matched style: ${patch.fontCandidateId.replace(/-/g, " ")}).`
                : "Colors matched from the scan around this word."}
            </p>
          </div>
        )}

        {isOcr && overlayForced && (
          <div className="mt-3 rounded-[var(--radius-sm)] bg-[var(--brand-soft)] p-2.5 text-xs text-[var(--brand-strong)]">
            <p className="font-medium">This can&rsquo;t be replaced automatically</p>
            <p className="mt-1">
              {patch?.unsafeReason ??
                "This text overlaps complex artwork or a table/border line. Automatically erasing it risks damaging that line, so nothing has been erased."}
            </p>
            <label className="mt-2 flex items-center gap-2">
              <input
                type="checkbox"
                checked={manualOverlay}
                onChange={(e) => setManualOverlay(e.target.checked)}
                className="accent-[var(--brand)]"
              />
              Place corrected text as an overlay on top (manual, doesn&rsquo;t erase the original)
            </label>
            {!manualOverlay && <p className="mt-1 text-[10px]">Check this box to continue, or Cancel to leave this word as-is.</p>}
          </div>
        )}

        {isOcr && patch?.overflow && (
          <p className="mt-2 rounded-[var(--radius-sm)] bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
            The replacement is wider than the available original space. It has been shrunk as much as can stay legible and
            may still extend slightly beyond the original word rather than cover neighboring text.
          </p>
        )}

        {isOcr && !overlayForced && (
          <label className="mt-2 flex items-center gap-2 text-xs text-[var(--foreground-muted)]">
            <input type="checkbox" checked={manualOverlay} onChange={(e) => setManualOverlay(e.target.checked)} className="accent-[var(--brand)]" />
            Place as overlay instead of covering the original background
          </label>
        )}

        <p className="mt-2 text-xs text-[var(--foreground-muted)]">
          {isOcr
            ? "Scanned PDFs are images. TheFileConvert reconstructs the local background texture and renders the correction in a locally matched font style — for unusual fonts or unclear backgrounds, review the preview above before exporting."
            : "Best for short text corrections. Complex formatting, embedded fonts, and paragraph reflow may not be preserved exactly."}
        </p>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!canSave}>
            Save correction
          </Button>
        </div>
      </div>
    </div>
  );
}
