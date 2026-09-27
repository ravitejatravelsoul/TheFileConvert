"use client";

import { useEffect, useState } from "react";
import { Dropzone } from "@/components/tool/Dropzone";
import { Alert, StatGrid, Working } from "@/components/tool/Feedback";
import { SelectedFile } from "@/components/tool/SelectedFile";
import { TargetPicker, resolveTarget, type TargetChoice } from "@/components/tool/TargetPicker";
import { ContinueWith } from "@/components/tool/ContinueWith";
import { TargetOutcome } from "@/components/tool/TargetOutcome";
import { useFileIntake } from "@/components/tool/useFileIntake";
import { IconDownload } from "@/components/icons";
import { getTool } from "@/lib/tools/registry";
import { triggerDownload } from "@/lib/download";
import { safeOutputName } from "@/lib/format";
import { startTimer } from "@/lib/timer";
import { MB, KB, formatExact, formatSize, formatTarget, percentSaved } from "@/lib/size";
import { decideOutcome, type Outcome } from "@/lib/processors/outcome";

const tool = getTool("compress-pdf");
const PRESETS = [500 * KB, 1 * MB, 2 * MB, 5 * MB];
/** Lossless pass + seven quality rungs + up to two refinement steps. */
const SEARCH_STEPS = 10;

type Phase =
  | { name: "empty" }
  | { name: "ready" }
  | { name: "working"; label: string; step: number }
  | { name: "done"; target: number; outcome: Outcome; quality: string; ms: number; output: File }
  | { name: "error"; message: string };

function qualityLabel(rung: string): string {
  if (rung.startsWith("lossless")) return "Lossless";
  return rung.replace(/ quality$/, "").replace(/^./, (c) => c.toUpperCase());
}

