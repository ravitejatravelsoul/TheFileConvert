import type { Metadata } from "next";
import { getToolById } from "@/lib/tools/registry";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import { ZipWorkflow } from "./zip-workflow";
import { pageMetadata } from "@/lib/seo";

const tool = getToolById("zip-create")!;

export const metadata: Metadata = pageMetadata({
  title: "Create ZIP File Online — Free & Private",
  description: tool.description,
  path: tool.href,
});

export default function Page() {
  return (
    <ToolPageShell tool={tool}>
      <ZipWorkflow />
    </ToolPageShell>
  );
}
