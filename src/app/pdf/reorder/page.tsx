import type { Metadata } from "next";
import { getToolById } from "@/lib/tools/registry";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import { ReorderWorkflow } from "./reorder-workflow";
import { pageMetadata } from "@/lib/seo";

const tool = getToolById("pdf-reorder")!;

export const metadata: Metadata = pageMetadata({
  title: "Reorder PDF Pages — Free & Private",
  description: tool.description,
  path: tool.href,
});

export default function Page() {
  return (
    <ToolPageShell tool={tool}>
      <ReorderWorkflow />
    </ToolPageShell>
  );
}
