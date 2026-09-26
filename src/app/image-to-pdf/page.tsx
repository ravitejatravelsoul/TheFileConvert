import type { Metadata } from "next";
import { ToolPage } from "@/components/tool/ToolPage";
import { ImagesToPdfTool } from "@/components/tools/ImagesToPdfTool";
import { getTool } from "@/lib/tools/registry";
import { toolMetadata } from "@/lib/seo";

const tool = getTool("image-to-pdf");

export const metadata: Metadata = toolMetadata(tool);

export default function Page() {
  return (
    <ToolPage
      tool={tool}
      lead="Turn photos, receipts and scans into one tidy PDF. Drag to set the order — each page sizes itself to its image."
      steps={["Add your images — JPG, PNG or WebP.", "Drag them into order and pick a page size.", "Download a single PDF."]}
      notes={[
        { title: "No quality loss", body: "JPG and PNG images go into the PDF exactly as they are. Only WebP images are converted, because PDF can't hold WebP." },
        { title: "Upright photos", body: "Phone photos stored sideways are turned the right way up, just as they appear in your gallery." },
        { title: "Automatic sizing", body: "With “Fit to image”, every page matches its picture. On A4 or Letter, wide images get a landscape page." },
      ]}
      related={["compress-pdf", "merge-pdf", "pdf-to-image"]}
    >
      <ImagesToPdfTool />
    </ToolPage>
  );
}
