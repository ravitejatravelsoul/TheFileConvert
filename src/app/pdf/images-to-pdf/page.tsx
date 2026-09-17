import type { Metadata } from "next";
import { getToolById } from "@/lib/tools/registry";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import { ImagesToPdfWorkflow } from "./images-to-pdf-workflow";
import { pageMetadata } from "@/lib/seo";

const tool = getToolById("images-to-pdf")!;

export const metadata: Metadata = pageMetadata({
  title: "Images to PDF — JPG & PNG to PDF, Free",
  description: tool.description,
  path: tool.href,
});

export default function Page() {
  return (
    <ToolPageShell tool={tool}>
      <ImagesToPdfWorkflow />
    </ToolPageShell>
  );
}
