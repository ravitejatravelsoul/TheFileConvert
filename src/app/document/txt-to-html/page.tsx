import type { Metadata } from "next";
import { getToolById } from "@/lib/tools/registry";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import { TxtToHtmlWorkflow } from "./txt-to-html-workflow";
import { pageMetadata } from "@/lib/seo";

const tool = getToolById("txt-to-html")!;

export const metadata: Metadata = pageMetadata({
  title: "TXT to HTML Converter — Free & Private",
  description: tool.description,
  path: tool.href,
});

export default function Page() {
  return (
    <ToolPageShell tool={tool}>
      <TxtToHtmlWorkflow />
    </ToolPageShell>
  );
}
