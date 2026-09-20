"use client";

import { useEffect, useState } from "react";
import { FileWorkflow, type FileWorkflowResult } from "@/components/tools/FileWorkflow";
import { Field, FieldGrid, NumberField, CheckboxField, SelectField } from "@/components/tools/fields";
import { Button } from "@/components/ui/Button";
import {
  resizeImage,
  getImageDimensions,
  computeAspectRatioSize,
  extensionForFormat,
  type ImageOutputFormat,
} from "@/lib/processors/image";
import { getToolById } from "@/lib/tools/registry";
import { safeOutputName } from "@/lib/format";
import { useImageOutputFormat, TransparencyNote } from "@/components/tools/useImageOutputFormat";

const tool = getToolById("image-resize")!;

function ResizeConfig({
  files,
  run,
}: {
  files: File[];
  run: (handler: (files: File[]) => Promise<FileWorkflowResult[]>) => void;
}) {
  const [width, setWidth] = useState(800);
  const [height, setHeight] = useState(600);
  const [lockAspect, setLockAspect] = useState(true);
  const { format, setFormat, transparentNames } = useImageOutputFormat(files);
  const [originalDims, setOriginalDims] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (files[0]) {
      getImageDimensions(files[0]).then((dims) => {
        if (cancelled) return;
        setOriginalDims(dims);
        setWidth(dims.width);
        setHeight(dims.height);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [files]);

  return (
    <div className="space-y-4 pt-2">
      {originalDims && (
        <p className="text-xs text-[var(--foreground-muted)]">
          Original: {originalDims.width} × {originalDims.height}px
        </p>
      )}
      <FieldGrid>
        <Field label="Width (px)">
          <NumberField
            value={width}
            min={1}
            onChange={(w) => {
              setWidth(w);
              if (lockAspect && originalDims) {
                setHeight(computeAspectRatioSize(originalDims, w, undefined).height);
              }
            }}
          />
        </Field>
        <Field label="Height (px)">
          <NumberField
            value={height}
            min={1}
            onChange={(h) => {
              setHeight(h);
              if (lockAspect && originalDims) {
                setWidth(computeAspectRatioSize(originalDims, undefined, h).width);
              }
            }}
          />
        </Field>
      </FieldGrid>
      <CheckboxField checked={lockAspect} onChange={setLockAspect} label="Lock aspect ratio" />
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
        disabled={files.length === 0}
        onClick={() =>
          run(async (fs) =>
            Promise.all(
              fs.map(async (file) => ({
                name: safeOutputName(file.name, "resized", extensionForFormat(format)),
                blob: await resizeImage(file, { width, height, format, quality: 0.9 }),
              }))
            )
          )
        }
      >
        Resize {files.length || ""} image{files.length === 1 ? "" : "s"}
      </Button>
    </div>
  );
}

export function ResizeWorkflow() {
  return (
    <FileWorkflow tool={tool} multiple zipDownloadName="resized-images.zip">
      {({ files, run }) => <ResizeConfig files={files} run={run} />}
    </FileWorkflow>
  );
}
