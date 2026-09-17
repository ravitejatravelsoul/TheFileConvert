"use client";

import { FileWorkflow } from "@/components/tools/FileWorkflow";
import { Button } from "@/components/ui/Button";
import { compressPdf } from "@/lib/processors/pdf";
import { getToolById } from "@/lib/tools/registry";
import { safeOutputName } from "@/lib/format";

const tool = getToolById("pdf-compress")!;

export function CompressWorkflow() {
  return (
    <FileWorkflow tool={tool} multiple={false}>
      {({ files, run }) => (
        <div className="pt-2">
          <Button
            onClick={() =>
              run(async (f) => [{ name: safeOutputName(f[0].name, "compressed", "pdf"), blob: await compressPdf(f[0]) }])
            }
          >
            Compress {files[0]?.name ?? "PDF"}
          </Button>
        </div>
      )}
    </FileWorkflow>
  );
}
