import type { Metadata } from "next";
import { ToolPage } from "@/components/tool/ToolPage";
import { OrganizePdfTool } from "@/components/tools/OrganizePdfTool";
import { getTool } from "@/lib/tools/registry";
import { toolMetadata } from "@/lib/seo";

const tool = getTool("organize-pdf");

export const metadata: Metadata = toolMetadata(tool);

export default function Page() {
  return (
    <ToolPage
      tool={tool}
      lead="Every page laid out in front of you. Drag to reorder, rotate the sideways ones, duplicate or delete — then save."
      steps={["Add a PDF and see all its pages.", "Drag, rotate, duplicate or delete pages.", "Save a new PDF. Your original isn't changed."]}
      notes={[
        { title: "Nothing is final until you save", body: "Deleted pages stay visible, dimmed, with a Restore button. Reset puts everything back." },
        { title: "Lossless", body: "Pages are copied as they are — rotating or moving them never lowers quality." },
      ]}
      related={["merge-pdf", "split-pdf", "pdf-editor"]}
    >
      <OrganizePdfTool />
    </ToolPage>
  );
}
