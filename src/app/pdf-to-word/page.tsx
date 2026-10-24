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
      lead="Convert PDFs to Word while preserving the document’s appearance."
      steps={["Add a PDF — we check, page by page, whether it is text or a picture of paper.", "Press Convert to Word. Text pages are rebuilt as editable Word content; scanned pages keep their look.", "Download the .docx and open it in Word, Google Docs, Pages or LibreOffice."]}
      notes={[
        { title: "Native PDFs become editable", body: "Text in reading order, headings, paragraphs, bold and italic, lists, tables, pictures and columns come across as real Word content, on pages of the same size." },
        { title: "Scans keep their look", body: "A scanned form, passport, certificate, invoice, statement or signed page goes into Word as the page itself — borders, handwriting, stamps, signatures, photos and check boxes exactly as scanned. It isn't retyped, so it isn't editable text." },
        { title: "Want the words of a scan?", body: "Use Recognize text in the PDF Editor: it makes a scan searchable and its words correctable without changing how the page looks." },
        { title: "What may need a touch-up", body: "Unusual fonts, exact positions and complex tables in text PDFs. The goal is a faithful, editable document, not a pixel copy." },
      ]}
      related={["word-to-pdf", "pdf-editor", "compress-pdf"]}
    >
      <PdfToWordTool />
    </ToolPage>
  );
}
