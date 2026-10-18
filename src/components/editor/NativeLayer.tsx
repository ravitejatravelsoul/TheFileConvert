"use client";

import { useState } from "react";
import { resizeViewportRect, rectToCssStyle, type Rect, type ResizeHandle } from "@/lib/editor/coordinates";
import type { ImageInfo, PageAnalysis } from "@/lib/editor/native";
import type { PageTransform } from "@/lib/editor/pageTransform";
import type { EditorWorkspaceApi } from "./useEditorWorkspace";

interface Props {
  api: EditorWorkspaceApi;
  pageId: string;
  transform: PageTransform;
  analysis: PageAnalysis | null;
  /** The Select or Edit-text tool is armed: the page's own text and pictures take pointer input. */
  interactive: boolean;
  /** Edit text tool: one click puts a caret in the text. */
  editTextTool: boolean;
  /** The block that is currently a live text box (its target is hidden). */
  editingBlockId: string | null;
  /** The element the page is drawn in, to read pointer positions against. */
  hostRef: React.RefObject<HTMLDivElement | null>;
  onBeginEdit: (blockId: string, at?: { x: number; y: number }) => void;
}

const CLICK_SLOP = 4;
const MIN_SIDE_PT = 8;

type Drag =
  | { kind: "move"; id: string; start: { x: number; y: number }; origin: Rect; box: Rect; moved: boolean }
  | { kind: "resize"; id: string; handle: ResizeHandle; start: { x: number; y: number }; origin: Rect; box: Rect; moved: boolean }
  | { kind: "rotate"; id: string; center: { x: number; y: number }; origin: Rect; degrees: number; moved: boolean };

/**
 * Hit targets over the page's own content: blocks of text (click selects, double-click or the Edit text tool puts a caret in
 * them) and pictures (click selects; drag moves; corners resize keeping the proportions, Shift frees them; the round handle
 * rotates). Positions come from the page's analysis through the one PageTransform.
 */
