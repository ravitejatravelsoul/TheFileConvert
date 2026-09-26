import type { Metadata } from "next";
import { ToolPage } from "@/components/tool/ToolPage";
import { EditorLauncher } from "@/components/editor/EditorLauncher";
import { getTool } from "@/lib/tools/registry";
import { toolMetadata } from "@/lib/seo";

const tool = getTool("pdf-editor");

export const metadata: Metadata = toolMetadata(tool);

export default function Page() {
  return (
    <ToolPage
      tool={tool}
      lead="Fix a typo, correct a date in a scan, highlight what matters, sign and send — all in a browser tab, without uploading the PDF."
      steps={[
        "Open a PDF. Pages with real text are editable right away.",
        "Scanned? Tap “Recognize text”, then click any word to correct it.",
        "Highlight, draw, add text, images or a signature — then export.",
      ]}
      notes={[
        {
          title: "Scans, fixed carefully",
          body: "When you correct a word in a scan, only the changed characters are repainted, matched to the surrounding ink and paper. Always check the preview — it's a close match, not a guarantee.",
        },
        {
          title: "Visual signatures",
          body: "Draw or upload your signature and place it on the page. It's an image of your signature, not a cryptographic digital signature.",
        },
        {
          title: "Whiteout isn't redaction",
          body: "Whiteout covers content visually. The original is still inside the file, so don't use it to hide sensitive information.",
        },
        {
          title: "Keyboard friendly",
          body: "Ctrl/⌘+Z undoes, Ctrl/⌘+Shift+Z redoes, Delete removes the selection and Escape returns to the Select tool.",
        },
      ]}
      related={["compress-pdf", "organize-pdf", "merge-pdf"]}
    >
      <EditorLauncher />
    </ToolPage>
  );
}
