import type { Metadata } from "next";
import { ToolPage } from "@/components/tool/ToolPage";
import { CompressPdfTool } from "@/components/tools/CompressPdfTool";
import { getTool } from "@/lib/tools/registry";
import { toolMetadata } from "@/lib/seo";

const tool = getTool("compress-pdf");

export const metadata: Metadata = toolMetadata(tool);

export default function Page() {
  return (
    <ToolPage
      tool={tool}
      lead="Tell us the size you need — for an upload form, an email, a portal — and get a PDF under it, at the best quality that fits."
      steps={[
        "Add your PDF. We look inside to see how much room there is to shrink.",
        "Pick a target: 500 KB, 1 MB, 2 MB, 5 MB or your own number.",
        "Download the result. If the target can't be reached safely, you see the closest size instead.",
      ]}
      notes={[
        {
          title: "Lossless first",
          body: "The first attempt removes waste without touching quality. Image quality is only lowered if that isn't enough — one step at a time.",
        },
        {
          title: "Honest results",
          body: "The exact byte count is always shown. If your target can't be met without wrecking readability, we say so instead of pretending.",
        },
        {
          title: "What shrinks",
          body: "Scans and photos shrink the most. Text-only PDFs are already compact, so expect small savings there.",
        },
        {
          title: "Sizes are decimal",
          body: "1 MB here means 1,000,000 bytes, so the result also fits upload forms that count 1 MB as 1,048,576 bytes.",
        },
      ]}
      related={["pdf-editor", "merge-pdf", "compress-image"]}
    >
      <CompressPdfTool />
    </ToolPage>
  );
}
