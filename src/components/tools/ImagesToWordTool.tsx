"use client";

import { ImageSequenceTool, type ImageSequenceConfig } from "@/components/tools/ImageSequenceTool";

const config: ImageSequenceConfig = {
  toolId: "image-to-word",
  noun: "Word document",
  mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  downloadLabel: "Download .docx",
  fitNote: "Each page is the shape of its image, up to Letter size",
  failure: "The Word document couldn't be created.",
  continueWith: ["word-to-pdf", "compress-image"],
  outputName: (files) => (files.length === 1 ? files[0].name.replace(/\.[^.]+$/, "") + ".docx" : "images.docx"),
  async build(files, size, step) {
    const { imagesToWord } = await import("@/lib/processors/image-to-word");
    step("Preparing images…");
    return imagesToWord(files, {
      pageSize: size,
      onProgress: (done, total) => step(done < total ? `Placing image ${done + 1} of ${total}…` : "Building your Word document…"),
    });
  },
};

export function ImagesToWordTool() {
  return <ImageSequenceTool config={config} />;
}
