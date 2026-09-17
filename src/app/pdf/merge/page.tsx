import type { Metadata } from "next";
import { getToolById } from "@/lib/tools/registry";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import { MergeWorkflow } from "./merge-workflow";
import { pageMetadata } from "@/lib/seo";

const tool = getToolById("pdf-merge")!;

export const metadata: Metadata = pageMetadata({
  title: "Merge PDF Files Online — Free & Private",
  description: tool.description,
  path: tool.href,
});

export default function Page() {
  return (
    <ToolPageShell
      tool={tool}
      whyUse={[
        "Combine reports, scans, or chapters into one PDF in seconds.",
        "Runs fully in your browser — your documents are never uploaded.",
        "No file limits imposed by a subscription tier.",
      ]}
    >
      <MergeWorkflow />
    </ToolPageShell>
  );
}
