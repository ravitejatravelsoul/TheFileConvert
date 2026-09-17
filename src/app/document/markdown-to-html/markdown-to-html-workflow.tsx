"use client";

import { TextWorkflow } from "@/components/tools/TextWorkflow";
import { markdownToHtmlDocument } from "@/lib/processors/markdown";

export function MarkdownToHtmlWorkflow() {
  return (
    <TextWorkflow
      inputLabel="Markdown"
      outputLabel="HTML output"
      inputPlaceholder={"# Hello\n\nThis is **bold** and this is *italic*."}
      acceptFileExtension=".md,text/markdown"
      actionLabel="Convert to HTML"
      onProcess={(input) => markdownToHtmlDocument(input, "Converted Document")}
      downloadName="document.html"
      downloadMime="text/html"
    />
  );
}
