"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Dropzone } from "@/components/tool/Dropzone";
import { Alert, Working } from "@/components/tool/Feedback";
import { SelectedFile } from "@/components/tool/SelectedFile";
import { ContinueWith } from "@/components/tool/ContinueWith";
import { useFileIntake } from "@/components/tool/useFileIntake";
import { IconCheck, IconDownload, IconInfo, IconPdf } from "@/components/icons";
import { getTool } from "@/lib/tools/registry";
import { triggerDownload } from "@/lib/download";
import { withExtension } from "@/lib/format";
import { formatSize } from "@/lib/size";
import type { Progress } from "@/lib/processors/word-to-pdf";

const tool = getTool("word-to-pdf");

type Phase =
  | { name: "ready" }
  | { name: "working"; progress: Progress | null }
  | { name: "done"; output: File; pages: number; pictures: number; notes: string[]; ms: number }
  | { name: "error"; message: string };

export function WordToPdfTool() {
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<{ file: File; pages: number | null; error: string | null } | null>(null);
  const [phase, setPhase] = useState<Phase>({ name: "ready" });
  const resultRef = useRef<HTMLDivElement>(null);
  const { intake, rejections } = useFileIntake(tool, (files) => {
    setFile(files[0]);
    setPhase({ name: "ready" });
  });

  // Open the package once to catch damaged, password-protected or non-Word files before converting.
  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    (async () => {
      try {
        const { countPages } = await import("@/lib/processors/word-to-pdf");
        const pages = await countPages({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
        if (!cancelled) setAnalysis({ file, pages, error: null });
      } catch (e) {
        if (!cancelled) setAnalysis({ file, pages: null, error: e instanceof Error ? e.message : "This Word document couldn't be read." });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file]);

  const info = analysis?.file === file ? analysis : null;

  useEffect(() => {
    if (phase.name === "done") resultRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [phase.name]);

  async function run() {
    if (!file) return;
    const started = performance.now();
    setPhase({ name: "working", progress: null });
    try {
      const { convertWordToPdf, browserImageDecoder } = await import("@/lib/processors/word-to-pdf");
      const result = await convertWordToPdf(
        { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) },
        { decodeImage: browserImageDecoder, onProgress: (progress) => setPhase({ name: "working", progress }) },
      );
      const output = new File([result.blob], withExtension(file.name, "pdf"), { type: "application/pdf" });
      setPhase({ name: "done", output, pages: result.pages, pictures: result.pictures, notes: result.notes, ms: performance.now() - started });
    } catch (e) {
      setPhase({ name: "error", message: e instanceof Error && e.message ? e.message : "This Word document couldn't be converted." });
    }
  }

  function reset() {
    setFile(null);
    setAnalysis(null);
    setPhase({ name: "ready" });
  }

  if (!file) {
    return (
      <div className="space-y-4">
        <Dropzone accept={tool.accept} onFiles={intake} title="Drop your Word document here" buttonLabel="Choose Word file" hint="Your document stays on this device" />
        {rejections.map((r) => (
          <Alert key={r} tone="danger">
            {r}
          </Alert>
        ))}
      </div>
    );
  }

  if (phase.name === "working") {
    const p = phase.progress;
    const label = !p || p.stage === "reading" ? "Reading your document…" : p.stage === "fonts" ? "Loading fonts…" : p.stage === "layout" ? "Laying out pages…" : `Drawing page ${p.page} of ${p.total}…`;
    const fraction = p?.stage === "drawing" ? p.page / p.total : null;
    return (
      <div className="mx-auto max-w-3xl">
        <Working label={label} fraction={fraction} detail="Everything happens in this tab. Nothing is uploaded." />
      </div>
    );
  }

  if (phase.name === "done") {
    return (
      <div ref={resultRef} className="mx-auto max-w-3xl scroll-mt-24 space-y-6" data-testid="result">
        <div className="card overflow-hidden">
          <div className="relative overflow-hidden bg-[linear-gradient(135deg,var(--success-soft),#f1faf5)] px-5 py-6 sm:px-7">
            <span aria-hidden="true" className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-[var(--success)] text-white shadow-[var(--shadow-2)]">
              <IconCheck className="h-5 w-5" strokeWidth={2.6} />
            </span>
            <p role="status" className="text-2xl font-semibold tracking-[-0.03em] sm:text-[1.75rem]">
              Your PDF is ready
            </p>
            <p className="mt-1 text-[var(--ink-2)]">Check it before you send it — complex Word layouts may vary slightly from Microsoft Word.</p>
          </div>
          <div className="space-y-5 p-5 sm:p-7">
            <div className="flex items-center gap-4 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--band)] p-3">
              <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-[linear-gradient(180deg,#34332f,var(--ink))] text-white shadow-[var(--shadow-2)]">
                <IconPdf className="h-6 w-6" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold tracking-[-0.01em]">{phase.output.name}</p>
                <p className="tabular text-sm text-[var(--ink-2)]" data-testid="pdf-size">
                  {formatSize(phase.output.size)} · {phase.pages} {phase.pages === 1 ? "page" : "pages"}
                  {phase.pictures ? ` · ${phase.pictures} ${phase.pictures === 1 ? "picture" : "pictures"}` : ""} · {(phase.ms / 1000).toFixed(1)} s
                </p>
              </div>
            </div>
            {phase.notes.length > 0 && (
              <ul className="space-y-2 text-[0.9375rem] leading-relaxed text-[var(--ink-2)]" data-testid="notes">
                {phase.notes.map((n) => (
                  <li key={n} className="flex gap-2.5">
                    <IconInfo className="mt-1 h-4 w-4 shrink-0 text-[var(--ink)]" />
                    <span>{n}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-col gap-3 sm:flex-row">
              <button type="button" className="btn btn-primary btn-lg" onClick={() => triggerDownload(phase.output.name, phase.output)}>
                <IconDownload className="h-5 w-5" />
                Download PDF
              </button>
              <button type="button" className="btn btn-ghost btn-lg" onClick={reset}>
                Convert another document
              </button>
            </div>
          </div>
        </div>
        <ContinueWith files={[phase.output]} tools={["compress-pdf", "pdf-editor", "merge-pdf"]} />
        <p className="text-sm text-[var(--ink-2)]">
          Need editable text from a PDF?{" "}
          <Link href="/pdf-to-word" className="font-medium text-[var(--ink)] underline decoration-[var(--line-strong)] underline-offset-4 hover:decoration-[var(--ink)]">
            PDF to Word
          </Link>
        </p>
      </div>
    );
  }

  const meta = info && !info.error ? (info.pages ? `Word document · ${info.pages} ${info.pages === 1 ? "page" : "pages"}` : "Word document") : undefined;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <SelectedFile rules={tool} file={file} meta={meta} onChange={reset} />
      {info?.error && <Alert tone="danger">{info.error}</Alert>}
      {phase.name === "error" && <Alert tone="danger">{phase.message}</Alert>}
      {!info && <Working label="Opening your document…" />}
      {info && !info.error && (
        <div className="card p-5 sm:p-7">
          <p className="text-[1.35rem] font-semibold tracking-[-0.025em]">Convert to PDF</p>
          <ul className="mt-4 space-y-2.5 text-[0.9375rem] leading-relaxed text-[var(--ink-2)]">
            <li className="flex gap-2.5">
              <IconInfo className="mt-1 h-4 w-4 shrink-0 text-[var(--ink)]" />
              <span>Convert Word documents to PDF while preserving common formatting, images, lists and tables.</span>
            </li>
            <li className="flex gap-2.5">
              <IconInfo className="mt-1 h-4 w-4 shrink-0 text-[var(--ink)]" />
              <span>Complex Word layouts may vary slightly from Microsoft Word.</span>
            </li>
          </ul>
          <button type="button" onClick={run} className="btn btn-primary btn-lg mt-6">
            Convert to PDF
          </button>
        </div>
      )}
    </div>
  );
}
