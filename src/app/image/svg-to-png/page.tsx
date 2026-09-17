import type { Metadata } from "next";
import { getToolById } from "@/lib/tools/registry";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import { SvgToPngWorkflow } from "./svg-to-png-workflow";
import { pageMetadata } from "@/lib/seo";

const tool = getToolById("svg-to-png")!;

export const metadata: Metadata = pageMetadata({
  title: "SVG to PNG Converter — Free & Private",
  description: tool.description,
  path: tool.href,
});

export default function Page() {
  return (
    <ToolPageShell tool={tool}>
      <SvgToPngWorkflow />
    </ToolPageShell>
  );
}
