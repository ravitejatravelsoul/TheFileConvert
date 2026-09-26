"use client";

import { useState } from "react";
import { Dropzone } from "@/components/tool/Dropzone";
import { Alert, Working } from "@/components/tool/Feedback";
import { SelectedFile } from "@/components/tool/SelectedFile";
import { ImageThumb } from "@/components/tool/FileThumb";
import { PageSelectGrid, usePageCount } from "@/components/tool/PageSelectGrid";
import { ContinueWith } from "@/components/tool/ContinueWith";
import { useFileIntake } from "@/components/tool/useFileIntake";
import { IconArchive, IconDownload } from "@/components/icons";
import { getTool } from "@/lib/tools/registry";
import { downloadAllAsZip, triggerDownload } from "@/lib/download";
import { stripExtension } from "@/lib/format";
import { formatSize } from "@/lib/size";

const tool = getTool("pdf-to-image");
/** 2× the PDF's own size ≈ 144 DPI: sharp on screens, fine for most printing. */
const RENDER_SCALE = 2;

type Format = "jpeg" | "png";

export function PdfToImageTool() {
  const [file, setFile] = useState<File | null>(null);
  const [selection, setSelection] = useState<{ file: File; pages: Set<number> } | null>(null);
  const [format, setFormat] = useState<Format>("jpeg");
  const [phase, setPhase] = useState<"pick" | "working" | "done" | "error">("pick");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [outputs, setOutputs] = useState<File[]>([]);
  const { count, error: openError } = usePageCount(file);
  const { intake, rejections } = useFileIntake(tool, (files) => {
    setFile(files[0]);
    setSelection(null);
    setPhase("pick");
  });

  // All pages start selected; the selection resets when a different file is opened.
  const selected = selection?.file === file ? selection.pages : new Set(Array.from({ length: count ?? 0 }, (_, i) => i));
  const setSelected = (pages: Set<number>) => file && setSelection({ file, pages });

  async function run() {
    if (!file || selected.size === 0) return;
    const pages = [...selected].sort((a, b) => a - b);
    setPhase("working");
    setProgress({ done: 0, total: pages.length });
    try {
      const { pdfToImages } = await import("@/lib/processors/pdf");
      const blobs = await pdfToImages(file, format, RENDER_SCALE, {
        pages,
        baseName: stripExtension(file.name).replace(/[^\w\- ]+/g, "").trim() || "document",
        onPage: (done, total) => setProgress({ done, total }),
      });
      setOutputs(blobs.map((b) => new File([b.blob], b.name, { type: b.blob.type })));
      setPhase("done");
    } catch {
      setPhase("error");
    }
  }

  function reset() {
    setFile(null);
    setOutputs([]);
    setPhase("pick");
  }

  if (!file) {
    return (
      <div className="space-y-4">
        <Dropzone accept={tool.accept} onFiles={intake} title="Drop your PDF here" buttonLabel="Choose PDF" hint="Your PDF stays on this device" />
        {rejections.map((r) => (
          <Alert key={r} tone="danger">
            {r}
          </Alert>
        ))}
      </div>
    );
  }

  if (phase === "working") {
    return (
      <div className="mx-auto max-w-3xl">
        <Working label={`Rendering page ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`} fraction={progress.total ? progress.done / progress.total : null} />
      </div>
    );
  }

  if (phase === "done") {
    const label = format === "jpeg" ? "JPG" : "PNG";
    return (
      <div className="space-y-6" data-testid="result">
        <div className="card overflow-hidden">
          <div className="flex flex-col gap-4 bg-[var(--success-soft)] px-5 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-7">
            <p role="status" className="text-2xl font-semibold tracking-[-0.03em] sm:text-[1.75rem]">
              {outputs.length} {outputs.length === 1 ? "page" : "pages"} saved as {label}
            </p>
            <div className="flex flex-wrap gap-3">
              {outputs.length > 1 ? (
                <button type="button" className="btn btn-primary btn-lg" onClick={() => downloadAllAsZip(`${stripExtension(file.name)}-images.zip`, outputs.map((o) => ({ name: o.name, blob: o })))}>
                  <IconArchive className="h-5 w-5" />
                  Download all (ZIP)
                </button>
              ) : (
                <button type="button" className="btn btn-primary btn-lg" onClick={() => triggerDownload(outputs[0].name, outputs[0])}>
                  <IconDownload className="h-5 w-5" />
                  Download {label}
                </button>
              )}
              <button type="button" className="btn btn-secondary btn-lg" onClick={() => setPhase("pick")}>
                Back to pages
              </button>
            </div>
          </div>
          <ul className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-3 sm:p-7 lg:grid-cols-5">
            {outputs.map((o) => (
              <li key={o.name} className="min-w-0">
                <ImageThumb file={o} alt={o.name} className="aspect-[3/4] rounded-[var(--radius-sm)] border border-[var(--line)] p-2" />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <p className="min-w-0 text-sm">
                    <span className="block truncate font-medium">{o.name}</span>
                    <span className="tabular text-[var(--ink-2)]">{formatSize(o.size)}</span>
                  </p>
                  <button type="button" onClick={() => triggerDownload(o.name, o)} aria-label={`Download ${o.name}`} className="btn btn-ghost btn-sm shrink-0 px-2.5">
                    <IconDownload className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <ContinueWith files={outputs} tools={["image-to-pdf", "compress-image"]} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SelectedFile file={file} meta={count ? `${count} ${count === 1 ? "page" : "pages"}` : undefined} onChange={reset} />
      {(openError || phase === "error") && <Alert tone="danger">{openError ?? "Some pages couldn't be rendered. The PDF may be damaged."}</Alert>}
      {count !== null && (
        <>
          <div className="card flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div role="radiogroup" aria-label="Image format" className="flex gap-2">
              {(["jpeg", "png"] as const).map((f) => (
                <button key={f} type="button" role="radio" aria-checked={format === f} onClick={() => setFormat(f)} className="chip">
                  {f === "jpeg" ? "JPG" : "PNG"}
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <p className="text-sm text-[var(--ink-2)]" aria-live="polite">
                {selected.size} of {count} selected ·{" "}
                <button type="button" className="font-medium text-[var(--ink)] underline underline-offset-4" onClick={() => setSelected(new Set(selected.size === count ? [] : Array.from({ length: count }, (_, i) => i)))}>
                  {selected.size === count ? "Clear" : "Select all"}
                </button>
              </p>
              <button type="button" onClick={run} disabled={selected.size === 0} className="btn btn-primary btn-lg">
                {selected.size === count ? `Convert all ${count} pages` : `Convert ${selected.size} ${selected.size === 1 ? "page" : "pages"}`}
              </button>
            </div>
          </div>
          <PageSelectGrid file={file} pageCount={count} selected={selected} onChange={setSelected} />
        </>
      )}
      {count === null && !openError && <Working label="Opening your PDF…" />}
    </div>
  );
}
