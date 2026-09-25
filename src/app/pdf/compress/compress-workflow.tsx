"use client";

import { useEffect, useState } from "react";
import { FileWorkflow, type FileWorkflowResult } from "@/components/tools/FileWorkflow";
import { Button } from "@/components/ui/Button";
import { analyzePdfImages, compressPdfToTarget, describeAnalysis, type PdfImageAnalysis } from "@/lib/processors/pdf-compress";
import { getToolById } from "@/lib/tools/registry";
import { safeOutputName, formatBytes } from "@/lib/format";

const tool = getToolById("pdf-compress")!;

const MB = 1024 * 1024;
const KB = 1024;

type PresetId = "500kb" | "1mb" | "2mb" | "5mb" | "custom";
const PRESETS: { id: PresetId; label: string; bytes?: number }[] = [
  { id: "500kb", label: "Under 500 KB", bytes: 500 * KB },
  { id: "1mb", label: "Under 1 MB", bytes: 1 * MB },
  { id: "2mb", label: "Under 2 MB", bytes: 2 * MB },
  { id: "5mb", label: "Under 5 MB", bytes: 5 * MB },
  { id: "custom", label: "Custom" },
];

function targetLabel(bytes: number): string {
  return bytes >= MB ? `${(bytes / MB).toFixed(bytes % MB === 0 ? 0 : 1)} MB` : `${Math.round(bytes / KB)} KB`;
}

function CompressOptions({ file, run }: { file: File; run: (h: (files: File[]) => Promise<FileWorkflowResult[]>) => void }) {
  const [preset, setPreset] = useState<PresetId>("1mb");
  const [customValue, setCustomValue] = useState(1);
  const [customUnit, setCustomUnit] = useState<"KB" | "MB">("MB");
  const [inspected, setInspected] = useState<{ file: File; analysis: PdfImageAnalysis | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    file
      .arrayBuffer()
      .then((buf) => analyzePdfImages(buf))
      .then((a) => !cancelled && setInspected({ file, analysis: a }))
      .catch(() => !cancelled && setInspected({ file, analysis: null }));
    return () => {
      cancelled = true;
    };
  }, [file]);

  const current = inspected && inspected.file === file ? inspected : null;
  const analysis = current?.analysis ?? null;
  const info = analysis ? describeAnalysis(analysis) : null;

  const targetBytes = preset === "custom" ? Math.max(1, Math.round(customValue * (customUnit === "MB" ? MB : KB))) : (PRESETS.find((p) => p.id === preset)!.bytes ?? MB);
  const alreadyUnderTarget = file.size <= targetBytes;

  return (
    <div className="space-y-5 pt-2">
      <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-muted)] p-4 text-sm" aria-live="polite">
        <p className="font-medium text-[var(--foreground)]">Current size: {formatBytes(file.size)}</p>
        {analysis && info && <p className="mt-1 text-[var(--foreground-muted)]">{info.headline}</p>}
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

      {alreadyUnderTarget && (
        <p className="text-sm text-[var(--foreground-muted)]">
          This file is already smaller than {targetLabel(targetBytes)} — compressing will only tidy its structure, not shrink it much further.
        </p>
      )}

      <Button
        onClick={() =>
          run(async (f) => {
            const buf = new Uint8Array(await f[0].arrayBuffer());
            let result;
            try {
              result = await compressPdfToTarget(buf, targetBytes);
            } catch {
              throw new Error("We couldn't read this PDF. It may be damaged, encrypted, or incomplete.");
            }
            const savedPct = result.originalBytes > 0 ? Math.round(((result.originalBytes - result.newBytes) / result.originalBytes) * 100) : 0;
            const note = result.targetAchieved
              ? `Reached your target at ${result.rungLabel} (${formatBytes(result.originalBytes)} → ${formatBytes(result.newBytes)}, ${Math.max(0, savedPct)}% smaller).`
              : `Couldn't reach ${targetLabel(targetBytes)} without making the document hard to read. This is the smallest safe result: ${formatBytes(result.newBytes)}.`;
            return [
              {
                name: safeOutputName(f[0].name, "compressed", "pdf"),
                blob: result.blob,
                note,
                badge: result.targetAchieved ? { text: `Target ✓ under ${targetLabel(targetBytes)}`, tone: "success" } : { text: "Closest safe result", tone: "warning" },
              },
            ];
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
    <FileWorkflow
      tool={tool}
      multiple={false}
      noSavingsHint="This PDF has little left to squeeze — it's mostly text/vector content, or already efficiently compressed."
    >
      {({ files, run }) => (files[0] ? <CompressOptions file={files[0]} run={run} /> : null)}
    </FileWorkflow>
  );
}
