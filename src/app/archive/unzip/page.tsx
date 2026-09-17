import type { Metadata } from "next";
import { getToolById } from "@/lib/tools/registry";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import { UnzipWorkflow } from "./unzip-workflow";
import { pageMetadata } from "@/lib/seo";

const tool = getToolById("zip-extract")!;

export const metadata: Metadata = pageMetadata({
  title: "Extract ZIP File Online — Free & Private",
  description: tool.description,
  path: tool.href,
});

export default function Page() {
  return (
    <ToolPageShell tool={tool}>
      <UnzipWorkflow />
    </ToolPageShell>
  );
}
