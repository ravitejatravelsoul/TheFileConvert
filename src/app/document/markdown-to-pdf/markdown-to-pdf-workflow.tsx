"use client";

import { TextToBlobWorkflow } from "@/components/tools/TextToBlobWorkflow";
import { markdownToPdf } from "@/lib/processors/text-documents";

export function MarkdownToPdfWorkflow() {
  return (
    <TextToBlobWorkflow
      inputPlaceholder={"# Hello\n\nThis is **bold** and this is *italic*."}
      acceptFileExtension=".md,text/markdown"
      actionLabel="Convert to PDF"
      onProcess={async (input) => ({ name: "document.pdf", blob: await markdownToPdf(input) })}
    />
  );
}
