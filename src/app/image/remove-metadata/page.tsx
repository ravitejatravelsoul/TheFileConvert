import type { Metadata } from "next";
import { getToolById } from "@/lib/tools/registry";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import { RemoveMetadataWorkflow } from "./remove-metadata-workflow";
import { pageMetadata } from "@/lib/seo";

const tool = getToolById("image-metadata-remove")!;

export const metadata: Metadata = pageMetadata({
  title: "Remove EXIF & Photo Metadata Online Free",
  description: tool.description,
  path: tool.href,
});

export default function Page() {
  return (
    <ToolPageShell tool={tool}>
      <RemoveMetadataWorkflow />
    </ToolPageShell>
  );
}
