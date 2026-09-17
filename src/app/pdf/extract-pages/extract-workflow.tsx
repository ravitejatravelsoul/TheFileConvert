"use client";

import { useState } from "react";
import { FileWorkflow } from "@/components/tools/FileWorkflow";
import { Field, TextField } from "@/components/tools/fields";
import { Button } from "@/components/ui/Button";
import { extractPages } from "@/lib/processors/pdf";
import { getToolById } from "@/lib/tools/registry";

const tool = getToolById("pdf-extract-pages")!;

export function ExtractWorkflow() {
  const [range, setRange] = useState("1-3");

  return (
    <FileWorkflow tool={tool} multiple={false}>
      {({ run }) => (
        <div className="space-y-4 pt-2">
          <Field label="Pages to extract" hint="e.g. 1-3,5,8-10">
            <TextField value={range} onChange={setRange} placeholder="1-3,5,8-10" />
          </Field>
          <Button onClick={() => run(async (f) => [{ name: "extracted.pdf", blob: await extractPages(f[0], range) }])}>
            Extract pages
          </Button>
        </div>
      )}
    </FileWorkflow>
  );
}
