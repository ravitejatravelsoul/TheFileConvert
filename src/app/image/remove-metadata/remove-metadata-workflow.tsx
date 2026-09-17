"use client";

import { FileWorkflow } from "@/components/tools/FileWorkflow";
import { Button } from "@/components/ui/Button";
import { convertImage, extensionForFormat, type ImageOutputFormat } from "@/lib/processors/image";
import { getToolById } from "@/lib/tools/registry";
import { safeOutputName, getExtension } from "@/lib/format";

const tool = getToolById("image-metadata-remove")!;

function formatFromExtension(name: string): ImageOutputFormat {
  const ext = getExtension(name);
  if (ext === "png") return "png";
  if (ext === "webp") return "webp";
  return "jpeg";
}

export function RemoveMetadataWorkflow() {
  return (
    <FileWorkflow tool={tool} multiple zipDownloadName="cleaned-images.zip">
      {({ files, run }) => (
        <div className="pt-2">
          <Button
            disabled={files.length === 0}
            onClick={() =>
              run(async (fs) =>
                Promise.all(
                  fs.map(async (file) => {
                    const format = formatFromExtension(file.name);
                    return {
                      name: safeOutputName(file.name, "no-metadata", extensionForFormat(format)),
                      blob: await convertImage(file, { format, quality: 0.95 }),
                    };
                  })
                )
              )
            }
          >
            Remove metadata from {files.length || ""} image{files.length === 1 ? "" : "s"}
          </Button>
        </div>
      )}
    </FileWorkflow>
  );
}
