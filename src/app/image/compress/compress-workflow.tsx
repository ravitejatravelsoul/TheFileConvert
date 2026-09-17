"use client";

import { useState } from "react";
import { FileWorkflow } from "@/components/tools/FileWorkflow";
import { Field, FieldGrid, SelectField, RangeField } from "@/components/tools/fields";
import { Button } from "@/components/ui/Button";
import { convertImage, extensionForFormat, type ImageOutputFormat } from "@/lib/processors/image";
import { getToolById } from "@/lib/tools/registry";
import { safeOutputName } from "@/lib/format";

const tool = getToolById("image-compress")!;

export function CompressWorkflow() {
  const [format, setFormat] = useState<ImageOutputFormat>("jpeg");
  const [quality, setQuality] = useState(75);

  return (
    <FileWorkflow tool={tool} multiple zipDownloadName="compressed-images.zip">
      {({ files, run }) => (
        <div className="space-y-4 pt-2">
          <FieldGrid>
            <Field label="Output format">
              <SelectField
                value={format}
                onChange={(v) => setFormat(v as ImageOutputFormat)}
                options={[
                  { value: "jpeg", label: "JPG (best compression)" },
                  { value: "webp", label: "WebP (best compression)" },
                  { value: "png", label: "PNG (lossless)" },
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
              PNG is lossless, so file size savings are modest. For maximum compression, choose JPG or WebP.
            </p>
          )}
          <Button
            disabled={files.length === 0}
            onClick={() =>
              run(async (fs) =>
                Promise.all(
                  fs.map(async (file) => ({
                    name: safeOutputName(file.name, "compressed", extensionForFormat(format)),
                    blob: await convertImage(file, { format, quality: quality / 100 }),
                  }))
                )
              )
            }
          >
            Compress {files.length || ""} image{files.length === 1 ? "" : "s"}
          </Button>
        </div>
      )}
    </FileWorkflow>
  );
}
