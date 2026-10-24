import type { Metadata } from "next";
import { ToolPage } from "@/components/tool/ToolPage";
import { PdfToImageTool } from "@/components/tools/PdfToImageTool";
import { getTool } from "@/lib/tools/registry";
import { toolMetadata } from "@/lib/seo";

const tool = getTool("pdf-to-image");

export const metadata: Metadata = toolMetadata(tool);

export default function Page() {
  return (
    <ToolPage
      tool={tool}
      lead="See every page, keep the ones you want, and save them as crisp JPG or PNG images."
      steps={["Add a PDF — every page appears as a thumbnail.", "Choose JPG or PNG and untick any pages you don't need.", "Download one image, or every page in a ZIP."]}
      notes={[
        { title: "Sharp output", body: "Pages are rendered at twice their PDF size — about 144 DPI — so text stays crisp." },
        { title: "JPG or PNG?", body: "JPG makes smaller files for scans and photos. PNG is lossless and best for text-heavy pages and diagrams." },
      ]}
      related={["image-to-pdf", "compress-image", "split-pdf"]}
    >
      <PdfToImageTool />
    </ToolPage>
  );
}
