import type { Metadata } from "next";
import { getToolById } from "@/lib/tools/registry";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import { MarkdownToPdfWorkflow } from "./markdown-to-pdf-workflow";
import { pageMetadata } from "@/lib/seo";

const tool = getToolById("markdown-to-pdf")!;

export const metadata: Metadata = pageMetadata({
  title: "Markdown to PDF Converter — Free & Private",
  description: tool.description,
  path: tool.href,
});

export default function Page() {
  return (
    <ToolPageShell tool={tool}>
      <MarkdownToPdfWorkflow />
    </ToolPageShell>
  );
}
