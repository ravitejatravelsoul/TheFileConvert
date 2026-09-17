import type { Metadata } from "next";
import { getToolById } from "@/lib/tools/registry";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import { RotateWorkflow } from "./rotate-workflow";
import { pageMetadata } from "@/lib/seo";

const tool = getToolById("pdf-rotate")!;

export const metadata: Metadata = pageMetadata({
  title: "Rotate PDF Pages — Free & Private",
  description: tool.description,
  path: tool.href,
});

export default function Page() {
  return (
    <ToolPageShell tool={tool}>
      <RotateWorkflow />
    </ToolPageShell>
  );
}
