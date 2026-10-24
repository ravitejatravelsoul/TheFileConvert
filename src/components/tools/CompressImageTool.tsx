"use client";

import { useEffect, useState } from "react";
import { Dropzone } from "@/components/tool/Dropzone";
import { Alert, StatGrid, Working } from "@/components/tool/Feedback";
import { SelectedFile } from "@/components/tool/SelectedFile";
import { TargetPicker, resolveTarget, type TargetChoice } from "@/components/tool/TargetPicker";
import { ContinueWith } from "@/components/tool/ContinueWith";
import { TargetOutcome } from "@/components/tool/TargetOutcome";
import { BlobImage } from "@/components/tool/FileThumb";
import { useFileIntake } from "@/components/tool/useFileIntake";
import { IconDownload } from "@/components/icons";
import { getTool } from "@/lib/tools/registry";
import { triggerDownload } from "@/lib/download";
import { safeOutputName } from "@/lib/format";
import { startTimer } from "@/lib/timer";
import { KB, MB, formatExact, formatSize, formatTarget, percentSaved } from "@/lib/size";
import { decideOutcome, type Outcome } from "@/lib/processors/outcome";
import type { ImageTargetResult } from "@/lib/processors/image";

const tool = getTool("compress-image");
const PRESETS = [100 * KB, 250 * KB, 500 * KB, 1 * MB];

type Phase =
  | { name: "empty" }
  | { name: "ready" }
  | { name: "working"; label: string }
  | { name: "done"; target: number; outcome: Outcome; result: ImageTargetResult; output: File; ms: number }
  | { name: "error"; message: string };

const FORMAT_NAME = { jpeg: "JPG", png: "PNG", webp: "WebP" } as const;

export function CompressImageTool() {
  const [file, setFile] = useState<File | null>(null);
  const [dims, setDims] = useState<{ file: File; w: number; h: number } | null>(null);
  const [phase, setPhase] = useState<Phase>({ name: "empty" });
  const [choice, setChoice] = useState<TargetChoice>({ preset: 250 * KB, customValue: "", customUnit: "KB" });
  const { intake, rejections } = useFileIntake(tool, (files) => {
    setFile(files[0]);
    setPhase({ name: "ready" });
  });

  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    import("@/lib/processors/image")
      .then((m) => m.getImageDimensions(file))
      .then((d) => !cancelled && setDims({ file, w: d.width, h: d.height }))
      .catch(() => !cancelled && setDims(null));
    return () => {
      cancelled = true;
    };
  }, [file]);

  const target = resolveTarget(choice);

  async function run() {
    if (!file || !target) return;
    const elapsed = startTimer();
    setPhase({ name: "working", label: "Looking at the image…" });
    try {
      const { compressImageToTarget, extensionForFormat } = await import("@/lib/processors/image");
      const result = await compressImageToTarget(file, target, (label) => setPhase({ name: "working", label: `Trying ${label}…` }));
      const outcome = decideOutcome(file, target, result);
      const ext = outcome.blob === file ? undefined : extensionForFormat(result.format);
      const output =
        outcome.blob === file ? file : new File([outcome.blob], safeOutputName(file.name, "compressed", ext), { type: outcome.blob.type || `image/${result.format}` });
      setPhase({ name: "done", target, outcome, result, output, ms: elapsed() });
    } catch {
      setPhase({ name: "error", message: "This image couldn't be read. It may be damaged or in a format your browser can't open." });
    }
  }

  function reset() {
    setFile(null);
    setPhase({ name: "empty" });
  }

  if (!file || phase.name === "empty") {
    return (
      <div className="space-y-4">
        <Dropzone accept={tool.accept} onFiles={intake} title="Drop your image here" buttonLabel="Choose image" hint="JPG, PNG or WebP · stays on this device" />
        {rejections.map((r) => (
          <Alert key={r} tone="danger">
            {r}
          </Alert>
        ))}
      </div>
    );
  }

  if (phase.name === "working") {
    return (
      <div className="mx-auto max-w-3xl">
        <Working label={phase.label} detail="Highest quality first; the image is only resized if quality alone can't reach your target." />
      </div>
    );
  }

  if (phase.name === "done") return <Result file={file} phase={phase} onRetarget={() => setPhase({ name: "ready" })} onReset={reset} />;

  const currentDims = dims?.file === file ? dims : null;
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <SelectedFile rules={tool} file={file} meta={currentDims ? `${currentDims.w} × ${currentDims.h}px` : undefined} onChange={reset} />
      {phase.name === "error" && <Alert tone="danger">{phase.message}</Alert>}
      <div className="card p-5 sm:p-7">
        <TargetPicker presets={PRESETS} value={choice} onChange={setChoice} originalBytes={file.size} />
        <button type="button" onClick={run} disabled={target === null} className="btn btn-primary btn-lg mt-6 w-full sm:w-auto">
          {target === null ? "Enter a target size" : `Compress to under ${formatTarget(target)}`}
        </button>
        <p className="mt-4 text-sm text-[var(--ink-2)]">No quality slider needed — quality, dimensions and format are chosen for you.</p>
      </div>
    </div>
  );
}

