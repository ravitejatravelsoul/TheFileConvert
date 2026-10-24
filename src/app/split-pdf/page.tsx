import type { Metadata } from "next";
import { ToolPage } from "@/components/tool/ToolPage";
import { SplitPdfTool } from "@/components/tools/SplitPdfTool";
import { getTool } from "@/lib/tools/registry";
import { toolMetadata } from "@/lib/seo";

const tool = getTool("split-pdf");

export const metadata: Metadata = toolMetadata(tool);

export default function Page() {
  return (
    <ToolPage
      tool={tool}
      lead="Click the pages you need and save them as a new PDF — or break the whole document into single pages."
      steps={["Add a PDF and see every page.", "Click the pages to keep, or choose “Split every page”.", "Download the new PDF, or a ZIP of pages."]}
      notes={[
        { title: "Your original stays whole", body: "Splitting creates new files. The PDF you added isn't changed." },
        { title: "Quick selection", body: "Shift-click selects every page between two clicks. You can also type a list such as 1-3, 7." },
      ]}
      related={["merge-pdf", "organize-pdf", "pdf-to-image"]}
    >
      <SplitPdfTool />
    </ToolPage>
  );
}
