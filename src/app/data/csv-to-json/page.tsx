import type { Metadata } from "next";
import { getToolById } from "@/lib/tools/registry";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import { CsvToJsonWorkflow } from "./csv-to-json-workflow";
import { pageMetadata } from "@/lib/seo";

const tool = getToolById("csv-to-json")!;

export const metadata: Metadata = pageMetadata({
  title: "CSV to JSON Converter — Free & Private",
  description: tool.description,
  path: tool.href,
});

export default function Page() {
  return (
    <ToolPageShell tool={tool}>
      <CsvToJsonWorkflow />
    </ToolPageShell>
  );
}