export function NativeLayer({ api, pageId, transform: t, analysis, interactive, editTextTool, editingBlockId, hostRef, onBeginEdit }: Props) {
  const selected = api.state.selectedNative;
  const [hover, setHover] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [busy, setBusy] = useState(false);

  if (!analysis) return null;

  const pdfPoint = (e: React.PointerEvent) => {
    const host = hostRef.current!.getBoundingClientRect();
    return t.clientToPdf(e.clientX, e.clientY, host);
  };

  async function finish(d: Drag) {
    if (!d.moved) return;
    setBusy(true);
    const res = d.kind === "rotate" ? await api.transformImage(pageId, d.id, d.origin, d.degrees) : await api.transformImage(pageId, d.id, d.box, 0);
    setBusy(false);
    if (!res.ok) api.showMessage(res.reason);
  }

  function startImageDrag(e: React.PointerEvent, im: ImageInfo, kind: "move" | "resize" | "rotate", handle?: ResizeHandle) {
    if (!interactive || busy) return;
    e.stopPropagation();
    e.preventDefault();
    api.selectNative({ kind: "image", pageId, imageId: im.id });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const start = pdfPoint(e);
    const origin = im.bbox;
    if (kind === "move") setDrag({ kind, id: im.id, start, origin, box: origin, moved: false });
    else if (kind === "resize") setDrag({ kind, id: im.id, handle: handle!, start, origin, box: origin, moved: false });
    else setDrag({ kind, id: im.id, center: { x: origin.x + origin.width / 2, y: origin.y + origin.height / 2 }, origin, degrees: 0, moved: false });
  }

  function moveDrag(e: React.PointerEvent) {
    const d = drag;
    if (!d) return;
    const p = pdfPoint(e);
    if (d.kind === "move") {
      const dx = p.x - d.start.x;
      const dy = p.y - d.start.y;
      const moved = d.moved || Math.hypot(dx, dy) * t.scale > CLICK_SLOP;
      if (moved) setDrag({ ...d, moved, box: { ...d.origin, x: d.origin.x + dx, y: d.origin.y + dy } });
    } else if (d.kind === "resize") {
      // resize on screen (corner names are what the user sees), then back to the page: right on rotated pages too
      const host = hostRef.current!.getBoundingClientRect();
      const startCss = t.pdfToCss(d.start);
      const nowCss = { x: e.clientX - host.left, y: e.clientY - host.top };
      const v = resizeViewportRect(t.rectToCss(d.origin), d.handle, nowCss.x - startCss.x, nowCss.y - startCss.y, { keepAspect: !e.shiftKey, minSize: MIN_SIDE_PT * t.scale });
      setDrag({ ...d, moved: true, box: t.rectToPdf(v) });
    } else {
      const c = t.pdfToCss(d.center);
      const host = hostRef.current!.getBoundingClientRect();
      // 0° is "up"; the handle sits above the picture. Positive = clockwise on screen, which is counter-clockwise in page space.
      let deg = (Math.atan2(e.clientX - host.left - c.x, -(e.clientY - host.top - c.y)) * 180) / Math.PI;
      if (e.shiftKey || Math.abs(deg % 90) < 4) deg = Math.round(deg / (e.shiftKey ? 15 : 90)) * (e.shiftKey ? 15 : 90);
      setDrag({ ...d, moved: Math.abs(deg) > 0.5, degrees: -deg });
    }
  }

  function endDrag(e: React.PointerEvent) {
    const d = drag;
    if (!d) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // already released
    }
    setDrag(null);
    void finish(d);
  }

  const previewBox = (im: ImageInfo): Rect => (drag && drag.id === im.id && drag.kind !== "rotate" ? drag.box : im.bbox);
  const previewDeg = (im: ImageInfo) => (drag && drag.id === im.id && drag.kind === "rotate" ? -drag.degrees : 0);

  return (
    <>
      {analysis.images.map((im) => {
        // a picture that is (nearly) the whole page — a scan, a full-bleed background — is the page, not an object to grab
        const [x0, y0, x1, y1] = t.box;
        if (im.bbox.width * im.bbox.height >= 0.85 * (x1 - x0) * (y1 - y0)) return null;
        const css = t.rectToCss(previewBox(im));
        const isSel = selected?.kind === "image" && selected.imageId === im.id;
        const active = interactive && !editingBlockId;
        return (
          <div
            key={im.id}
            data-testid="native-image"
            data-image-id={im.id}
            role="button"
            tabIndex={active ? 0 : -1}
            aria-label={`Picture ${Math.round(im.bbox.width)} by ${Math.round(im.bbox.height)} points${isSel ? ", selected" : ""}`}
            aria-pressed={isSel}
            className={`absolute ${active ? "" : "pointer-events-none"} ${isSel ? "ring-2 ring-[var(--select)]" : hover === im.id ? "ring-1 ring-[var(--select)]/70" : ""}`}
            style={{ ...rectToCssStyle(css), cursor: active ? (drag?.kind === "move" ? "grabbing" : "grab") : "inherit", transform: `rotate(${previewDeg(im)}deg)`, touchAction: "none" }}
            onPointerEnter={() => setHover(im.id)}
            onPointerLeave={() => setHover((h) => (h === im.id ? null : h))}
            onPointerDown={(e) => startImageDrag(e, im, "move")}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                api.selectNative({ kind: "image", pageId, imageId: im.id });
              }
            }}
          >
            {isSel && active && (
              <>
                {(["nw", "ne", "sw", "se"] as const).map((h) => (
                  <span
                    key={h}
                    data-handle={h}
                    onPointerDown={(e) => startImageDrag(e, im, "resize", h)}
                    onPointerMove={moveDrag}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                    className="absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--select)] bg-white shadow [@media(pointer:coarse)]:h-6 [@media(pointer:coarse)]:w-6"
                    style={{ left: h.includes("w") ? 0 : "100%", top: h.startsWith("n") ? 0 : "100%", cursor: h === "nw" || h === "se" ? "nwse-resize" : "nesw-resize", touchAction: "none" }}
                  />
                ))}
                <span
                  data-handle="rotate"
                  onPointerDown={(e) => startImageDrag(e, im, "rotate")}
                  onPointerMove={moveDrag}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  aria-label="Rotate picture"
                  className="absolute left-1/2 h-4 w-4 -translate-x-1/2 rounded-full border-2 border-[var(--select)] bg-white shadow [@media(pointer:coarse)]:h-7 [@media(pointer:coarse)]:w-7"
                  style={{ top: -26, cursor: "grab", touchAction: "none" }}
                />
              </>
            )}
          </div>
        );
      })}

      {(() => {
        const sel = selected?.kind === "text" && !editingBlockId && interactive ? analysis.blocks.find((b) => b.id === selected.blockId) : null;
        if (!sel || !sel.editable) return null;
        const css = t.rectToCss(sel.bbox);
        return (
          <button
            type="button"
            data-testid="native-edit-button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onBeginEdit(sel.id)}
            className="btn btn-primary btn-sm absolute z-20 [@media(pointer:coarse)]:min-h-11"
            style={{ left: css.x, top: Math.max(4, css.y - 40) }}
            aria-label="Edit this text"
          >
            Edit text
          </button>
        );
      })()}

      {analysis.blocks.map((b) => {
        if (b.id === editingBlockId) return null;
        const css = t.rectToCss(b.bbox);
        const isSel = selected?.kind === "text" && selected.blockId === b.id;
        const active = interactive;
        return (
          <div
            key={b.id}
            data-testid="native-block"
            data-block-id={b.id}
            data-editable={b.editable ? "true" : "false"}
            data-text={b.text}
            data-bbox={JSON.stringify(b.bbox)}
            role="button"
            tabIndex={active ? 0 : -1}
            aria-label={`Text: ${b.text.slice(0, 120)}${b.editable ? "" : " (can't be edited)"}`}
            title={b.editable ? undefined : b.reason}
            className={`absolute rounded-[2px] ${active ? "" : "pointer-events-none"} ${isSel ? "ring-2 ring-[var(--select)] bg-[var(--select)]/5" : hover === b.id ? "ring-1 ring-[var(--select)]/60 bg-[var(--select)]/5" : ""}`}
            style={{ ...rectToCssStyle(css), cursor: active ? (b.editable ? "text" : "not-allowed") : "inherit" }}
            onPointerEnter={() => setHover(b.id)}
            onPointerLeave={() => setHover((h) => (h === b.id ? null : h))}
            onPointerDown={(e) => {
              if (!active) return;
              e.stopPropagation();
            }}
            onClick={(e) => {
              if (!active) return;
              e.stopPropagation();
              api.selectNative({ kind: "text", pageId, blockId: b.id });
              if (editTextTool && b.editable) onBeginEdit(b.id, { x: e.clientX, y: e.clientY });
              else if (editTextTool && !b.editable) api.showMessage(b.reason ?? "This text can't be edited.");
            }}
            onDoubleClick={(e) => {
              if (!active) return;
              e.stopPropagation();
              if (b.editable) onBeginEdit(b.id, { x: e.clientX, y: e.clientY });
              else api.showMessage(b.reason ?? "This text can't be edited.");
            }}
            onKeyDown={(e) => {
              if (!active) return;
              if (e.key === "Enter" && b.editable) {
                e.preventDefault();
                onBeginEdit(b.id);
              } else if (e.key === " ") {
                e.preventDefault();
                api.selectNative({ kind: "text", pageId, blockId: b.id });
              }
            }}
          />
        );
      })}
    </>
  );
}
