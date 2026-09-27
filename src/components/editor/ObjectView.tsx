"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { pdfRectToViewport, pdfRectToCssStyle, pdfToViewportPoint, type ViewportSpec } from "@/lib/editor/coordinates";
import { annotationLineThickness, arrowHead, drawingPdfPoints, lineEndpoints } from "@/lib/editor/shapeGeometry";
import { TEXT_LINE_HEIGHT } from "@/lib/editor/textLayout";
import { DESCENT_SHARE } from "@/lib/editor/nativeText";
import { contentFrame } from "@/lib/editor/contentFrame";
import type { AddedTextObject, DrawingObjectData, EditorObject, ShapeObjectData } from "@/lib/editor/types";
import { rgbToCss } from "./toolOptions";

interface ObjectViewProps {
  object: EditorObject;
  spec: ViewportSpec;
  selected: boolean;
  interactive: boolean;
  onPointerDownBody: (e: React.PointerEvent) => void;
  onPointerDownHandle: (e: React.PointerEvent, handle: string) => void;
  onSelect: () => void;
  /** True while a caret is inside this (text) object. */
  editing?: boolean;
  onStartEdit?: () => void;
  onStopEdit?: () => void;
  onTextChange?: (text: string) => void;
  /** Called when the text's natural height (px) no longer matches the box, so the box can grow
   * or shrink to fit what's typed. */
  onAutoHeight?: (heightPx: number) => void;
  /** Whether entering edit mode should select all text (a freshly-placed box's placeholder), so
   * typing replaces it. */
  selectAllOnEdit?: boolean;
}

const HANDLES = ["nw", "ne", "sw", "se"];

export function ObjectView({
  object,
  spec,
  selected,
  interactive,
  onPointerDownBody,
  onPointerDownHandle,
  onSelect,
  editing = false,
  onStartEdit,
  onStopEdit,
  onTextChange,
  onAutoHeight,
  selectAllOnEdit,
}: ObjectViewProps) {
  const rect = pdfRectToViewport(spec, object);
  // While a persistent drawing tool (highlight, draw, ...) is armed, existing objects must be
  // transparent to the pointer — otherwise starting a stroke over one (an underline across a
  // highlight, say) would hit the object instead of the page and the stroke would never begin.
  const style: React.CSSProperties = {
    ...pdfRectToCssStyle(spec, object),
    pointerEvents: interactive ? "auto" : "none",
    touchAction: interactive ? "none" : undefined,
  };

  return (
    <div
      className={`absolute ${interactive && !editing ? "cursor-move" : ""} ${selected ? "outline outline-2 outline-[var(--select)]" : ""}`}
      style={style}
      onPointerDown={interactive && !editing ? onPointerDownBody : undefined}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onDoubleClick={(e) => {
        if (object.type !== "added-text" || !interactive) return;
        e.stopPropagation();
        onStartEdit?.();
      }}
      data-object-id={object.id}
      data-object-type={object.type}
    >
      <ObjectContent
        object={object}
        spec={spec}
        width={rect.width}
        height={rect.height}
        editing={editing}
        onStopEdit={onStopEdit}
        onTextChange={onTextChange}
        onAutoHeight={onAutoHeight}
        selectAllOnEdit={selectAllOnEdit}
      />

      {selected && interactive && (
        <>
          {HANDLES.map((h) => (
            <div
              key={h}
              onPointerDown={(e) => {
                e.stopPropagation();
                onPointerDownHandle(e, h);
              }}
              className="absolute h-3 w-3 rounded-full border-2 border-[var(--select)] bg-white"
              style={{
                // Offset by the handle's own full size (not half), so it sits just outside
                // the object's box rather than straddling the corner — at half-offset, each
                // 12px handle covered 6px *into* the box, invisible for a normal-sized object
                // but enough to visually obscure a large fraction of a very small one (e.g. a
                // single-character OCR correction patch, now tight enough for this to matter
                // right when it's auto-selected after Save).
                left: h.includes("w") ? -12 : undefined,
                right: h.includes("e") ? -12 : undefined,
                top: h.includes("n") ? -12 : undefined,
                bottom: h.includes("s") ? -12 : undefined,
                cursor: h === "nw" || h === "se" ? "nwse-resize" : "nesw-resize",
              }}
            />
          ))}
        </>
      )}
    </div>
  );
}

