"use client";

import { useEffect, useState } from "react";
import { FileWorkflow, type FileWorkflowResult } from "@/components/tools/FileWorkflow";
import { Field, FieldGrid, NumberField, CheckboxField } from "@/components/tools/fields";
import { Button } from "@/components/ui/Button";
import { svgToPng } from "@/lib/processors/image";
import { getToolById } from "@/lib/tools/registry";
import { safeOutputName } from "@/lib/format";

const tool = getToolById("svg-to-png")!;

function SvgConfig({
  file,
  run,
}: {
  file: File;
  run: (handler: (files: File[]) => Promise<FileWorkflowResult[]>) => void;
}) {
  const [width, setWidth] = useState(512);
  const [height, setHeight] = useState(512);
  const [lockAspect, setLockAspect] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      if (img.naturalWidth && img.naturalHeight) {
        setWidth(img.naturalWidth);
        setHeight(img.naturalHeight);
      }
      URL.revokeObjectURL(url);
    };
    img.src = url;
    return () => {
      cancelled = true;
    };
  }, [file]);

  return (
    <div className="space-y-4 pt-2">
      <FieldGrid>
        <Field label="Width (px)">
          <NumberField
            value={width}
            min={1}
            onChange={(w) => {
              const ratio = height / (width || 1);
              setWidth(w);
              if (lockAspect) setHeight(Math.round(w * ratio));
            }}
          />
        </Field>
        <Field label="Height (px)">
          <NumberField
            value={height}
            min={1}
            onChange={(h) => {
              const ratio = width / (height || 1);
              setHeight(h);
              if (lockAspect) setWidth(Math.round(h * ratio));
            }}
          />
        </Field>
      </FieldGrid>
      <CheckboxField checked={lockAspect} onChange={setLockAspect} label="Lock aspect ratio" />
      <Button
        onClick={() =>
          run(async ([f]) => [{ name: safeOutputName(f.name, "converted", "png"), blob: await svgToPng(f, { width, height }) }])
        }
      >
        Convert to PNG
      </Button>
    </div>
  );
}

export function SvgToPngWorkflow() {
  return (
    <FileWorkflow tool={tool} multiple={false}>
      {({ files, run }) => (files[0] ? <SvgConfig file={files[0]} run={run} /> : null)}
    </FileWorkflow>
  );
}
