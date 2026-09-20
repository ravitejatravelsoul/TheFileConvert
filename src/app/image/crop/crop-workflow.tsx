"use client";

import { useEffect, useRef, useState } from "react";
import { FileWorkflow, type FileWorkflowResult } from "@/components/tools/FileWorkflow";
import { Field, FieldGrid, RangeField, SelectField } from "@/components/tools/fields";
import { Button } from "@/components/ui/Button";
import { cropImage, getImageDimensions, extensionForFormat, type ImageOutputFormat } from "@/lib/processors/image";
import { getToolById } from "@/lib/tools/registry";
import { safeOutputName } from "@/lib/format";
import { useImageOutputFormat, TransparencyNote } from "@/components/tools/useImageOutputFormat";

const tool = getToolById("image-crop")!;

function CropConfig({
  file,
  run,
}: {
  file: File;
  run: (handler: (files: File[]) => Promise<FileWorkflowResult[]>) => void;
}) {
  const [dims, setDims] = useState<{ width: number; height: number } | null>(null);
  const [left, setLeft] = useState(10);
  const [top, setTop] = useState(10);
  const [cropWidth, setCropWidth] = useState(80);
  const [cropHeight, setCropHeight] = useState(80);
  const { format, setFormat, transparentNames } = useImageOutputFormat([file]);

  // Created and revoked in the same effect: creating it in useMemo and revoking in a cleanup
  // breaks under StrictMode's mount/unmount/mount (the memoized URL is already revoked).
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    // Syncing React state with an external resource (an object URL) that this effect owns.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    let cancelled = false;
    getImageDimensions(file).then((d) => !cancelled && setDims(d));
    return () => {
      cancelled = true;
    };
  }, [file]);

  const maxLeft = 100 - cropWidth;
  const maxTop = 100 - cropHeight;

  // Drag on the preview: press outside the box to draw a new one, press inside it to move it.
  const previewRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: "draw" | "move"; startX: number; startY: number; boxLeft: number; boxTop: number } | null>(null);
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const pointPercent = (e: React.PointerEvent) => {
    const r = previewRef.current!.getBoundingClientRect();
    return { x: clamp(((e.clientX - r.left) / r.width) * 100, 0, 100), y: clamp(((e.clientY - r.top) / r.height) * 100, 0, 100) };
  };
  const onPreviewDown = (e: React.PointerEvent) => {
    const p = pointPercent(e);
    const inside = p.x >= left && p.x <= left + cropWidth && p.y >= top && p.y <= top + cropHeight;
    drag.current = { mode: inside ? "move" : "draw", startX: p.x, startY: p.y, boxLeft: left, boxTop: top };
    previewRef.current!.setPointerCapture(e.pointerId);
  };
  const onPreviewMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = pointPercent(e);
    if (d.mode === "move") {
      setLeft(clamp(d.boxLeft + (p.x - d.startX), 0, 100 - cropWidth));
      setTop(clamp(d.boxTop + (p.y - d.startY), 0, 100 - cropHeight));
    } else {
      setLeft(Math.min(d.startX, p.x));
      setTop(Math.min(d.startY, p.y));
      setCropWidth(Math.max(1, Math.abs(p.x - d.startX)));
      setCropHeight(Math.max(1, Math.abs(p.y - d.startY)));
    }
  };
  const onPreviewUp = (e: React.PointerEvent) => {
    drag.current = null;
    if (previewRef.current?.hasPointerCapture(e.pointerId)) previewRef.current.releasePointerCapture(e.pointerId);
  };
  const outW = dims ? Math.max(1, Math.round((cropWidth / 100) * dims.width)) : 0;
  const outH = dims ? Math.max(1, Math.round((cropHeight / 100) * dims.height)) : 0;

  return (
    <div className="space-y-4 pt-2">
      {previewUrl && (
        <div
          ref={previewRef}
          data-testid="crop-preview"
          onPointerDown={onPreviewDown}
          onPointerMove={onPreviewMove}
          onPointerUp={onPreviewUp}
          onPointerCancel={onPreviewUp}
          className="relative cursor-crosshair touch-none select-none overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-muted)]"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt="Image to crop" className="w-full" draggable={false} />
          <div
            data-testid="crop-rect"
            className="pointer-events-none absolute border-2 border-[var(--brand)] shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]"
            style={{
              left: `${left}%`,
              top: `${top}%`,
              width: `${cropWidth}%`,
              height: `${cropHeight}%`,
            }}
          />
        </div>
      )}
      <p className="text-sm text-[var(--foreground-muted)]" aria-live="polite">
        Drag on the picture to choose the area to keep{dims ? ` — output will be ${outW} × ${outH} px (from ${dims.width} × ${dims.height})` : ""}. The sliders fine-tune it.
      </p>
      <FieldGrid>
        <Field label="Crop width">
          <RangeField value={cropWidth} onChange={(v) => setCropWidth(Math.min(v, 100 - left))} min={5} max={100} suffix="%" />
        </Field>
        <Field label="Crop height">
          <RangeField value={cropHeight} onChange={(v) => setCropHeight(Math.min(v, 100 - top))} min={5} max={100} suffix="%" />
        </Field>
        <Field label="Position from left">
          <RangeField value={left} onChange={(v) => setLeft(Math.min(v, maxLeft))} min={0} max={Math.max(maxLeft, 0)} suffix="%" />
        </Field>
        <Field label="Position from top">
          <RangeField value={top} onChange={(v) => setTop(Math.min(v, maxTop))} min={0} max={Math.max(maxTop, 0)} suffix="%" />
        </Field>
      </FieldGrid>
      <Field label="Output format">
        <SelectField
          value={format}
          onChange={(v) => setFormat(v as ImageOutputFormat)}
          options={[
            { value: "jpeg", label: "JPG" },
            { value: "png", label: "PNG" },
            { value: "webp", label: "WebP" },
          ]}
        />
      </Field>
      <TransparencyNote format={format} transparentNames={transparentNames} />
      <Button
        disabled={!dims}
        onClick={() =>
          run(async ([f]) => {
            if (!dims) return [];
            const x = Math.min(dims.width - 1, Math.round((left / 100) * dims.width));
            const y = Math.min(dims.height - 1, Math.round((top / 100) * dims.height));
            // Rounded separately, x + width can overshoot the image by a pixel at the right/bottom edge.
            const px = {
              x,
              y,
              width: Math.max(1, Math.min(dims.width - x, Math.round((cropWidth / 100) * dims.width))),
              height: Math.max(1, Math.min(dims.height - y, Math.round((cropHeight / 100) * dims.height))),
            };
            return [
              {
                name: safeOutputName(f.name, "cropped", extensionForFormat(format)),
                blob: await cropImage(f, { ...px, format, quality: 0.92 }),
              },
            ];
          })
        }
      >
        Crop image
      </Button>
    </div>
  );
}

export function CropWorkflow() {
  return (
    <FileWorkflow tool={tool} multiple={false}>
      {({ files, run }) => (files[0] ? <CropConfig file={files[0]} run={run} /> : null)}
    </FileWorkflow>
  );
}
