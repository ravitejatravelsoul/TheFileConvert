"use client";

import { useEffect, useState } from "react";
import { FileWorkflow } from "@/components/tools/FileWorkflow";
import { Button } from "@/components/ui/Button";
import {
  analyzePdfImages,
  compressPdfDocument,
  describeAnalysis,
  LEVEL_SETTINGS,
  type CompressLevel,
  type PdfImageAnalysis,
} from "@/lib/processors/pdf-compress";
import { getToolById } from "@/lib/tools/registry";
import { safeOutputName, formatBytes } from "@/lib/format";

const tool = getToolById("pdf-compress")!;

const LEVELS: { id: CompressLevel; label: string; detail: string }[] = [
  { id: "lossless", label: "Lossless (safe)", detail: "Pages look exactly the same. Only merges repeated images and tidies the file structure." },
  { id: "balanced", label: LEVEL_SETTINGS.balanced.label + " — reduce image quality", detail: LEVEL_SETTINGS.balanced.tradeoff },
  { id: "small", label: LEVEL_SETTINGS.small.label + " — reduce image quality more", detail: LEVEL_SETTINGS.small.tradeoff },
];

function CompressOptions({ file, run }: { file: File; run: (h: (files: File[]) => Promise<{ name: string; blob: Blob; note?: string }[]>) => void }) {
  const [level, setLevel] = useState<CompressLevel>("lossless");
  // Keyed by file, so a newly chosen file shows "Inspecting…" until its own result arrives.
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
  const analysisFailed = current !== null && current.analysis === null;

  const info = analysis ? describeAnalysis(analysis) : null;

  return (
    <div className="space-y-5 pt-2">
      <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-muted)] p-4 text-sm" aria-live="polite">
        {analysis && info ? (
          <>
            <p className="font-medium text-[var(--foreground)]">
              {formatBytes(analysis.totalBytes)} · {info.headline}
            </p>
            <p className="mt-1 text-[var(--foreground-muted)]">{info.advice}</p>
          </>
        ) : analysisFailed ? (
          <p className="text-[var(--foreground-muted)]">Couldn&rsquo;t inspect this PDF&rsquo;s contents ahead of time; you can still try compressing it.</p>
        ) : (
          <p className="text-[var(--foreground-muted)]">Inspecting the PDF&hellip;</p>
        )}
      </div>

      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium text-[var(--foreground)]">How much to compress</legend>
        {LEVELS.map((l) => (
          <label
            key={l.id}
            className={`flex cursor-pointer items-start gap-3 rounded-[var(--radius-md)] border p-3 text-sm transition-colors ${
              level === l.id ? "border-[var(--brand)] bg-[var(--brand-soft)]" : "border-[var(--border)] bg-[var(--surface)]"
            }`}
          >
            <input type="radio" name="compress-level" value={l.id} checked={level === l.id} onChange={() => setLevel(l.id)} className="mt-1 accent-[var(--brand)]" />
            <span>
              <span className="block font-medium text-[var(--foreground)]">{l.label}</span>
              <span className="block text-[var(--foreground-muted)]">{l.detail}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <Button
        onClick={() =>
          run(async (f) => {
            const buf = new Uint8Array(await f[0].arrayBuffer());
            let result;
            try {
              result = await compressPdfDocument(buf, level);
            } catch {
              throw new Error("We couldn't read this PDF. It may be damaged, encrypted, or incomplete.");
            }
            return [{ name: safeOutputName(f[0].name, "compressed", "pdf"), blob: result.blob, note: result.summary }];
          })
        }
      >
        Compress {file.name}
      </Button>
    </div>
  );
}

export function CompressWorkflow() {
  return (
    <FileWorkflow
      tool={tool}
      multiple={false}
      noSavingsHint="This PDF has little left to squeeze at this setting. If it is mostly scanned pages or photos, try Balanced or Smallest (they lower image quality); if it is mostly text, it is already about as small as it can get."
    >
      {({ files, run }) => (files[0] ? <CompressOptions file={files[0]} run={run} /> : null)}
    </FileWorkflow>
  );
}
