"use client";

import { FileWorkflow } from "@/components/tools/FileWorkflow";
import { Button } from "@/components/ui/Button";
import { createZip } from "@/lib/processors/archive";
import { getToolById } from "@/lib/tools/registry";

const tool = getToolById("zip-create")!;

export function ZipWorkflow() {
  return (
    <FileWorkflow tool={tool} multiple>
      {({ files, run }) => (
        <div className="pt-2">
          <Button
            disabled={files.length === 0}
            onClick={() => run(async (f) => [{ name: "archive.zip", blob: await createZip(f) }])}
          >
            Create ZIP from {files.length || ""} file{files.length === 1 ? "" : "s"}
          </Button>
        </div>
      )}
    </FileWorkflow>
  );
}
