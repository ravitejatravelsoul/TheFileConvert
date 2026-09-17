import type { Metadata } from "next";
import { getToolById } from "@/lib/tools/registry";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import { ExtractWorkflow } from "./extract-workflow";
import { pageMetadata } from "@/lib/seo";

const tool = getToolById("pdf-extract-pages")!;

export const metadata: Metadata = pageMetadata({
  title: "Extract PDF Pages — Free & Private",
  description: tool.description,
  path: tool.href,
});

export default function Page() {
  return (
    <ToolPageShell tool={tool}>
      <ExtractWorkflow />
    </ToolPageShell>
  );
}
