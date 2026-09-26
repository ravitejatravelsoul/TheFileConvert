import type { Metadata } from "next";
import { ToolPage } from "@/components/tool/ToolPage";
import { ConvertImageTool } from "@/components/tools/ConvertImageTool";
import { getTool } from "@/lib/tools/registry";
import { toolMetadata } from "@/lib/seo";

const tool = getTool("convert-image");

export const metadata: Metadata = toolMetadata(tool);

export default function Page() {
  return (
    <ToolPage
      tool={tool}
      lead="Add images, pick the format you need, download. JPG, PNG, WebP and SVG — no settings to fiddle with."
      steps={["Add one image or a whole batch.", "Choose JPG, PNG or WebP.", "Download each file, or all of them as a ZIP."]}
      notes={[
        { title: "SVG to PNG", body: "Small SVG icons are rendered at 1024 px on the long side so the PNG is sharp, keeping the original proportions." },
        { title: "Transparency", body: "PNG and WebP keep transparent areas. JPG can't, so they become white." },
        { title: "Quality", body: "JPG and WebP are saved at 92% quality — visually the same as the original for photos." },
        { title: "Safari and WebP", body: "Some browsers can open WebP but not create it. If yours can't, you'll be told instead of getting a mislabelled file." },
      ]}
      related={["compress-image", "image-to-pdf", "pdf-to-image"]}
    >
      <ConvertImageTool />
    </ToolPage>
  );
}
