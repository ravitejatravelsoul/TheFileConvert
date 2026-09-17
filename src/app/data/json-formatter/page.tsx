import type { Metadata } from "next";
import { getToolById } from "@/lib/tools/registry";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import { JsonFormatterWorkflow } from "./json-formatter-workflow";
import { pageMetadata } from "@/lib/seo";

const tool = getToolById("json-formatter")!;

export const metadata: Metadata = pageMetadata({
  title: "JSON Formatter, Validator & Minifier — Free",
  description: tool.description,
  path: tool.href,
});

export default function Page() {
  return (
    <ToolPageShell
      tool={tool}
      howItWorks={[
        "Paste your JSON, or upload a .json file.",
        "Choose pretty-print or minify.",
        "Your formatted result appears instantly.",
        "Copy it or download it as a file.",
      ]}
    >
      <JsonFormatterWorkflow />
    </ToolPageShell>
  );
}
