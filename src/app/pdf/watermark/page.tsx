import type { Metadata } from "next";
import { getToolById } from "@/lib/tools/registry";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import { WatermarkWorkflow } from "./watermark-workflow";
import { pageMetadata } from "@/lib/seo";

const tool = getToolById("pdf-watermark")!;

export const metadata: Metadata = pageMetadata({
  title: "Add Watermark to PDF — Free & Private",
  description: tool.description,
  path: tool.href,
});

export default function Page() {
  return (
    <ToolPageShell tool={tool}>
      <WatermarkWorkflow />
    </ToolPageShell>
  );
}
