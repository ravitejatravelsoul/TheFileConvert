"use client";

import { useEffect, useMemo, useState } from "react";
import { FileWorkflow, type FileWorkflowResult } from "@/components/tools/FileWorkflow";
import { Field, FieldGrid, RangeField, SelectField } from "@/components/tools/fields";
import { Button } from "@/components/ui/Button";
import { cropImage, getImageDimensions, extensionForFormat, type ImageOutputFormat } from "@/lib/processors/image";
import { getToolById } from "@/lib/tools/registry";
import { safeOutputName } from "@/lib/format";

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
  const [format, setFormat] = useState<ImageOutputFormat>("jpeg");

  const previewUrl = useMemo(() => URL.createObjectURL(file), [file]);

  useEffect(() => {
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  useEffect(() => {
    let cancelled = false;
    getImageDimensions(file).then((d) => !cancelled && setDims(d));
    return () => {
      cancelled = true;
    };
  }, [file]);

  const maxLeft = 100 - cropWidth;
  const maxTop = 100 - cropHeight;

  return (
    <div className="space-y-4 pt-2">
      {previewUrl && (
        <div className="relative overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-muted)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt="" className="w-full opacity-40" />
          <div
            className="pointer-events-none absolute border-2 border-[var(--brand)] bg-[var(--brand)]/10"
            style={{
              left: `${left}%`,
              top: `${top}%`,
              width: `${cropWidth}%`,
              height: `${cropHeight}%`,
            }}
          />
        </div>
      )}
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
      <Button
        disabled={!dims}
        onClick={() =>
          run(async ([f]) => {
            if (!dims) return [];
            const px = {
              x: Math.round((left / 100) * dims.width),
              y: Math.round((top / 100) * dims.height),
              width: Math.round((cropWidth / 100) * dims.width),
              height: Math.round((cropHeight / 100) * dims.height),
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
