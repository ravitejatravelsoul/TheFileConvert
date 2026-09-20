"use client";

import { useState } from "react";
import { FileWorkflow, type FileWorkflowResult } from "@/components/tools/FileWorkflow";
import { Field, RangeField } from "@/components/tools/fields";
import { Button } from "@/components/ui/Button";
import { useImageOutputFormat, TransparencyNote } from "@/components/tools/useImageOutputFormat";
import { convertImage, extensionForFormat, type ImageOutputFormat } from "@/lib/processors/image";
import { safeOutputName } from "@/lib/format";
import type { ToolDefinition } from "@/lib/tools/types";

function ConvertConfig({
  files,
  run,
  targetFormat,
}: {
  files: File[];
  run: (handler: (files: File[]) => Promise<FileWorkflowResult[]>) => void;
  targetFormat: ImageOutputFormat;
}) {
  const [quality, setQuality] = useState(90);
  const showQuality = targetFormat !== "png";
  const { transparentNames } = useImageOutputFormat(files);

  return (
    <div className="space-y-4 pt-2">
      {showQuality && (
        <Field label="Quality">
          <RangeField value={quality} onChange={setQuality} min={10} max={100} />
        </Field>
      )}
      <TransparencyNote format={targetFormat} transparentNames={transparentNames} />
      {targetFormat === "png" && files.some((f) => f.type !== "image/png") && (
        <p className="text-xs text-[var(--foreground-muted)]">
          PNG is lossless, so a photo saved as PNG is usually several times larger than the original JPG or WebP. Nothing is lost in the conversion.
        </p>
      )}
      <Button
        disabled={files.length === 0}
        onClick={() =>
          run(async (fs) =>
            Promise.all(
              fs.map(async (file) => ({
                name: safeOutputName(file.name, "converted", extensionForFormat(targetFormat)),
                blob: await convertImage(file, { format: targetFormat, quality: quality / 100 }),
              }))
            )
          )
        }
      >
        Convert {files.length || ""} file{files.length === 1 ? "" : "s"}
      </Button>
    </div>
  );
}

export function ImageConvertWorkflow({ tool, targetFormat }: { tool: ToolDefinition; targetFormat: ImageOutputFormat }) {
  return (
    <FileWorkflow tool={tool} multiple zipDownloadName={`converted-${targetFormat}.zip`}>
      {({ files, run }) => <ConvertConfig files={files} run={run} targetFormat={targetFormat} />}
    </FileWorkflow>
  );
}
