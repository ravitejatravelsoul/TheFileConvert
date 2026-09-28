import type { Metadata } from "next";
import { ToolPage } from "@/components/tool/ToolPage";
import { PdfToWordTool } from "@/components/tools/PdfToWordTool";
import { getTool } from "@/lib/tools/registry";
import { toolMetadata } from "@/lib/seo";

const tool = getTool("pdf-to-word");

export const metadata: Metadata = toolMetadata(tool);

export default function Page() {
  return (
    <ToolPage
      tool={tool}
      lead="Convert your PDF into an editable Word document."
      steps={["Add a PDF — we check whether its pages are text, scans or both.", "Press Convert to Word. Scanned pages are read with OCR on your device.", "Download the .docx and open it in Word, Google Docs, Pages or LibreOffice."]}
      notes={[
        { title: "What comes across", body: "Text in reading order, headings, paragraphs, bold and italic, bulleted and numbered lists, simple tables and pictures. Each PDF page starts a new Word page with the same size." },
        { title: "What may need a touch-up", body: "Unusual fonts, exact positions, text wrapped around pictures and complex tables. The goal is a document you can edit, not a pixel copy." },
        { title: "Scanned pages", body: "They're recognised with OCR on this device. Check names, dates and amounts against the original — poor scans can be misread." },
        { title: "Two columns", body: "Newsletter-style columns are read column by column, so sentences stay in order." },
      ]}
      related={["pdf-editor", "compress-pdf", "pdf-to-image"]}
    >
      <PdfToWordTool />
    </ToolPage>
  );
}
