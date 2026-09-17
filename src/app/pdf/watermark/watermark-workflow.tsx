"use client";

import { useState } from "react";
import { FileWorkflow } from "@/components/tools/FileWorkflow";
import { Field, FieldGrid, TextField, RangeField } from "@/components/tools/fields";
import { Button } from "@/components/ui/Button";
import { addWatermark } from "@/lib/processors/pdf";
import { getToolById } from "@/lib/tools/registry";

const tool = getToolById("pdf-watermark")!;

export function WatermarkWorkflow() {
  const [text, setText] = useState("CONFIDENTIAL");
  const [opacity, setOpacity] = useState(0.3);
  const [rotation, setRotation] = useState(45);

  return (
    <FileWorkflow tool={tool} multiple={false}>
      {({ run }) => (
        <div className="space-y-4 pt-2">
          <Field label="Watermark text">
            <TextField value={text} onChange={setText} placeholder="CONFIDENTIAL" />
          </Field>
          <FieldGrid>
            <Field label="Opacity">
              <RangeField value={opacity} onChange={setOpacity} min={0.05} max={1} step={0.05} />
            </Field>
            <Field label="Rotation">
              <RangeField value={rotation} onChange={setRotation} min={0} max={90} suffix="°" />
            </Field>
          </FieldGrid>
          <Button
            disabled={!text.trim()}
            onClick={() =>
              run(async (f) => [
                {
                  name: "watermarked.pdf",
                  blob: await addWatermark(f[0], { text, opacity, fontSize: 48, rotationDegrees: rotation }),
                },
              ])
            }
          >
            Add watermark
          </Button>
        </div>
      )}
    </FileWorkflow>
  );
}
