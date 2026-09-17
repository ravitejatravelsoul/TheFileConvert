"use client";

import { useState } from "react";
import { FileWorkflow } from "@/components/tools/FileWorkflow";
import { Field, FieldGrid, SelectField, CheckboxField } from "@/components/tools/fields";
import { Button } from "@/components/ui/Button";
import { rotateFlipImage, extensionForFormat, type ImageOutputFormat } from "@/lib/processors/image";
import { getToolById } from "@/lib/tools/registry";
import { safeOutputName } from "@/lib/format";

const tool = getToolById("image-rotate")!;

export function RotateWorkflow() {
  const [rotateDegrees, setRotateDegrees] = useState<"0" | "90" | "180" | "270">("90");
  const [flipHorizontal, setFlipHorizontal] = useState(false);
  const [flipVertical, setFlipVertical] = useState(false);
  const [format, setFormat] = useState<ImageOutputFormat>("jpeg");

  return (
    <FileWorkflow tool={tool} multiple zipDownloadName="rotated-images.zip">
      {({ files, run }) => (
        <div className="space-y-4 pt-2">
          <FieldGrid>
            <Field label="Rotate">
              <SelectField
                value={rotateDegrees}
                onChange={(v) => setRotateDegrees(v as typeof rotateDegrees)}
                options={[
                  { value: "0", label: "No rotation" },
                  { value: "90", label: "90° clockwise" },
                  { value: "180", label: "180°" },
                  { value: "270", label: "270° clockwise" },
                ]}
              />
            </Field>
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
          </FieldGrid>
          <div className="flex gap-6">
            <CheckboxField checked={flipHorizontal} onChange={setFlipHorizontal} label="Flip horizontal" />
            <CheckboxField checked={flipVertical} onChange={setFlipVertical} label="Flip vertical" />
          </div>
          <Button
            disabled={files.length === 0}
            onClick={() =>
              run(async (fs) =>
                Promise.all(
                  fs.map(async (file) => ({
                    name: safeOutputName(file.name, "rotated", extensionForFormat(format)),
                    blob: await rotateFlipImage(file, {
                      rotateDegrees: Number(rotateDegrees) as 0 | 90 | 180 | 270,
                      flipHorizontal,
                      flipVertical,
                      format,
                      quality: 0.92,
                    }),
                  }))
                )
              )
            }
          >
            Apply
          </Button>
        </div>
      )}
    </FileWorkflow>
  );
}
