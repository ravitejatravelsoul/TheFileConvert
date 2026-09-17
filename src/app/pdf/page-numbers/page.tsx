import type { Metadata } from "next";
import { getToolById } from "@/lib/tools/registry";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import { PageNumbersWorkflow } from "./page-numbers-workflow";
import { pageMetadata } from "@/lib/seo";

const tool = getToolById("pdf-add-page-numbers")!;

export const metadata: Metadata = pageMetadata({
  title: "Add Page Numbers to PDF — Free & Private",
  description: tool.description,
  path: tool.href,
});

export default function Page() {
  return (
    <ToolPageShell tool={tool}>
      <PageNumbersWorkflow />
    </ToolPageShell>
  );
}