export function CompressPdfTool() {
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>({ name: "empty" });
  const [choice, setChoice] = useState<TargetChoice>({ preset: 1 * MB, customValue: "", customUnit: "KB" });
  const [outlook, setOutlook] = useState<{ file: File; text: string } | null>(null);
  const { intake, rejections } = useFileIntake(tool, (files) => {
    setFile(files[0]);
    setPhase({ name: "ready" });
  });

  // A quick look inside the PDF so the user knows what to expect before choosing a target.
  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    (async () => {
      try {
        const { analyzePdfImages, compressionOutlook } = await import("@/lib/processors/pdf-compress");
        const analysis = await analyzePdfImages(await file.arrayBuffer());
        if (!cancelled) setOutlook({ file, text: compressionOutlook(analysis).text });
      } catch {
        if (!cancelled) setOutlook(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file]);

  const target = resolveTarget(choice);

  async function run() {
    if (!file || !target) return;
    const elapsed = startTimer();
    setPhase({ name: "working", label: "Checking the file…", step: 0 });
    try {
      const { compressPdfToTarget } = await import("@/lib/processors/pdf-compress");
      let step = 0;
      const result = await compressPdfToTarget(new Uint8Array(await file.arrayBuffer()), target, undefined, undefined, (rung) => {
        step += 1;
        setPhase({
          name: "working",
          label: rung.startsWith("lossless") ? "Trying a lossless clean-up first…" : `Trying ${rung}…`,
          step,
        });
      });
      const outcome = decideOutcome(file, target, result);
      const output = outcome.blob === file ? file : new File([outcome.blob], safeOutputName(file.name, "compressed", "pdf"), { type: "application/pdf" });
      setPhase({
        name: "done",
        target,
        outcome,
        quality: outcome.kind === "already-small" || outcome.kind === "no-gain" ? "Original" : qualityLabel(result.rungLabel === "closest safe result" ? lowestRungFor(result) : result.rungLabel),
        ms: elapsed(),
        output,
      });
    } catch {
      setPhase({ name: "error", message: "This PDF couldn't be read. It may be damaged, password-protected or incomplete." });
    }
  }

  function reset() {
    setFile(null);
    setPhase({ name: "empty" });
  }

  if (!file || phase.name === "empty") {
    return (
      <div className="space-y-4">
        <Dropzone
          accept={tool.accept}
          onFiles={intake}
          title="Drop your PDF here"
          buttonLabel="Choose PDF"
          hint="Your PDF stays on this device"
        />
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
        <Working label={phase.label} detail="Starting with the highest quality and stopping at the first result that fits." fraction={Math.min(1, phase.step / SEARCH_STEPS)} />
      </div>
    );
  }

  if (phase.name === "done") {
    return <CompressPdfResult file={file} phase={phase} onRetarget={() => setPhase({ name: "ready" })} onReset={reset} />;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <SelectedFile rules={tool} file={file} onChange={reset} />
      {outlook?.file === file && <p className="text-[0.9375rem] leading-relaxed text-[var(--ink-2)]" aria-live="polite">{outlook.text}</p>}
      {phase.name === "error" && <Alert tone="danger">{phase.message}</Alert>}
      <div className="card p-5 sm:p-7">
        <TargetPicker presets={PRESETS} value={choice} onChange={setChoice} originalBytes={file.size} />
        {target !== null && file.size <= target && (
          <p className="mt-4 text-sm text-[var(--ink-2)]">
            This PDF is already under {formatTarget(target)}. You can still run it — if nothing smaller comes out, you get the original back unchanged.
          </p>
        )}
        <button type="button" onClick={run} disabled={target === null} className="btn btn-primary btn-lg mt-6 w-full sm:w-auto">
          {target === null ? "Enter a target size" : `Compress to under ${formatTarget(target)}`}
        </button>
      </div>
    </div>
  );
}

/** When no rung reached the target the engine reports "closest safe result"; the smallest attempt
 * tells us which setting that was. */
function lowestRungFor(result: { attempts: { label: string; bytes: number }[] }): string {
  const best = result.attempts.reduce((a, b) => (b.bytes < a.bytes ? b : a));
  return best.label;
}

function CompressPdfResult({
  file,
  phase,
  onRetarget,
  onReset,
}: {
  file: File;
  phase: Extract<Phase, { name: "done" }>;
  onRetarget: () => void;
  onReset: () => void;
}) {
  const { outcome, target, output } = phase;
  const saved = percentSaved(file.size, outcome.bytes);
  const reached = outcome.kind === "reached" || outcome.kind === "already-small";

  return (
    <div className="mx-auto max-w-3xl space-y-6" data-testid="result">
      <div className="card overflow-hidden">
        <TargetOutcome outcome={outcome} target={target} noun="PDF" />
        <div className="space-y-5 p-5 sm:p-7">
          <StatGrid
            stats={[
              { label: "Original", value: formatSize(file.size), exact: formatExact(file.size) },
              { label: "New", value: formatSize(outcome.bytes), exact: formatExact(outcome.bytes) },
              { label: "Saved", value: `${saved}%`, tone: saved > 0 ? "success" : "default" },
              {
                label: "Target",
                value: reached ? `${formatTarget(target)} ✓` : `${formatTarget(target)} ✗`,
                exact: formatExact(target),
                tone: reached ? "success" : "warning",
              },
            ]}
          />
          <p className="text-sm text-[var(--ink-2)]">
            Quality setting: <span className="font-medium text-[var(--ink)]">{phase.quality}</span> · finished in {(phase.ms / 1000).toFixed(1)} s
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <button type="button" className="btn btn-primary btn-lg" onClick={() => triggerDownload(output.name, output)}>
              <IconDownload className="h-5 w-5" />
              {outcome.kind === "closest" ? `Download closest result (${formatSize(outcome.bytes)})` : "Download PDF"}
            </button>
            <button type="button" className="btn btn-secondary btn-lg" onClick={onRetarget}>
              Try another size
            </button>
            <button type="button" className="btn btn-ghost btn-lg" onClick={onReset}>
              New file
            </button>
          </div>
        </div>
      </div>
      <ContinueWith files={[output]} tools={["pdf-editor", "merge-pdf", "split-pdf"]} />
    </div>
  );
}
