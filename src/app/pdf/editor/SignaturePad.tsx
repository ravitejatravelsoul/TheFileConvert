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

  function pointerPos(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function startStroke(e: React.PointerEvent<HTMLCanvasElement>) {
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
      const dataUrl = canvasRef.current.toDataURL("image/png");
      onConfirm(dataUrl, canvasRef.current.width, canvasRef.current.height);
    } else if (mode === "upload" && uploadedDataUrl && uploadedDims) {
      onConfirm(uploadedDataUrl, uploadedDims.width, uploadedDims.height);
    }
  }

  const canConfirm = mode === "draw" ? hasStroke : Boolean(uploadedDataUrl);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
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
              onPointerLeave={endStroke}
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
