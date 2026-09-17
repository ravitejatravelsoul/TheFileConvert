"use client";

import { FileWorkflow } from "@/components/tools/FileWorkflow";
import { Button } from "@/components/ui/Button";
import { mergePdfs } from "@/lib/processors/pdf";
import { getToolById } from "@/lib/tools/registry";

const tool = getToolById("pdf-merge")!;

export function MergeWorkflow() {
  return (
    <FileWorkflow tool={tool} zipDownloadName="merged-pdfs.zip">
      {({ files, run }) => (
        <div className="pt-2">
          <p className="mb-3 text-sm text-[var(--foreground-muted)]">
            Files will be merged in the order shown above.{" "}
            {files.length < 2 && "Add at least one more PDF to merge."}
          </p>
          <Button disabled={files.length < 2} onClick={() => run(async (f) => [{ name: "merged.pdf", blob: await mergePdfs(f) }])}>
            Merge {files.length || ""} PDFs
          </Button>
        </div>
      )}
    </FileWorkflow>
  );
}