interface ContentProps {
  object: EditorObject;
  spec: ViewportSpec;
  width: number;
  height: number;
  editing: boolean;
  onStopEdit?: () => void;
  onTextChange?: (text: string) => void;
  onAutoHeight?: (heightPx: number) => void;
  selectAllOnEdit?: boolean;
}

function ObjectContent({ object, spec, width, height, editing, onStopEdit, onTextChange, onAutoHeight, selectAllOnEdit }: ContentProps) {
  switch (object.type) {
    case "native-text-replacement": {
      // Drawn the way export draws it: white cover, Helvetica at the original size on the original
      // baseline, shrunk only if it wouldn't fit the line's width.
      const pxPerPt = height / object.height;
      let fontPx = object.fontSize * pxPerPt;
      const natural = measureHelvetica(object.newText, fontPx);
      if (natural > width - pxPerPt && natural > 0) fontPx = Math.max(4 * pxPerPt, fontPx * ((width - pxPerPt) / natural));
      return (
        <div className="relative h-full w-full overflow-visible bg-white" title={`Edited: ${object.newText}`}>
          <span
            className="absolute whitespace-nowrap text-black"
            style={{ left: 0.5 * pxPerPt, bottom: height * DESCENT_SHARE - fontPx * HELVETICA_DESCENT, fontSize: fontPx, lineHeight: 1, fontFamily: "Helvetica, Arial, sans-serif" }}
          >
            {object.newText}
          </span>
        </div>
      );
    }
    case "ocr-text-replacement":
      // When a raster patch was composed (the normal scanned-text path — see scanPatch.ts),
      // render *that exact image*: the live canvas then shows precisely what export will
      // embed, not an approximation. Falls back to a CSS approximation for legacy objects
      // (saved before this patch pipeline existed) or when patch generation failed.
      if (object.patchDataUrl) {
        return (
          <ContentLayer object={object} spec={spec}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={object.patchDataUrl} alt="" title={`Corrected: ${object.newText}`} className="h-full w-full object-fill" draggable={false} />
          </ContentLayer>
        );
      }
      return (
        <div
          className="h-full w-full outline outline-1 outline-[var(--success)]/60"
          style={{ backgroundColor: object.overlayOnly ? "transparent" : rgbToCss(object.backgroundColor) }}
          title={`Corrected: ${object.newText}`}
        >
          <span className="block truncate px-0.5 text-[10px] leading-tight" style={{ color: rgbToCss(object.textColor) }}>
            {object.newText}
          </span>
        </div>
      );
    case "added-text":
      return (
        <AddedTextContent
          object={object}
          spec={spec}
          boxHeightPx={contentFrame(object, object.rotation).height * spec.scale}
          editing={editing}
          onStopEdit={onStopEdit}
          onTextChange={onTextChange}
          onAutoHeight={onAutoHeight}
          selectAllOnEdit={selectAllOnEdit}
        />
      );
    case "image":
    case "signature":
      return (
        <ContentLayer object={object} spec={spec}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={object.dataUrl} alt="" className="h-full w-full object-fill" draggable={false} />
        </ContentLayer>
      );
    case "drawing":
      return <DrawingContent object={object} spec={spec} width={width} height={height} />;
    case "shape":
      return <ShapeContent object={object} spec={spec} width={width} height={height} />;
    case "whiteout":
      return <div className="h-full w-full border border-dashed border-[var(--ink-2)] bg-white" />;
    case "annotation": {
      if (object.kind === "highlight") {
        return <div className="h-full w-full" style={{ backgroundColor: rgbToCss(object.color), opacity: 0.35 }} />;
      }
      // Same stroke the export draws: at the box's bottom edge (underline) or middle
      // (strikethrough), centered on that line, with the same thickness rule.
      const thickness = annotationLineThickness(object.height) * spec.scale;
      return (
        <div className="relative h-full w-full">
          <div
            className="absolute left-0 right-0"
            style={{
              top: object.kind === "underline" ? "100%" : "50%",
              height: thickness,
              marginTop: -thickness / 2,
              backgroundColor: rgbToCss(object.color),
            }}
          />
        </div>
      );
    }
    default:
      return null;
  }
}

/** Maps a PDF-space point to this object's own local viewport coordinates (origin at the
 * object's top-left corner) — going through the one coordinate transform, so rotation and zoom
 * are handled exactly as everywhere else. */
