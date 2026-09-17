import type { Metadata } from "next";
import { getToolById } from "@/lib/tools/registry";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import { XmlFormatterWorkflow } from "./xml-formatter-workflow";
import { pageMetadata } from "@/lib/seo";

const tool = getToolById("xml-formatter")!;

export const metadata: Metadata = pageMetadata({
  title: "XML Formatter & Minifier — Free",
  description: tool.description,
  path: tool.href,
});

export default function Page() {
  return (
    <ToolPageShell tool={tool}>
      <XmlFormatterWorkflow />
    </ToolPageShell>
  );
}
