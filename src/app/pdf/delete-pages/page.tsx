import type { Metadata } from "next";
import { getToolById } from "@/lib/tools/registry";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import { DeleteWorkflow } from "./delete-workflow";
import { pageMetadata } from "@/lib/seo";

const tool = getToolById("pdf-delete-pages")!;

export const metadata: Metadata = pageMetadata({
  title: "Delete PDF Pages — Free & Private",
  description: tool.description,
  path: tool.href,
});

export default function Page() {
  return (
    <ToolPageShell tool={tool}>
      <DeleteWorkflow />
    </ToolPageShell>
  );
}
