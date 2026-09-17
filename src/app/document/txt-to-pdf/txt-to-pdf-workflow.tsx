"use client";

import { TextToBlobWorkflow } from "@/components/tools/TextToBlobWorkflow";
import { textToPdf } from "@/lib/processors/text-documents";

export function TxtToPdfWorkflow() {
  return (
    <TextToBlobWorkflow
      inputPlaceholder="Paste or type plain text…"
      acceptFileExtension=".txt,text/plain"
      actionLabel="Convert to PDF"
      onProcess={async (input) => ({ name: "document.pdf", blob: await textToPdf(input, { fontSize: 12 }) })}
    />
  );
}
