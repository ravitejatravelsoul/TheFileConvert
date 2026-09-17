"use client";

import { useState } from "react";
import { FileWorkflow } from "@/components/tools/FileWorkflow";
import { Field, TextField } from "@/components/tools/fields";
import { Button } from "@/components/ui/Button";
import { deletePages } from "@/lib/processors/pdf";
import { getToolById } from "@/lib/tools/registry";

const tool = getToolById("pdf-delete-pages")!;

export function DeleteWorkflow() {
  const [range, setRange] = useState("");

  return (
    <FileWorkflow tool={tool} multiple={false}>
      {({ run }) => (
        <div className="space-y-4 pt-2">
          <Field label="Pages to delete" hint="e.g. 2,4-6">
            <TextField value={range} onChange={setRange} placeholder="2,4-6" />
          </Field>
          <Button disabled={!range.trim()} onClick={() => run(async (f) => [{ name: "edited.pdf", blob: await deletePages(f[0], range) }])}>
            Delete pages
          </Button>
        </div>
      )}
    </FileWorkflow>
  );
}
