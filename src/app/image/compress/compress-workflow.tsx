"use client";

import { useState } from "react";
import { FileWorkflow, type FileWorkflowResult } from "@/components/tools/FileWorkflow";
import { Field, FieldGrid, SelectField, RangeField } from "@/components/tools/fields";
import { Button } from "@/components/ui/Button";
import { useImageOutputFormat, TransparencyNote } from "@/components/tools/useImageOutputFormat";
import { convertImage, extensionForFormat, type ImageOutputFormat } from "@/lib/processors/image";
import { getToolById } from "@/lib/tools/registry";
import { safeOutputName } from "@/lib/format";

const tool = getToolById("image-compress")!;

const MIME_FOR: Record<ImageOutputFormat, string> = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

function CompressConfig({ files, run }: { files: File[]; run: (handler: (files: File[]) => Promise<FileWorkflowResult[]>) => void }) {
  // A PNG photo shrinks far more as WebP (which also keeps transparency) than as another PNG.
  const { format, setFormat, transparentNames } = useImageOutputFormat(files, "webp");
  const [quality, setQuality] = useState(75);

  return (
    <div className="space-y-4 pt-2">
      <FieldGrid>
        <Field label="Output format">
          <SelectField
            value={format}
            onChange={(v) => setFormat(v as ImageOutputFormat)}
            options={[
              { value: "jpeg", label: "JPG (small; no transparency)" },
              { value: "webp", label: "WebP (smallest; keeps transparency)" },
              { value: "png", label: "PNG (lossless; often larger)" },
            ]}
          />
        </Field>
        {format !== "png" && (
          <Field label="Quality" hint="Lower quality = smaller file">
            <RangeField value={quality} onChange={setQuality} min={10} max={95} />
          </Field>
        )}
      </FieldGrid>
      {format === "png" && (
        <p className="text-xs text-[var(--foreground-muted)]">
          PNG is lossless, so it rarely saves much and can even grow a photo. For real savings choose WebP or JPG.
        </p>
      )}
      <TransparencyNote format={format} transparentNames={transparentNames} />
      <p className="text-xs text-[var(--foreground-muted)]">Metadata (camera info, location) is removed from the compressed copy.</p>
      <Button
        disabled={files.length === 0}
        onClick={() =>
          run(async (fs) =>
            Promise.all(
              fs.map(async (file): Promise<FileWorkflowResult> => {
                const blob = await convertImage(file, { format, quality: quality / 100 });
                // Re-encoding a file that is already well compressed in the same format can make it bigger.
                // Never hand that back as if it were a result: keep the original bytes and say so.
                if (blob.size >= file.size && file.type === MIME_FOR[format]) {
                  return { name: file.name, blob: file, note: "This image is already well compressed at this setting, so your original is returned unchanged. Lower the quality for further savings." };
                }
                return { name: safeOutputName(file.name, "compressed", extensionForFormat(format)), blob };
              })
            )
          )
        }
      >
        Compress {files.length || ""} image{files.length === 1 ? "" : "s"}
      </Button>
    </div>
  );
}

export function CompressWorkflow() {
  return (
    <FileWorkflow tool={tool} multiple zipDownloadName="compressed-images.zip" noSavingsHint="Tip: lowering the quality slider, or choosing WebP, usually shrinks a photo much further.">
      {({ files, run }) => <CompressConfig files={files} run={run} />}
    </FileWorkflow>
  );
}
