import type { Metadata } from "next";
import { ToolPage } from "@/components/tool/ToolPage";
import { MergePdfTool } from "@/components/tools/MergePdfTool";
import { getTool } from "@/lib/tools/registry";
import { toolMetadata } from "@/lib/seo";

const tool = getTool("merge-pdf");

export const metadata: Metadata = toolMetadata(tool);

export default function Page() {
  return (
    <ToolPage
      tool={tool}
      lead="Combine contracts, statements and scans into a single PDF, in exactly the order you want."
      steps={["Add two or more PDFs.", "Drag them into order — you'll see page counts and sizes.", "Merge and download one PDF."]}
      notes={[
        { title: "Nothing re-rendered", body: "Pages are copied as they are, so text stays selectable and quality doesn't change." },
        { title: "Need fewer pages?", body: "Merge first, then open the result in Organize PDF to remove or reorder individual pages." },
      ]}
      related={["organize-pdf", "split-pdf", "compress-pdf"]}
    >
      <MergePdfTool />
    </ToolPage>
  );
}
