import type { Metadata } from "next";
import { getToolById } from "@/lib/tools/registry";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import { Base64Workflow } from "./base64-workflow";
import { pageMetadata } from "@/lib/seo";

const tool = getToolById("base64-encode-decode")!;

export const metadata: Metadata = pageMetadata({
  title: "Base64 Encode / Decode — Free Online Tool",
  description: tool.description,
  path: tool.href,
});

export default function Page() {
  return (
    <ToolPageShell tool={tool}>
      <Base64Workflow />
    </ToolPageShell>
  );
}
