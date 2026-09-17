import type { Metadata } from "next";
import { getToolById } from "@/lib/tools/registry";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import { CaseConverterWorkflow } from "./case-converter-workflow";
import { pageMetadata } from "@/lib/seo";

const tool = getToolById("text-case-converter")!;

export const metadata: Metadata = pageMetadata({
  title: "Text Case Converter — Free Online Tool",
  description: tool.description,
  path: tool.href,
});

export default function Page() {
  return (
    <ToolPageShell tool={tool}>
      <CaseConverterWorkflow />
    </ToolPageShell>
  );
}
