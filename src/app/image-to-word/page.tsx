import type { Metadata } from "next";
import { ToolPage } from "@/components/tool/ToolPage";
import { ImagesToWordTool } from "@/components/tools/ImagesToWordTool";
import { getTool } from "@/lib/tools/registry";
import { toolMetadata } from "@/lib/seo";

const tool = getTool("image-to-word");

export const metadata: Metadata = toolMetadata(tool);

export default function Page() {
  return (
    <ToolPage
      tool={tool}
      lead="Put a photo, a scan or a screenshot into a Word document, looking exactly as it does now — one image per page."
      steps={["Add your images — JPG, PNG or WebP.", "Drag them into order and pick a page size.", "Download a .docx with one image per page."]}
      notes={[
        { title: "The image stays the image", body: "A filled-in form, an ID, a receipt or a signed page goes into Word as the picture it is, so it looks just like the original. Nothing is retyped or recognised." },
        { title: "Want the text?", body: "This tool doesn't read text. To make a scan searchable or editable, use Recognize text in the PDF Editor." },
        { title: "No quality loss", body: "JPG and PNG images are embedded as they are. Sideways phone photos are turned upright; WebP is saved as JPG or PNG, which Word can hold." },
        { title: "Page sizes", body: "“Fit to image” makes each page the shape of its picture, up to Letter size — nothing cropped, stretched or padded. Or choose A4 or Letter with a margin." },
      ]}
      related={["word-to-pdf", "image-to-pdf", "compress-image"]}
    >
      <ImagesToWordTool />
    </ToolPage>
  );
}
