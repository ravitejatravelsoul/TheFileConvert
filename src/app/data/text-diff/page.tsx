import type { Metadata } from "next";
import { getToolById } from "@/lib/tools/registry";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import { TextDiffWorkflow } from "./text-diff-workflow";
import { pageMetadata } from "@/lib/seo";

const tool = getToolById("text-diff")!;

export const metadata: Metadata = pageMetadata({
  title: "Text Compare / Diff Checker — Free Online Tool",
  description: tool.description,
  path: tool.href,
});

export default function Page() {
  return (
    <ToolPageShell tool={tool}>
      <TextDiffWorkflow />
    </ToolPageShell>
  );
}
