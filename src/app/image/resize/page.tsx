import type { Metadata } from "next";
import { getToolById } from "@/lib/tools/registry";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import { ResizeWorkflow } from "./resize-workflow";
import { pageMetadata } from "@/lib/seo";

const tool = getToolById("image-resize")!;

export const metadata: Metadata = pageMetadata({
  title: "Resize Image Online Free — Change Image Dimensions",
  description: tool.description,
  path: tool.href,
});

export default function Page() {
  return (
    <ToolPageShell tool={tool}>
      <ResizeWorkflow />
    </ToolPageShell>
  );
}
