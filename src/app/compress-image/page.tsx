import type { Metadata } from "next";
import { ToolPage } from "@/components/tool/ToolPage";
import { CompressImageTool } from "@/components/tools/CompressImageTool";
import { getTool } from "@/lib/tools/registry";
import { toolMetadata } from "@/lib/seo";

const tool = getTool("compress-image");

export const metadata: Metadata = toolMetadata(tool);

export default function Page() {
  return (
    <ToolPage
      tool={tool}
      lead="Choose the size you need and get the sharpest image that fits under it. No sliders, no guessing."
      steps={[
        "Add a JPG, PNG or WebP image.",
        "Pick 100 KB, 250 KB, 500 KB, 1 MB — or type your own limit.",
        "Download the result with its exact size, dimensions and format.",
      ]}
      notes={[
        {
          title: "Quality before size",
          body: "Every quality step is tried at full resolution first. The image is only scaled down when quality alone can't reach your target.",
        },
        {
          title: "Transparency is kept",
          body: "Transparent PNGs become WebP, which keeps the transparent areas while getting much smaller. JPG can't store transparency, so it is never used for them.",
        },
        {
          title: "Photos stay JPG",
          body: "A JPG stays a JPG, so it opens everywhere a JPG did.",
        },
        {
          title: "Metadata removed",
          body: "Re-encoded images don't carry the original's hidden details such as camera model or GPS location.",
        },
      ]}
      related={["convert-image", "image-to-pdf", "compress-pdf"]}
    >
      <CompressImageTool />
    </ToolPage>
  );
}
