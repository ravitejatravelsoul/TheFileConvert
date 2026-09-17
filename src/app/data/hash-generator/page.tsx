import type { Metadata } from "next";
import { getToolById } from "@/lib/tools/registry";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import { HashGeneratorWorkflow } from "./hash-generator-workflow";
import { pageMetadata } from "@/lib/seo";

const tool = getToolById("hash-generator")!;

export const metadata: Metadata = pageMetadata({
  title: "SHA-256 Hash Generator — Free Online Tool",
  description: tool.description,
  path: tool.href,
});

export default function Page() {
  return (
    <ToolPageShell tool={tool}>
      <HashGeneratorWorkflow />
    </ToolPageShell>
  );
}
