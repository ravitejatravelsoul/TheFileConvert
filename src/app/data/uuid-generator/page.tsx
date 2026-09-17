import type { Metadata } from "next";
import { getToolById } from "@/lib/tools/registry";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import { UuidGeneratorWorkflow } from "./uuid-generator-workflow";
import { pageMetadata } from "@/lib/seo";

const tool = getToolById("uuid-generator")!;

export const metadata: Metadata = pageMetadata({
  title: "UUID Generator — Free Online Tool",
  description: tool.description,
  path: tool.href,
});

export default function Page() {
  return (
    <ToolPageShell tool={tool}>
      <UuidGeneratorWorkflow />
    </ToolPageShell>
  );
}
