import type { Metadata } from "next";
import { ToolPage } from "@/components/tool/ToolPage";
import { WordToPdfTool } from "@/components/tools/WordToPdfTool";
import { getTool } from "@/lib/tools/registry";
import { toolMetadata } from "@/lib/seo";

const tool = getTool("word-to-pdf");

export const metadata: Metadata = toolMetadata(tool);

export default function Page() {
  return (
    <ToolPage
      tool={tool}
      lead="Turn a Word document into a PDF that looks the same on every device."
      steps={["Add a Word document (.docx).", "Press Convert to PDF — the document is laid out and drawn in this tab.", "Download the PDF, or send it straight on to compress, edit or merge."]}
      notes={[
        { title: "What comes across", body: "Headings, paragraphs, bold, italic and underline, colours, bulleted and numbered lists, tables, pictures, page breaks, margins, headers and footers with page numbers, links and footnotes." },
        { title: "Fonts", body: "Calibri, Arial, Times New Roman and Courier New are drawn with open fonts of exactly the same width, so lines and pages break where Word breaks them. Other fonts use the closest match." },
        { title: "What may differ", body: "Text wrapped around pictures, text boxes, equations and unusual fonts. Complex Word layouts may vary slightly from Microsoft Word." },
        { title: "Old .doc files", body: "Only .docx is supported. Open a .doc in Word, Google Docs or LibreOffice and save it as .docx first." },
      ]}
      related={["compress-pdf", "pdf-to-word", "merge-pdf"]}
    >
      <WordToPdfTool />
    </ToolPage>
  );
}
