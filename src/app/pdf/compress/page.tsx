import type { Metadata } from "next";
import { getToolById } from "@/lib/tools/registry";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import { CompressWorkflow } from "./compress-workflow";
import { pageMetadata } from "@/lib/seo";

const tool = getToolById("pdf-compress")!;

export const metadata: Metadata = pageMetadata({
  title: "Compress PDF Online Free — Reduce PDF Size",
  description: tool.description,
  path: tool.href,
});

export default function Page() {
  return (
    <ToolPageShell tool={tool}>
      <CompressWorkflow />
    </ToolPageShell>
  );
}
