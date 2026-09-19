"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";

interface SignaturePadProps {
  onConfirm: (dataUrl: string, naturalWidth: number, naturalHeight: number) => void;
  onClose: () => void;
}

export function SignaturePad({ onConfirm, onClose }: SignaturePadProps) {
  const [mode, setMode] = useState<"draw" | "upload">("draw");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const [hasStroke, setHasStroke] = useState(false);
  const [uploadedDataUrl, setUploadedDataUrl] = useState<string | null>(null);
  const [uploadedDims, setUploadedDims] = useState<{ width: number; height: number } | null>(null);

  function getCtx() {
    const canvas = canvasRef.current;
    return canvas?.getContext("2d") ?? null;
  }

  /** Pointer position in the canvas's own pixel space. The canvas is drawn at a fixed 400x160
   * but displayed at whatever width the dialog gives it (narrower on a phone), so CSS pixels
   * must be scaled to canvas pixels — otherwise strokes land offset from the pointer. */
  function pointerPos(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) * canvas.width) / Math.max(1, rect.width),
      y: ((e.clientY - rect.top) * canvas.height) / Math.max(1, rect.height),
    };
  }

  function startStroke(e: React.PointerEvent<HTMLCanvasElement>) {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // best-effort: a stroke still works without capture
    }
    drawingRef.current = true;
    const ctx = getCtx();
    if (!ctx) return;
    const p = pointerPos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    setHasStroke(true);
  }

  function moveStroke(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const ctx = getCtx();
    if (!ctx) return;
    const p = pointerPos(e);
    ctx.lineTo(p.x, p.y);
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
  }

  function endStroke() {
    drawingRef.current = false;
  }

  function clearCanvas() {
    const canvas = canvasRef.current;
    const ctx = getCtx();
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasStroke(false);
  }

  async function handleUpload(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const img = new Image();
      img.onload = () => {
        setUploadedDataUrl(dataUrl);
        setUploadedDims({ width: img.naturalWidth, height: img.naturalHeight });
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }

  function confirm() {
    if (mode === "draw" && canvasRef.current && hasStroke) {
      // Crop to the ink (plus a small margin) so the placed signature is the size of the
      // signature itself, not of the whole empty drawing area.
      const trimmed = trimToInk(canvasRef.current);
      onConfirm(trimmed.canvas.toDataURL("image/png"), trimmed.canvas.width, trimmed.canvas.height);
    } else if (mode === "upload" && uploadedDataUrl && uploadedDims) {
      onConfirm(uploadedDataUrl, uploadedDims.width, uploadedDims.height);
    }
  }

  const canConfirm = mode === "draw" ? hasStroke : Boolean(uploadedDataUrl);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-[var(--radius-lg)] bg-[var(--surface)] p-5 shadow-[var(--shadow-lifted)]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="signature-heading"
      >
        <h2 id="signature-heading" className="text-base font-semibold text-[var(--foreground)]">
          Add signature
        </h2>

        <div className="mt-3 flex gap-1.5">
          <button
            type="button"
            onClick={() => setMode("draw")}
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${mode === "draw" ? "bg-[var(--brand)] text-white" : "bg-[var(--surface-muted)] text-[var(--foreground-muted)]"}`}
          >
            Draw
          </button>
          <button
            type="button"
            onClick={() => setMode("upload")}
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${mode === "upload" ? "bg-[var(--brand)] text-white" : "bg-[var(--surface-muted)] text-[var(--foreground-muted)]"}`}
          >
            Upload image
          </button>
        </div>

        {mode === "draw" ? (
          <div className="mt-3">
            <canvas
              ref={canvasRef}
              width={400}
              height={160}
              className="w-full touch-none rounded-[var(--radius-sm)] border border-[var(--border)] bg-white"
              onPointerDown={startStroke}
              onPointerMove={moveStroke}
              onPointerUp={endStroke}
              onPointerCancel={endStroke}
              role="img"
              aria-label="Signature drawing area"
            />
            <button type="button" onClick={clearCanvas} className="mt-2 text-xs font-medium text-[var(--brand)] hover:underline">
              Clear
            </button>
          </div>
        ) : (
          <div className="mt-3">
            <input
              type="file"
              accept="image/png,image/jpeg"
              aria-label="Upload signature image"
              onChange={(e) => handleUpload(e.target.files?.[0])}
              className="block w-full text-sm text-[var(--foreground-muted)] file:mr-3 file:rounded-full file:border-0 file:bg-[var(--brand-soft)] file:px-4 file:py-2 file:text-sm file:font-medium file:text-[var(--brand)]"
            />
            {uploadedDataUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={uploadedDataUrl} alt="Uploaded signature preview" className="mt-2 max-h-32 rounded border border-[var(--border)] bg-white p-2" />
            )}
          </div>
        )}

        <p className="mt-3 text-xs text-[var(--foreground-muted)]">
          This stays on your device for this session only — nothing is uploaded or stored remotely. This is a visual
          signature, not certificate-based digital signing.
        </p>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={!canConfirm}>
            Place signature
          </Button>
        </div>
      </div>
    </div>
  );
}

/** A copy of `source` cropped to the bounding box of its non-transparent pixels, plus a small
 * margin. Returns the original untouched if nothing was drawn. */
function trimToInk(source: HTMLCanvasElement, pad = 6): { canvas: HTMLCanvasElement } {
  const ctx = source.getContext("2d");
  if (!ctx) return { canvas: source };
  const { width, height } = source;
  const data = ctx.getImageData(0, 0, width, height).data;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < x0 || y1 < y0) return { canvas: source };
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(width - 1, x1 + pad);
  y1 = Math.min(height - 1, y1 + pad);
  const out = document.createElement("canvas");
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext("2d")?.drawImage(source, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return { canvas: out };
}
