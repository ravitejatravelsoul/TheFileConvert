"use client";

import { useState } from "react";
import { FileWorkflow } from "@/components/tools/FileWorkflow";
import { Field, FieldGrid, SelectField, TextField } from "@/components/tools/fields";
import { Button } from "@/components/ui/Button";
import { rotatePages } from "@/lib/processors/pdf";
import { getToolById } from "@/lib/tools/registry";

const tool = getToolById("pdf-rotate")!;

export function RotateWorkflow() {
  const [degrees, setDegrees] = useState("90");
  const [range, setRange] = useState("");

  return (
    <FileWorkflow tool={tool} multiple={false}>
      {({ run }) => (
        <div className="space-y-4 pt-2">
          <FieldGrid>
            <Field label="Rotate by">
              <SelectField
                value={degrees}
                onChange={setDegrees}
                options={[
                  { value: "90", label: "90° clockwise" },
                  { value: "180", label: "180°" },
                  { value: "270", label: "270° clockwise" },
                ]}
              />
            </Field>
            <Field label="Pages (optional)" hint="Leave blank to rotate every page">
              <TextField value={range} onChange={setRange} placeholder="e.g. 1,3-5" />
            </Field>
          </FieldGrid>
          <Button
            onClick={() =>
              run(async (f) => [
                {
                  name: "rotated.pdf",
                  blob: await rotatePages(f[0], Number(degrees) as 90 | 180 | 270, range.trim() || undefined),
                },
              ])
            }
          >
            Rotate PDF
          </Button>
        </div>
      )}
    </FileWorkflow>
  );
}
