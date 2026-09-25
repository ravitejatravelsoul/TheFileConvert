"use client";

import { useEffect, useState } from "react";
import { FileWorkflow, type FileWorkflowResult, type FileWorkflowRun } from "@/components/tools/FileWorkflow";
import { Button } from "@/components/ui/Button";
import { compressImageToTarget, getImageDimensions, extensionForFormat, type ImageDimensions } from "@/lib/processors/image";
import { getToolById } from "@/lib/tools/registry";
import { safeOutputName, formatBytes } from "@/lib/format";

const tool = getToolById("image-compress")!;

const MB = 1024 * 1024;
const KB = 1024;

type PresetId = "100kb" | "250kb" | "500kb" | "1mb" | "custom";
const PRESETS: { id: PresetId; label: string; bytes?: number }[] = [
  { id: "100kb", label: "Under 100 KB", bytes: 100 * KB },
  { id: "250kb", label: "Under 250 KB", bytes: 250 * KB },
  { id: "500kb", label: "Under 500 KB", bytes: 500 * KB },
  { id: "1mb", label: "Under 1 MB", bytes: 1 * MB },
  { id: "custom", label: "Custom" },
];

function targetLabel(bytes: number): string {
  return bytes >= MB ? `${(bytes / MB).toFixed(bytes % MB === 0 ? 0 : 1)} MB` : `${Math.round(bytes / KB)} KB`;
}

function CompressConfig({ files, run }: { files: File[]; run: FileWorkflowRun }) {
  const [preset, setPreset] = useState<PresetId>("500kb");
  const [customValue, setCustomValue] = useState(500);
  const [customUnit, setCustomUnit] = useState<"KB" | "MB">("KB");
  // Keyed by file, so a newly chosen file shows no dimensions until its own result arrives (rather than
  // briefly showing the previous file's).
  const [inspected, setInspected] = useState<{ file: File | null; dims: ImageDimensions | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (files[0]) getImageDimensions(files[0]).then((d) => !cancelled && setInspected({ file: files[0], dims: d })).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [files]);

  const dims = inspected && inspected.file === files[0] ? inspected.dims : null;

  const targetBytes = preset === "custom" ? Math.max(1, Math.round(customValue * (customUnit === "MB" ? MB : KB))) : (PRESETS.find((p) => p.id === preset)!.bytes ?? 500 * KB);

  return (
    <div className="space-y-4 pt-2">
      <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-muted)] p-4 text-sm">
        <p className="font-medium text-[var(--foreground)]">
          {files.length === 1 ? `Original: ${formatBytes(files[0].size)}${dims ? ` · ${dims.width} × ${dims.height}` : ""}` : `${files.length} images selected`}
        </p>
      </div>

      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium text-[var(--foreground)]">Target file size</legend>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPreset(p.id)}
              className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                preset === p.id ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand-strong)]" : "border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] hover:bg-[var(--surface-muted)]"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {preset === "custom" && (
          <div className="flex items-center gap-2 pt-1">
            <input
              type="number"
              min={1}
              value={customValue}
              onChange={(e) => setCustomValue(Math.max(0.01, Number(e.target.value)))}
              className="w-28 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--brand)]"
            />
            <select
              value={customUnit}
              onChange={(e) => setCustomUnit(e.target.value as "KB" | "MB")}
              className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--brand)]"
            >
              <option value="KB">KB</option>
              <option value="MB">MB</option>
            </select>
          </div>
        )}
      </fieldset>

      <p className="text-xs text-[var(--foreground-muted)]">Format, quality and (if needed) dimensions are chosen automatically to best fit your target. Metadata (camera info, location) is removed. Transparency is kept when it exists.</p>

      <Button
        disabled={files.length === 0}
        onClick={() =>
          run(async (fs, report) => {
            report(fs.length > 1 ? "Analyzing images…" : "Analyzing file…");
            const out = await Promise.all(
              fs.map(async (file): Promise<FileWorkflowResult> => {
                const label = fs.length > 1 ? `${file.name}: ` : "";
                const result = await compressImageToTarget(file, targetBytes, (l) => report(`${label}Trying ${l}…`));
                const unchanged = result.blob === file;
                if (unchanged) {
                  return {
                    name: file.name,
                    blob: file,
                    note: `Already under your target (${formatBytes(file.size)}) — your original is returned unchanged.`,
                    badge: { text: `Target ✓ under ${targetLabel(targetBytes)}`, tone: "success" },
                  };
                }
                const shrunk = result.scale < 1;
                const notes: string[] = [];
                if (result.formatChanged) notes.push(`Converted to ${result.format.toUpperCase()} to reach your target${result.blob.type === "image/webp" ? " while preserving transparency" : ""}.`);
                if (shrunk) notes.push(`Also reduced to ${result.width} × ${result.height} px.`);
                const note = result.targetAchieved
                  ? [`Reached your target at ${Math.round(result.quality * 100)}% quality.`, ...notes].join(" ")
                  : [`Couldn't reach ${targetLabel(targetBytes)} without losing too much quality. Smallest safe result: ${formatBytes(result.newBytes)}.`, ...notes].join(" ");
                return {
                  name: safeOutputName(file.name, "compressed", extensionForFormat(result.format)),
                  blob: result.blob,
                  note,
                  badge: result.targetAchieved ? { text: `Target ✓ under ${targetLabel(targetBytes)}`, tone: "success" } : { text: "Closest safe result", tone: "warning" },
                };
              })
            );
            report("Finalizing…");
            return out;
          })
        }
      >
        Compress to under {targetLabel(targetBytes)}
      </Button>
    </div>
  );
}

export function CompressWorkflow() {
  return (
    <FileWorkflow tool={tool} multiple zipDownloadName="compressed-images.zip" noSavingsHint="This image is already small, or already efficiently compressed at this format.">
      {({ files, run }) => <CompressConfig files={files} run={run} />}
    </FileWorkflow>
  );
}
