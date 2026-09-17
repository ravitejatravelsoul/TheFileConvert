"use client";

import { useState } from "react";
import { FileWorkflow } from "@/components/tools/FileWorkflow";
import { Field, FieldGrid, SelectField, NumberField } from "@/components/tools/fields";
import { Button } from "@/components/ui/Button";
import { addPageNumbers, type PageNumberOptions } from "@/lib/processors/pdf";
import { getToolById } from "@/lib/tools/registry";

const tool = getToolById("pdf-add-page-numbers")!;

export function PageNumbersWorkflow() {
  const [position, setPosition] = useState<PageNumberOptions["position"]>("bottom-center");
  const [startAt, setStartAt] = useState(1);

  return (
    <FileWorkflow tool={tool} multiple={false}>
      {({ run }) => (
        <div className="space-y-4 pt-2">
          <FieldGrid>
            <Field label="Position">
              <SelectField
                value={position}
                onChange={(v) => setPosition(v as PageNumberOptions["position"])}
                options={[
                  { value: "bottom-center", label: "Bottom center" },
                  { value: "bottom-right", label: "Bottom right" },
                  { value: "bottom-left", label: "Bottom left" },
                  { value: "top-center", label: "Top center" },
                ]}
              />
            </Field>
            <Field label="Start at">
              <NumberField value={startAt} onChange={setStartAt} min={0} max={9999} />
            </Field>
          </FieldGrid>
          <Button
            onClick={() =>
              run(async (f) => [
                { name: "numbered.pdf", blob: await addPageNumbers(f[0], { position, startAt, fontSize: 11 }) },
              ])
            }
          >
            Add page numbers
          </Button>
        </div>
      )}
    </FileWorkflow>
  );
}
