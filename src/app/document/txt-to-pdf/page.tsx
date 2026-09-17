import type { Metadata } from "next";
import { getToolById } from "@/lib/tools/registry";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import { TxtToPdfWorkflow } from "./txt-to-pdf-workflow";
import { pageMetadata } from "@/lib/seo";

const tool = getToolById("txt-to-pdf")!;

export const metadata: Metadata = pageMetadata({
  title: "TXT to PDF Converter — Free & Private",
  description: tool.description,
  path: tool.href,
});

export default function Page() {
  return (
    <ToolPageShell tool={tool}>
      <TxtToPdfWorkflow />
    </ToolPageShell>
  );
}