function formatNote(result: ImageTargetResult): string | null {
  if (!result.formatChanged) return null;
  if (result.transparent) return "Converted to WebP to keep transparency while reaching your target.";
  return "Converted to WebP — it reaches much smaller sizes than PNG at the same visual quality.";
}

function Result({ file, phase, onRetarget, onReset }: { file: File; phase: Extract<Phase, { name: "done" }>; onRetarget: () => void; onReset: () => void }) {
  const { outcome, result, target, output } = phase;

  const untouched = outcome.blob === file;
  const reached = outcome.kind === "reached" || outcome.kind === "already-small";
  const saved = percentSaved(file.size, outcome.bytes);
  const note = untouched ? null : formatNote(result);

  return (
    <div className="mx-auto max-w-4xl space-y-6" data-testid="result">
      <div className="card overflow-hidden">
        <TargetOutcome outcome={outcome} target={target} noun="image" />
        <div className="grid gap-6 p-5 sm:p-7 md:grid-cols-[220px_1fr]">
          <div className="hatch flex aspect-square items-center justify-center overflow-hidden rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-2)] p-3">
            <BlobImage blob={output} alt="Compressed result preview" className="max-h-full max-w-full object-contain" />
          </div>
          <div className="min-w-0 space-y-5">
            <StatGrid
              stats={[
                { label: "Original", value: formatSize(file.size), exact: formatExact(file.size) },
                { label: "New", value: formatSize(outcome.bytes), exact: formatExact(outcome.bytes) },
                { label: "Saved", value: `${saved}%`, tone: saved > 0 ? "success" : "default" },
                { label: "Target", value: `${formatTarget(target)} ${reached ? "✓" : "✗"}`, exact: formatExact(target), tone: reached ? "success" : "warning" },
              ]}
            />
            {!untouched && (
              <p className="text-sm text-[var(--ink-2)]" data-testid="image-details">
                {FORMAT_NAME[result.format]} · {result.width} × {result.height}px
                {result.scale < 1 ? ` (resized to ${Math.round(result.scale * 100)}%)` : ""} · quality {Math.round(result.quality * 100)}% · {(phase.ms / 1000).toFixed(1)} s
              </p>
            )}
            {note && <Alert tone="info">{note}</Alert>}
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <button type="button" className="btn btn-primary btn-lg" onClick={() => triggerDownload(output.name, output)}>
                <IconDownload className="h-5 w-5" />
                {outcome.kind === "closest" ? `Download closest result (${formatSize(outcome.bytes)})` : `Download ${untouched ? "image" : FORMAT_NAME[result.format]}`}
              </button>
              <button type="button" className="btn btn-secondary btn-lg" onClick={onRetarget}>
                Try another size
              </button>
              <button type="button" className="btn btn-ghost btn-lg" onClick={onReset}>
                New image
              </button>
            </div>
          </div>
        </div>
      </div>
      <ContinueWith files={[output]} tools={["image-to-pdf", "convert-image"]} />
    </div>
  );
}
