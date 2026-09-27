"use client";

import { useState } from "react";
import { Dropzone } from "@/components/tool/Dropzone";
import { Alert, Working } from "@/components/tool/Feedback";
import { ImageThumb } from "@/components/tool/FileThumb";
import { ContinueWith } from "@/components/tool/ContinueWith";
import { useFileIntake } from "@/components/tool/useFileIntake";
import { IconArchive, IconArrowRight, IconClose, IconDownload } from "@/components/icons";
import { getTool } from "@/lib/tools/registry";
import { downloadAllAsZip, triggerDownload } from "@/lib/download";
import { withExtension } from "@/lib/format";
import { formatSize } from "@/lib/size";
import type { ImageOutputFormat } from "@/lib/processors/image";

const tool = getTool("convert-image");
/** WebP at 0.85 looks like JPEG at 0.92 but is much smaller — the reason people choose WebP. At 0.92 a
 * converted photo often came out larger than the JPEG it came from. */
const WEBP_QUALITY = 0.85;

type Target = ImageOutputFormat;
const TARGETS: { id: Target; label: string; note: string }[] = [
  { id: "jpeg", label: "JPG", note: "Smallest for photos. No transparency — see-through areas turn white." },
  { id: "png", label: "PNG", note: "Lossless and keeps transparency. Larger files." },
  { id: "webp", label: "WebP", note: "Small files with transparency. Works in all modern browsers." },
];
const LABEL: Record<string, string> = { jpeg: "JPG", png: "PNG", webp: "WebP", svg: "SVG" };

type SourceFormat = ImageOutputFormat | "svg";

function sourceFormat(file: File): SourceFormat | null {
  const n = file.name.toLowerCase();
  if (file.type === "image/svg+xml" || n.endsWith(".svg")) return "svg";
  if (file.type === "image/jpeg" || /\.jpe?g$/.test(n)) return "jpeg";
  if (file.type === "image/png" || n.endsWith(".png")) return "png";
  if (file.type === "image/webp" || n.endsWith(".webp")) return "webp";
  return null;
}

interface Item {
  key: string;
  file: File;
}

interface Converted {
  key: string;
  source: File;
  output?: File;
  width?: number;
  height?: number;
  skipped?: string;
  error?: string;
}

let seq = 0;

