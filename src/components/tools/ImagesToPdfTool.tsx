"use client";

import { ImageSequenceTool, type ImageSequenceConfig } from "@/components/tools/ImageSequenceTool";

const config: ImageSequenceConfig = {
  toolId: "image-to-pdf",
  noun: "PDF",
  mime: "application/pdf",
  downloadLabel: "Download PDF",
  fitNote: "Each page is the size of its image",
  failure: "The PDF couldn't be created.",
  continueWith: ["compress-pdf", "pdf-editor", "merge-pdf"],
  outputName: (files) => (files.length === 1 ? files[0].name.replace(/\.[^.]+$/, "") + ".pdf" : "images.pdf"),
  async build(files, size, step) {
    const [{ prepareImageForPdf }, { imagesToPdf }] = await Promise.all([import("@/lib/processors/image"), import("@/lib/processors/pdf")]);
    const prepared: File[] = [];
    for (const [i, file] of files.entries()) {
      step(`Preparing image ${i + 1} of ${files.length}…`);
      try {
        prepared.push(await prepareImageForPdf(file));
      } catch {
        throw new Error(`“${file.name}” couldn't be read. It may be damaged — remove it and try again.`);
      }
    }
    step("Building your PDF…");
    return imagesToPdf(prepared, { pageSize: size, margin: size === "fit" ? 0 : 24 });
  },
};

export function ImagesToPdfTool() {
  return <ImageSequenceTool config={config} />;
}
