import type { Metadata } from "next";
import { getToolById } from "@/lib/tools/registry";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import { UrlWorkflow } from "./url-workflow";
import { pageMetadata } from "@/lib/seo";

const tool = getToolById("url-encode-decode")!;

export const metadata: Metadata = pageMetadata({
  title: "URL Encode / Decode — Free Online Tool",
  description: tool.description,
  path: tool.href,
});

export default function Page() {
  return (
    <ToolPageShell tool={tool}>
      <UrlWorkflow />
    </ToolPageShell>
  );
}
