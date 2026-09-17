"use client";

import { useState } from "react";
import { FileWorkflow } from "@/components/tools/FileWorkflow";
import { Field, FieldGrid, SelectField, RangeField } from "@/components/tools/fields";
import { Button } from "@/components/ui/Button";
import { imagesToPdf, type ImagesToPdfOptions } from "@/lib/processors/pdf";
import { getToolById } from "@/lib/tools/registry";

const tool = getToolById("images-to-pdf")!;

export function ImagesToPdfWorkflow() {
  const [pageSize, setPageSize] = useState<ImagesToPdfOptions["pageSize"]>("a4");
  const [margin, setMargin] = useState(24);

  return (
    <FileWorkflow tool={tool} multiple>
      {({ files, run }) => (
        <div className="space-y-4 pt-2">
          <FieldGrid>
            <Field label="Page size">
              <SelectField
                value={pageSize}
                onChange={(v) => setPageSize(v as ImagesToPdfOptions["pageSize"])}
                options={[
                  { value: "a4", label: "A4" },
                  { value: "letter", label: "US Letter" },
                  { value: "fit", label: "Fit to image size" },
                ]}
              />
            </Field>
            {pageSize !== "fit" && (
              <Field label="Margin">
                <RangeField value={margin} onChange={setMargin} min={0} max={72} suffix="pt" />
              </Field>
            )}
          </FieldGrid>
          <Button
            disabled={files.length === 0}
            onClick={() => run(async (f) => [{ name: "images.pdf", blob: await imagesToPdf(f, { pageSize, margin }) }])}
          >
            Create PDF from {files.length || ""} image{files.length === 1 ? "" : "s"}
          </Button>
        </div>
      )}
    </FileWorkflow>
  );
}
