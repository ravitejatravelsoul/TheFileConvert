"use client";

import { useState } from "react";
import { FileWorkflow } from "@/components/tools/FileWorkflow";
import { Field, FieldGrid, SelectField, RangeField } from "@/components/tools/fields";
import { Button } from "@/components/ui/Button";
import { pdfToImages } from "@/lib/processors/pdf";
import { getToolById } from "@/lib/tools/registry";

const tool = getToolById("pdf-to-images")!;

export function ToImagesWorkflow() {
  const [format, setFormat] = useState<"png" | "jpeg">("png");
  const [scale, setScale] = useState(2);

  return (
    <FileWorkflow tool={tool} multiple={false} zipDownloadName="pdf-pages.zip">
      {({ run }) => (
        <div className="space-y-4 pt-2">
          <FieldGrid>
            <Field label="Format">
              <SelectField
                value={format}
                onChange={(v) => setFormat(v as "png" | "jpeg")}
                options={[
                  { value: "png", label: "PNG" },
                  { value: "jpeg", label: "JPG" },
                ]}
              />
            </Field>
            <Field label="Resolution" hint="Higher scale = sharper, larger files">
              <RangeField value={scale} onChange={setScale} min={1} max={4} step={0.5} suffix="x" />
            </Field>
          </FieldGrid>
          <Button onClick={() => run((f) => pdfToImages(f[0], format, scale))}>Convert to images</Button>
        </div>
      )}
    </FileWorkflow>
  );
}
