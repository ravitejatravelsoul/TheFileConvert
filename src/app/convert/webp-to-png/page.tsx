import type { Metadata } from "next";
import { getToolById } from "@/lib/tools/registry";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import { ImageConvertWorkflow } from "@/components/tools/ImageConvertWorkflow";
import { pageMetadata } from "@/lib/seo";

const tool = getToolById("webp-to-png")!;

export const metadata: Metadata = pageMetadata({
  title: "WebP to PNG Converter — Free & Private",
  description: tool.description,
  path: tool.href,
});

export default function Page() {
  return (
    <ToolPageShell tool={tool}>
      <ImageConvertWorkflow tool={tool} targetFormat="png" />
    </ToolPageShell>
  );
}
