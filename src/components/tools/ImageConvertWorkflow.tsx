"use client";

import { useState } from "react";
import { FileWorkflow } from "@/components/tools/FileWorkflow";
import { Field, RangeField } from "@/components/tools/fields";
import { Button } from "@/components/ui/Button";
import { convertImage, extensionForFormat, type ImageOutputFormat } from "@/lib/processors/image";
import { safeOutputName } from "@/lib/format";
import type { ToolDefinition } from "@/lib/tools/types";

export function ImageConvertWorkflow({ tool, targetFormat }: { tool: ToolDefinition; targetFormat: ImageOutputFormat }) {
  const [quality, setQuality] = useState(90);
  const showQuality = targetFormat !== "png";

  return (
    <FileWorkflow tool={tool} multiple zipDownloadName={`converted-${targetFormat}.zip`}>
      {({ files, run }) => (
        <div className="space-y-4 pt-2">
          {showQuality && (
            <Field label="Quality">
              <RangeField value={quality} onChange={setQuality} min={10} max={100} />
            </Field>
          )}
          <Button
            disabled={files.length === 0}
            onClick={() =>
              run(async (fs) =>
                Promise.all(
                  fs.map(async (file) => ({
                    name: safeOutputName(file.name, "converted", extensionForFormat(targetFormat)),
                    blob: await convertImage(file, { format: targetFormat, quality: quality / 100 }),
                  }))
                )
              )
            }
          >
            Convert {files.length || ""} file{files.length === 1 ? "" : "s"}
          </Button>
        </div>
      )}
    </FileWorkflow>
  );
}
