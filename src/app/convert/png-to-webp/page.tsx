import type { Metadata } from "next";
import { getToolById } from "@/lib/tools/registry";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import { ImageConvertWorkflow } from "@/components/tools/ImageConvertWorkflow";
import { pageMetadata } from "@/lib/seo";

const tool = getToolById("png-to-webp")!;

export const metadata: Metadata = pageMetadata({
  title: "PNG to WebP Converter — Free & Private",
  description: tool.description,
  path: tool.href,
});

export default function Page() {
  return (
    <ToolPageShell tool={tool}>
      <ImageConvertWorkflow tool={tool} targetFormat="webp" />
    </ToolPageShell>
  );
}