export function ConvertImageTool() {
  const [items, setItems] = useState<Item[]>([]);
  const [target, setTarget] = useState<Target | null>(null);
  const [phase, setPhase] = useState<"pick" | "working" | "done">("pick");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState<Converted[]>([]);
  const { intake, rejections } = useFileIntake(tool, (files) => {
    const added = files.map((file) => ({ key: `f${++seq}`, file }));
    setItems((prev) => [...prev, ...added]);
    setPhase("pick");
  });

  const formats = new Set(items.map((i) => sourceFormat(i.file)));
  const allSame = target !== null && items.length > 0 && items.every((i) => sourceFormat(i.file) === target);

  async function run() {
    if (!target) return;
    setPhase("working");
    setProgress({ done: 0, total: items.length });
    const img = await import("@/lib/processors/image");
    const out: Converted[] = [];
    for (const [index, { key, file }] of items.entries()) {
      const src = sourceFormat(file);
      try {
        if (src === target) {
          out.push({ key, source: file, skipped: `Already ${LABEL[target]}` });
        } else {
          let input: File = file;
          let size: { width: number; height: number } | null = null;
          if (src === "svg") {
            const png = await img.svgToPng(file);
            size = { width: png.width, height: png.height };
            input = new File([png.blob], withExtension(file.name, "png"), { type: "image/png" });
          }
          const blob = target === "png" && src === "svg" ? input : await img.convertImage(input, { format: target, quality: target === "webp" ? WEBP_QUALITY : 0.92 });
          size ??= await img.getImageDimensions(input);
          const name = withExtension(file.name, img.extensionForFormat(target));
          out.push({ key, source: file, output: new File([blob], name, { type: blob.type }), ...size });
        }
      } catch (e) {
        out.push({ key, source: file, error: e instanceof Error ? e.message : "This image couldn't be converted." });
      }
      setProgress({ done: index + 1, total: items.length });
    }
    setResults(out);
    setPhase("done");
  }

  function reset() {
    setItems([]);
    setResults([]);
    setTarget(null);
    setPhase("pick");
  }

  if (phase === "working") {
    return (
      <div className="mx-auto max-w-3xl">
        <Working label={`Converting ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`} fraction={progress.total ? progress.done / progress.total : null} />
      </div>
    );
  }

  if (phase === "done") {
    const outputs = results.filter((r) => r.output).map((r) => r.output!);
    const failed = results.filter((r) => r.error).length;
    const headline =
      outputs.length === 0
        ? failed
          ? failed === 1
            ? "This image couldn't be converted"
            : "These images couldn't be converted"
          : "Nothing to convert"
        : `${outputs.length} ${outputs.length === 1 ? "image" : "images"} converted to ${LABEL[target!]}${failed ? ` · ${failed} couldn't be read` : ""}`;
    return (
      <div className="mx-auto max-w-4xl space-y-6" data-testid="result">
        <div className="card overflow-hidden">
          <div className={`${outputs.length === 0 && failed ? "bg-[var(--danger-soft)]" : "bg-[var(--success-soft)]"} px-5 py-6 sm:px-7`}>
            <p role="status" className="text-2xl font-semibold tracking-[-0.03em] sm:text-[1.75rem]">
              {headline}
            </p>
          </div>
          <ul className="divide-y divide-[var(--line)]">
            {results.map((r) => (
              <li key={r.key} className="flex items-center gap-4 px-5 py-4 sm:px-7">
                <ImageThumb file={r.output ?? r.source} alt="" className="h-14 w-14 shrink-0 rounded-[10px] border border-[var(--line)]" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold tracking-[-0.01em]">{r.output?.name ?? r.source.name}</p>
                  <p className="tabular text-sm text-[var(--ink-2)]">
                    {r.output ? (
                      <>
                        {formatSize(r.source.size)} <IconArrowRight className="inline h-3.5 w-3.5 align-[-2px]" /> {formatSize(r.output.size)} · {r.width} × {r.height}px
                      </>
                    ) : (
                      <span className={r.error ? "text-[var(--danger)]" : ""}>{r.error ?? `${r.skipped} — skipped`}</span>
                    )}
                  </p>
                </div>
                {r.output && (
                  <button type="button" className="btn btn-secondary btn-sm shrink-0" onClick={() => triggerDownload(r.output!.name, r.output!)}>
                    <IconDownload className="h-4 w-4" />
                    <span className="hidden sm:inline">Download</span>
                    <span className="sr-only sm:hidden">Download {r.output.name}</span>
                  </button>
                )}
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-3 border-t border-[var(--line)] p-5 sm:flex-row sm:px-7">
            {outputs.length > 1 && (
              <button
                type="button"
                className="btn btn-primary btn-lg"
                onClick={() => downloadAllAsZip("converted-images.zip", outputs.map((o) => ({ name: o.name, blob: o })))}
              >
                <IconArchive className="h-5 w-5" />
                Download all (ZIP)
              </button>
            )}
            {outputs.length === 1 && (
              <button type="button" className="btn btn-primary btn-lg" onClick={() => triggerDownload(outputs[0].name, outputs[0])}>
                <IconDownload className="h-5 w-5" />
                Download {LABEL[target!]}
              </button>
            )}
            <button type="button" className="btn btn-secondary btn-lg" onClick={() => setPhase("pick")}>
              Choose another format
            </button>
            <button type="button" className="btn btn-ghost btn-lg" onClick={reset}>
              New images
            </button>
          </div>
        </div>
        <ContinueWith files={outputs} tools={outputs.length > 1 ? ["image-to-pdf", "compress-image"] : ["compress-image", "image-to-pdf"]} />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="space-y-4">
        <Dropzone accept={tool.accept} multiple onFiles={intake} title="Drop your images here" buttonLabel="Choose images" hint="JPG, PNG, WebP or SVG · stays on this device" />
        {rejections.map((r) => (
          <Alert key={r} tone="danger">
            {r}
          </Alert>
        ))}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="card p-5 sm:p-7">
        <div className="flex items-baseline justify-between gap-4">
          <p className="font-semibold tracking-[-0.01em]">
            {items.length} {items.length === 1 ? "image" : "images"} · {[...formats].filter(Boolean).map((f) => LABEL[f!]).join(", ")}
          </p>
          <button type="button" onClick={reset} className="btn btn-ghost btn-sm">
            Clear
          </button>
        </div>
        <ul className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-5 md:grid-cols-6">
          {items.map((it) => (
            <li key={it.key} className="group relative">
              <ImageThumb file={it.file} alt={it.file.name} className="aspect-square rounded-[var(--radius-sm)] border border-[var(--line)]" />
              <p className="mt-1 truncate text-xs text-[var(--ink-2)]" title={it.file.name}>
                {it.file.name}
              </p>
              <button
                type="button"
                aria-label={`Remove ${it.file.name}`}
                onClick={() => setItems((prev) => prev.filter((p) => p.key !== it.key))}
                className="absolute right-1 top-1 inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--surface)] shadow-[var(--shadow-2)] [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10"
              >
                <IconClose className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-4">
          <Dropzone accept={tool.accept} multiple compact onFiles={intake} title="Add more images" buttonLabel="Add images" />
        </div>
        {rejections.map((r) => (
          <div key={r} className="mt-3">
            <Alert tone="danger">{r}</Alert>
          </div>
        ))}
      </div>

      <div className="card p-5 sm:p-7">
        <fieldset>
          <legend className="text-[1.35rem] font-semibold tracking-[-0.025em]">Convert to</legend>
          <div role="radiogroup" aria-label="Output format" className="mt-4 grid gap-3 sm:grid-cols-3">
            {TARGETS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={target === t.id}
                onClick={() => setTarget(t.id)}
                className="rounded-[var(--radius-md)] border border-[var(--line-strong)] bg-[var(--surface)] p-4 text-left transition-colors hover:border-[var(--ink)] aria-checked:border-[var(--ink)] aria-checked:bg-[var(--ink)] aria-checked:text-white"
              >
                <span className="block text-lg font-semibold tracking-[-0.02em]">{t.label}</span>
                <span className="mt-1 block text-sm opacity-75">{t.note}</span>
              </button>
            ))}
          </div>
        </fieldset>
        {allSame && <p className="mt-4 text-sm text-[var(--ink-2)]">These images are already {LABEL[target!]}. Choose a different format.</p>}
        <button type="button" onClick={run} disabled={!target || allSame} className="btn btn-primary btn-lg mt-6 w-full sm:w-auto">
          {target ? `Convert to ${LABEL[target]}` : "Choose a format"}
        </button>
      </div>
    </div>
  );
}
