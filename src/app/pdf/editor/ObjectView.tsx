"use client";

import { pdfRectToViewport, type ViewportSpec } from "@/lib/editor/coordinates";
import type { EditorObject } from "@/lib/editor/types";
import { rgbToCss } from "./toolOptions";

interface ObjectViewProps {
  object: EditorObject;
  spec: ViewportSpec;
  selected: boolean;
  interactive: boolean;
  onPointerDownBody: (e: React.PointerEvent) => void;
  onPointerDownHandle: (e: React.PointerEvent, handle: string) => void;
  onSelect: () => void;
}

const HANDLES = ["nw", "ne", "sw", "se"];

export function ObjectView({ object, spec, selected, interactive, onPointerDownBody, onPointerDownHandle, onSelect }: ObjectViewProps) {
  const rect = pdfRectToViewport(spec, object);
  const style: React.CSSProperties = { left: rect.x, top: rect.y, width: rect.width, height: rect.height };

  return (
    <div
      className={`absolute ${interactive ? "cursor-move" : ""} ${selected ? "outline outline-2 outline-[var(--brand)]" : ""}`}
      style={style}
      onPointerDown={interactive ? onPointerDownBody : undefined}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      data-object-id={object.id}
      data-object-type={object.type}
    >
      <ObjectContent object={object} width={rect.width} height={rect.height} />

      {selected && interactive && (
        <>
          {HANDLES.map((h) => (
            <div
              key={h}
              onPointerDown={(e) => {
                e.stopPropagation();
                onPointerDownHandle(e, h);
              }}
              className="absolute h-3 w-3 rounded-full border-2 border-[var(--brand)] bg-white"
              style={{
                left: h.includes("w") ? -6 : undefined,
                right: h.includes("e") ? -6 : undefined,
                top: h.includes("n") ? -6 : undefined,
                bottom: h.includes("s") ? -6 : undefined,
                cursor: h === "nw" || h === "se" ? "nwse-resize" : "nesw-resize",
              }}
            />
          ))}
        </>
      )}
    </div>
  );
}

function ObjectContent({ object, width, height }: { object: EditorObject; width: number; height: number }) {
  switch (object.type) {
    case "native-text-replacement":
      return (
        <div className="h-full w-full border-2 border-[var(--accent-mint)] bg-white" title={`Corrected: ${object.newText}`}>
          <span className="block truncate px-0.5 text-[10px] leading-tight text-[var(--foreground)]">{object.newText}</span>
        </div>
      );
    case "ocr-text-replacement":
      // Rendered with the same sampled colors export.ts will actually use, so this preview
      // on the canvas matches the exported result as closely as practical instead of a
      // generic mint-box placeholder.
      return (
        <div
          className="h-full w-full outline outline-1 outline-[var(--accent-mint)]/60"
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
        <div
          className="flex h-full w-full items-center overflow-hidden whitespace-pre px-0.5"
          style={{
            fontSize: Math.max(8, Math.min(height, (object.fontSize / 14) * 16)),
            color: rgbToCss(object.color),
            fontWeight: object.bold ? 700 : 400,
            justifyContent: object.align === "center" ? "center" : object.align === "right" ? "flex-end" : "flex-start",
          }}
        >
          {object.text || "Text"}
        </div>
      );
    case "image":
    case "signature":
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={object.dataUrl} alt="" className="h-full w-full object-contain" draggable={false} />;
    case "drawing": {
      const xs = object.points.map((p) => p.x);
      const ys = object.points.map((p) => p.y);
      const maxX = Math.max(...xs, 1);
      const maxY = Math.max(...ys, 1);
      const path = object.points.map((p, i) => `${i === 0 ? "M" : "L"} ${(p.x / maxX) * width} ${height - (p.y / maxY) * height}`).join(" ");
      return (
        <svg width={width} height={height} className="overflow-visible">
          <path d={path} fill="none" stroke={rgbToCss(object.color)} strokeWidth={Math.max(1, object.strokeWidth)} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    }
    case "shape":
      return <ShapeContent object={object} width={width} height={height} />;
    case "whiteout":
      return <div className="h-full w-full border border-dashed border-[var(--foreground-muted)] bg-white" />;
    case "annotation":
      if (object.kind === "highlight") {
        return <div className="h-full w-full" style={{ backgroundColor: rgbToCss(object.color), opacity: 0.35 }} />;
      }
      return (
        <div className="relative h-full w-full">
          <div
            className="absolute left-0 right-0"
            style={{ top: object.kind === "underline" ? "100%" : "50%", height: 2, backgroundColor: rgbToCss(object.color) }}
          />
        </div>
      );
    default:
      return null;
  }
}

function ShapeContent({ object, width, height }: { object: Extract<EditorObject, { type: "shape" }>; width: number; height: number }) {
  const stroke = rgbToCss(object.strokeColor);
  const fill = object.fillColor ? rgbToCss(object.fillColor) : "none";
  if (object.shape === "rectangle") {
    return (
      <div style={{ width, height, border: `${object.strokeWidth}px solid ${stroke}`, backgroundColor: object.fillColor ? fill : "transparent" }} />
    );
  }
  if (object.shape === "ellipse") {
    return (
      <div
        style={{ width, height, borderRadius: "50%", border: `${object.strokeWidth}px solid ${stroke}`, backgroundColor: object.fillColor ? fill : "transparent" }}
      />
    );
  }
  // line + arrow
  return (
    <svg width={width} height={height} className="overflow-visible">
      <line x1={0} y1={0} x2={width} y2={height} stroke={stroke} strokeWidth={object.strokeWidth} />
      {object.shape === "arrow" && (
        <polygon
          points={arrowheadPoints(width, height, Math.max(8, Math.min(24, Math.hypot(width, height) * 0.2)))}
          fill={stroke}
        />
      )}
    </svg>
  );
}

function arrowheadPoints(width: number, height: number, size: number): string {
  const angle = Math.atan2(height, width);
  const tipX = width;
  const tipY = height;
  const a1 = angle + Math.PI - Math.PI / 7;
  const a2 = angle + Math.PI + Math.PI / 7;
  const p1x = tipX + size * Math.cos(a1);
  const p1y = tipY + size * Math.sin(a1);
  const p2x = tipX + size * Math.cos(a2);
  const p2y = tipY + size * Math.sin(a2);
  return `${tipX},${tipY} ${p1x},${p1y} ${p2x},${p2y}`;
}
