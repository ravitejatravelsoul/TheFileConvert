import type { Metadata } from "next";
import { getToolById } from "@/lib/tools/registry";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import { JsonToCsvWorkflow } from "./json-to-csv-workflow";
import { pageMetadata } from "@/lib/seo";

const tool = getToolById("json-to-csv")!;

export const metadata: Metadata = pageMetadata({
  title: "JSON to CSV Converter — Free & Private",
  description: tool.description,
  path: tool.href,
});

export default function Page() {
  return (
    <ToolPageShell tool={tool}>
      <JsonToCsvWorkflow />
    </ToolPageShell>
  );
}
