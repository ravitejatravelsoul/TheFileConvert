"use client";

import { TextWorkflow } from "@/components/tools/TextWorkflow";
import { textToHtml } from "@/lib/processors/text-documents";

export function TxtToHtmlWorkflow() {
  return (
    <TextWorkflow
      inputLabel="Plain text"
      outputLabel="HTML output"
      inputPlaceholder="Paste or type plain text…"
      acceptFileExtension=".txt,text/plain"
      actionLabel="Convert to HTML"
      onProcess={(input) => textToHtml(input, "Converted Document")}
      downloadName="document.html"
      downloadMime="text/html"
    />
  );
}
