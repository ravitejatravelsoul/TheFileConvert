import type { Metadata } from "next";
import { getToolById } from "@/lib/tools/registry";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import { MarkdownToHtmlWorkflow } from "./markdown-to-html-workflow";
import { pageMetadata } from "@/lib/seo";

const tool = getToolById("markdown-to-html")!;

export const metadata: Metadata = pageMetadata({
  title: "Markdown to HTML Converter — Free & Private",
  description: tool.description,
  path: tool.href,
});

export default function Page() {
  return (
    <ToolPageShell tool={tool}>
      <MarkdownToHtmlWorkflow />
    </ToolPageShell>
  );
}
