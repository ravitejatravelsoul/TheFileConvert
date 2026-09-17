"use client";

import { useState } from "react";
import { FileWorkflow } from "@/components/tools/FileWorkflow";
import { Field, NumberField } from "@/components/tools/fields";
import { Button } from "@/components/ui/Button";
import { splitPdfEveryNPages } from "@/lib/processors/pdf";
import { getToolById } from "@/lib/tools/registry";

const tool = getToolById("pdf-split")!;

export function SplitWorkflow() {
  const [pagesPerFile, setPagesPerFile] = useState(1);

  return (
    <FileWorkflow tool={tool} multiple={false} zipDownloadName="split-pages.zip">
      {({ run }) => (
        <div className="space-y-4 pt-2">
          <Field label="Pages per file" hint="Each output PDF will contain this many pages.">
            <NumberField value={pagesPerFile} onChange={setPagesPerFile} min={1} max={999} />
          </Field>
          <Button onClick={() => run((f) => splitPdfEveryNPages(f[0], pagesPerFile))}>Split PDF</Button>
        </div>
      )}
    </FileWorkflow>
  );
}