function makeToLocal(spec: ViewportSpec, object: EditorObject) {
  const origin = pdfRectToViewport(spec, object);
  return (p: { x: number; y: number }) => {
    const v = pdfToViewportPoint(spec, p);
    return { x: v.x - origin.x, y: v.y - origin.y };
  };
}

function DrawingContent({ object, spec, width, height }: { object: DrawingObjectData; spec: ViewportSpec; width: number; height: number }) {
  const toLocal = makeToLocal(spec, object);
  const pts = drawingPdfPoints(object).map(toLocal);
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  return (
    <svg width={width} height={height} className="overflow-visible">
      <path d={d} fill="none" stroke={rgbToCss(object.color)} strokeWidth={Math.max(1, object.strokeWidth * spec.scale)} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ShapeContent({ object, spec, width, height }: { object: ShapeObjectData; spec: ViewportSpec; width: number; height: number }) {
  const stroke = rgbToCss(object.strokeColor);
  const fill = object.fillColor ? rgbToCss(object.fillColor) : "none";
  const sw = Math.max(0.5, object.strokeWidth * spec.scale);
  // Strokes are centered on the shape's edge, exactly as the PDF export draws them.
  if (object.shape === "rectangle") {
    return (
      <svg width={width} height={height} className="overflow-visible">
        <rect x={0} y={0} width={width} height={height} fill={fill} stroke={stroke} strokeWidth={sw} />
      </svg>
    );
  }
  if (object.shape === "ellipse") {
    return (
      <svg width={width} height={height} className="overflow-visible">
        <ellipse cx={width / 2} cy={height / 2} rx={width / 2} ry={height / 2} fill={fill} stroke={stroke} strokeWidth={sw} />
      </svg>
    );
  }
  // line + arrow, in the direction the user dragged them
  const toLocal = makeToLocal(spec, object);
  const { start, end } = lineEndpoints(object);
  const a = toLocal(start);
  const b = toLocal(end);
  let head: { l: { x: number; y: number }; r: { x: number; y: number } } | null = null;
  if (object.shape === "arrow") {
    const h = arrowHead(start, end, object.width, object.height);
    head = { l: toLocal(h.left), r: toLocal(h.right) };
  }
  return (
    <svg width={width} height={height} className="overflow-visible">
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={stroke} strokeWidth={sw} />
      {head && (
        <>
          <line x1={b.x} y1={b.y} x2={head.l.x} y2={head.l.y} stroke={stroke} strokeWidth={sw} />
          <line x1={b.x} y1={b.y} x2={head.r.x} y2={head.r.y} stroke={stroke} strokeWidth={sw} />
        </>
      )}
    </svg>
  );
}

interface AddedTextProps {
  object: AddedTextObject;
  spec: ViewportSpec;
  boxHeightPx: number;
  editing: boolean;
  onStopEdit?: () => void;
  onTextChange?: (text: string) => void;
  onAutoHeight?: (heightPx: number) => void;
  selectAllOnEdit?: boolean;
}

/** An added text box. Rendered at fontSize * scale so it scales with zoom exactly as the PDF
 * export sizes it (in points), wraps within the box, and — while editing — is a real
 * <textarea> sitting on the page, so typing, caret movement, selection, Backspace/Delete and
 * arrow keys all behave natively. The box's height follows its content. */
function AddedTextContent({ object, spec, boxHeightPx, editing, onStopEdit, onTextChange, onAutoHeight, selectAllOnEdit }: AddedTextProps) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const divRef = useRef<HTMLDivElement>(null);
  const fontPx = object.fontSize * spec.scale;

  const common: React.CSSProperties = {
    fontFamily: "Helvetica, Arial, sans-serif",
    fontSize: fontPx,
    lineHeight: TEXT_LINE_HEIGHT,
    fontWeight: object.bold ? 700 : 400,
    color: rgbToCss(object.color),
    textAlign: object.align,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    margin: 0,
    padding: 0,
    border: 0,
    width: "100%",
  };

  // Grow/shrink the box to the text's natural height (measured in the DOM, so it follows the
  // browser's real wrapping) — without this, a sentence typed into the default one-line box
  // would be clipped or spill out of its selection frame.
  useLayoutEffect(() => {
    let natural: number;
    if (editing && taRef.current) {
      taRef.current.style.height = "0px";
      natural = taRef.current.scrollHeight;
      taRef.current.style.height = `${natural}px`;
    } else if (divRef.current) {
      natural = divRef.current.offsetHeight;
    } else {
      return;
    }
    const target = Math.max(fontPx * TEXT_LINE_HEIGHT, natural);
    if (Math.abs(target - boxHeightPx) > 0.75) onAutoHeight?.(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [object.text, object.width, object.height, object.rotation, object.bold, object.fontSize, spec.scale, spec.rotation, editing]);

  // Focus the moment the editor appears, so the very first keystroke after clicking lands in it
  // (waiting a tick, as below, left a window where a fast typist's first letter was dropped).
  // The value at that moment is remembered so the delayed re-focus below can tell a still-untouched
  // box from one a fast typist has already started replacing.
  const valueAtFocusRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!editing) return;
    const ta = taRef.current;
    if (!ta) return;
    ta.focus({ preventScroll: true });
    if (selectAllOnEdit) ta.select();
    else ta.setSelectionRange(ta.value.length, ta.value.length);
    valueAtFocusRef.current = ta.value;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  useEffect(() => {
    if (!editing) return;
    // Focus again after the current pointer gesture finishes: focus taken during the pointerdown
    // that created/entered edit mode can be undone by the browser's own mousedown focus handling.
    // A fast typist (or a script) can already have replaced the placeholder text by the time this
    // fires — re-selecting unconditionally would then wipe out those keystrokes. Only re-apply the
    // selection if the box still holds exactly what it held when we first focused it; either way,
    // still re-focus, since that part only steals back focus and never touches existing content.
    const t = setTimeout(() => {
      const ta = taRef.current;
      if (!ta) return;
      ta.focus();
      if (ta.value !== valueAtFocusRef.current) return;
      if (selectAllOnEdit) ta.select();
      else ta.setSelectionRange(ta.value.length, ta.value.length);
    }, 0);
    return () => clearTimeout(t);
  }, [editing, selectAllOnEdit]);

  const frame = (content: React.ReactNode) => (
    <ContentLayer object={object} spec={spec}>
      {content}
    </ContentLayer>
  );

  if (editing) {
    return frame(
      <textarea
        ref={taRef}
        aria-label="Edit text on page"
        data-testid="canvas-text-editor"
        value={object.text}
        rows={1}
        spellCheck={false}
        onChange={(e) => onTextChange?.(e.target.value)}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // Undo/redo stay app-level while typing on the page (typing bursts are one undo
          // step), so let those shortcuts reach the editor's own handler.
          const key = e.key.toLowerCase();
          if ((e.ctrlKey || e.metaKey) && (key === "z" || key === "y")) return;
          e.stopPropagation();
          if (e.key === "Escape") {
            e.preventDefault();
            onStopEdit?.();
          }
        }}
        onBlur={() => onStopEdit?.()}
        style={{ ...common, display: "block", background: "transparent", outline: "none", resize: "none", overflow: "hidden", cursor: "text" }}
      />
    );
  }

  return frame(
    <div ref={divRef} style={{ ...common, cursor: "inherit" }}>
      {object.text || "​"}
    </div>
  );
}

