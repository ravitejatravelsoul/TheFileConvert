import type { Metadata } from "next";
import { getToolById } from "@/lib/tools/registry";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import { OcrWorkflow } from "./ocr-workflow";
import { pageMetadata } from "@/lib/seo";

const tool = getToolById("pdf-ocr")!;

export const metadata: Metadata = pageMetadata({
  title: "OCR PDF — Make Scanned PDFs Searchable, Free",
  description: tool.description,
  path: tool.href,
});

export default function Page() {
  return (
    <ToolPageShell
      tool={tool}
      howItWorks={[
        "Upload a scanned or image-only PDF — nothing is sent to a server.",
        "We check which pages already have text and flag the ones that don't.",
        "Choose a language and recognize the scanned pages you want.",
        "Download a searchable PDF, or extract the recognized text.",
      ]}
      whyUse={[
        "Runs entirely in your browser using Tesseract.js, an open-source OCR engine.",
        "Makes old scans and photographed documents searchable and copyable.",
        "Skips pages that already have real text, so you only wait for what actually needs OCR.",
      ]}
    >
      <OcrWorkflow />
    </ToolPageShell>
  );
}
