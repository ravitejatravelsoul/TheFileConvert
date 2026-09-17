import type { Metadata } from "next";
import { getToolById } from "@/lib/tools/registry";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import { MetadataWorkflow } from "./metadata-workflow";
import { pageMetadata } from "@/lib/seo";

const tool = getToolById("pdf-metadata")!;

export const metadata: Metadata = pageMetadata({
  title: "PDF Metadata Viewer & Remover — Free & Private",
  description: tool.description,
  path: tool.href,
});

export default function Page() {
  return (
    <ToolPageShell tool={tool}>
      <MetadataWorkflow />
    </ToolPageShell>
  );
}
