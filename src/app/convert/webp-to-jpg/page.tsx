import type { Metadata } from "next";
import { getToolById } from "@/lib/tools/registry";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import { ImageConvertWorkflow } from "@/components/tools/ImageConvertWorkflow";
import { pageMetadata } from "@/lib/seo";

const tool = getToolById("webp-to-jpg")!;

export const metadata: Metadata = pageMetadata({
  title: "WebP to JPG Converter — Free & Private",
  description: tool.description,
  path: tool.href,
});

export default function Page() {
  return (
    <ToolPageShell tool={tool}>
      <ImageConvertWorkflow tool={tool} targetFormat="jpeg" />
    </ToolPageShell>
  );
}
