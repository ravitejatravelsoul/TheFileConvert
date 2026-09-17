import type { Metadata } from "next";
import { getToolById } from "@/lib/tools/registry";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import { ToImagesWorkflow } from "./to-images-workflow";
import { pageMetadata } from "@/lib/seo";

const tool = getToolById("pdf-to-images")!;

export const metadata: Metadata = pageMetadata({
  title: "PDF to JPG/PNG Converter — Free & Private",
  description: tool.description,
  path: tool.href,
});

export default function Page() {
  return (
    <ToolPageShell tool={tool}>
      <ToImagesWorkflow />
    </ToolPageShell>
  );
}