/** Content with an "up" (text, pictures, signatures, scan corrections) is laid out in its own frame —
 * the same frame export draws it in (see contentFrame.ts) — and turned into place on screen by however
 * far the page is shown rotated relative to that frame. Content created on the page as it is shown is
 * upright (no turn); content from before a later page rotation turns with the page, as in the PDF. */
function ContentLayer({ object, spec, children }: { object: EditorObject & { rotation?: number }; spec: ViewportSpec; children: React.ReactNode }) {
  const frame = contentFrame(object, object.rotation);
  const turn = (((spec.rotation - frame.rotation) % 360) + 360) % 360;
  if (turn === 0) return <>{children}</>;
  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        width: frame.width * spec.scale,
        height: frame.height * spec.scale,
        transform: `translate(-50%, -50%) rotate(${turn}deg)`,
      }}
    >
      {children}
    </div>
  );
}

/** Helvetica's descent as a share of the font size (line-height 1 puts the baseline this far above the box bottom). */
const HELVETICA_DESCENT = 0.207;
let measureCtx: CanvasRenderingContext2D | null = null;

/** Width of text in Helvetica (or its metric twin Arial) at a pixel size — the font export uses. */
function measureHelvetica(text: string, px: number): number {
  measureCtx ??= document.createElement("canvas").getContext("2d");
  if (!measureCtx) return 0;
  measureCtx.font = `${px}px Helvetica, Arial, sans-serif`;
  return measureCtx.measureText(text).width;
}
