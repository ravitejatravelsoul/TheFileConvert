import type { Metadata } from "next";
import { getToolById } from "@/lib/tools/registry";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import { SplitWorkflow } from "./split-workflow";
import { pageMetadata } from "@/lib/seo";

const tool = getToolById("pdf-split")!;

export const metadata: Metadata = pageMetadata({
  title: "Split PDF Online — Free & Private",
  description: tool.description,
  path: tool.href,
});

export default function Page() {
  return (
    <ToolPageShell
      tool={tool}
      whyUse={[
        "Break a long PDF into manageable chunks by page count.",
        "Get every part back at once in a single ZIP download.",
      ]}
    >
      <SplitWorkflow />
    </ToolPageShell>
  );
}
