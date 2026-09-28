"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Dropzone } from "@/components/tool/Dropzone";
import { Alert, Working } from "@/components/tool/Feedback";
import { SelectedFile } from "@/components/tool/SelectedFile";
import { useFileIntake } from "@/components/tool/useFileIntake";
import { IconCheck, IconDownload, IconInfo, IconScan } from "@/components/icons";
import { getTool } from "@/lib/tools/registry";
import { triggerDownload } from "@/lib/download";
import { withExtension } from "@/lib/format";
import { formatSize } from "@/lib/size";
import { SUPPORTED_OCR_LANGUAGES } from "@/lib/processors/ocr-languages";
import type { PdfAnalysis, Progress } from "@/lib/processors/pdf-to-word";

const tool = getTool("pdf-to-word");

type Phase =
  | { name: "ready" }
  | { name: "working"; progress: Progress | null }
  | { name: "done"; output: File; pages: number; images: number; scannedPages: number; ms: number }
  | { name: "error"; message: string };

export function PdfToWordTool() {
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<{ file: File; result: PdfAnalysis | null; error: string | null } | null>(null);
  const [phase, setPhase] = useState<Phase>({ name: "ready" });
  const [lang, setLang] = useState("eng");
  const resultRef = useRef<HTMLDivElement>(null);
  const { intake, rejections } = useFileIntake(tool, (files) => {
    setFile(files[0]);
    setPhase({ name: "ready" });
  });

  // A quick look inside: page count and whether the pages are text, scans or both.
  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    (async () => {
      try {
        const { analyzePdf } = await import("@/lib/processors/pdf-to-word");
        const result = await analyzePdf(file);
        if (!cancelled) setAnalysis({ file, result, error: null });
      } catch (e) {
        if (!cancelled) setAnalysis({ file, result: null, error: e instanceof Error ? e.message : "This PDF couldn't be read." });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file]);

  const info = analysis?.file === file ? analysis : null;

  // Bring the finished result into view (clear of the sticky header) — on a phone the page was left
  // scrolled to wherever the progress card sat.
  useEffect(() => {
    if (phase.name === "done") resultRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [phase.name]);

  async function run() {
    if (!file) return;
    const started = performance.now();
    setPhase({ name: "working", progress: null });
    try {
      const { convertPdfToWord, DOCX_MIME } = await import("@/lib/processors/pdf-to-word");
      const result = await convertPdfToWord(file, { ocrLang: lang, onProgress: (progress) => setPhase({ name: "working", progress }) });
      const output = new File([result.blob], withExtension(file.name, "docx"), { type: DOCX_MIME });
      setPhase({ name: "done", output, pages: result.pages, images: result.images, scannedPages: result.scannedPages, ms: performance.now() - started });
    } catch (e) {
      setPhase({ name: "error", message: e instanceof Error && e.message ? e.message : "This PDF couldn't be converted." });
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
        <Dropzone accept={tool.accept} onFiles={intake} title="Drop your PDF here" buttonLabel="Choose PDF" hint="Your PDF stays on this device" />
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
    const label = !p
      ? "Opening your PDF…"
      : p.stage === "reading"
        ? `Reading page ${p.page} of ${p.total}…`
        : p.stage === "ocr"
          ? `Recognizing page ${p.index} of ${p.total}…`
          : "Building your Word document…";
    const fraction = !p ? null : p.stage === "reading" ? (p.page - 1) / p.total : p.stage === "ocr" ? (p.index - 1 + p.fraction) / p.total : null;
    return (
      <div className="mx-auto max-w-3xl">
        <Working label={label} fraction={fraction} detail={p?.stage === "ocr" ? "Scanned pages are read with OCR on this device — the first run downloads a small recognition model." : "Everything happens in this tab. Nothing is uploaded."} />
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
              Your Word document is ready
            </p>
            <p className="mt-1 text-[var(--ink-2)]">Open it in Word, Google Docs, Pages or LibreOffice and check the layout — complex pages may need small touch-ups.</p>
          </div>
          <div className="space-y-5 p-5 sm:p-7">
            <div className="flex items-center gap-4 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--band)] p-3">
              <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-[#2b579a] text-lg font-bold text-white shadow-[var(--shadow-2)]">
                W
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold tracking-[-0.01em]">{phase.output.name}</p>
                <p className="tabular text-sm text-[var(--ink-2)]" data-testid="docx-size">
                  {formatSize(phase.output.size)} · {phase.pages} {phase.pages === 1 ? "page" : "pages"}
                  {phase.images ? ` · ${phase.images} ${phase.images === 1 ? "picture" : "pictures"}` : ""}
                  {phase.scannedPages ? ` · ${phase.scannedPages} recognized with OCR` : ""} · {(phase.ms / 1000).toFixed(1)} s
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <button type="button" className="btn btn-primary btn-lg" onClick={() => triggerDownload(phase.output.name, phase.output)}>
                <IconDownload className="h-5 w-5" />
                Download .docx
              </button>
              <button type="button" className="btn btn-ghost btn-lg" onClick={reset}>
                Convert another PDF
              </button>
            </div>
          </div>
        </div>
        <p className="text-sm text-[var(--ink-2)]">
          Edited it and need a PDF again?{" "}
          <Link href="/word-to-pdf" className="font-medium text-[var(--ink)] underline decoration-[var(--line-strong)] underline-offset-4 hover:decoration-[var(--ink)]">
            Word to PDF
          </Link>
        </p>
      </div>
    );
  }

  const label = info?.result?.label;
  const hasScans = Boolean(info?.result && info.result.kinds.includes("scanned"));
  const meta = info?.result ? `${info.result.pages} ${info.result.pages === 1 ? "page" : "pages"} · ${label}` : undefined;
  const openError = info?.error ?? null;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <SelectedFile rules={tool} file={file} meta={meta} onChange={reset} />
      {openError && <Alert tone="danger">{openError}</Alert>}
      {phase.name === "error" && <Alert tone="danger">{phase.message}</Alert>}
      {!info && <Working label="Opening your PDF…" />}
      {info?.result && (
        <div className="card p-5 sm:p-7">
          <p className="text-[1.35rem] font-semibold tracking-[-0.025em]">Convert to an editable Word document</p>
          <ul className="mt-4 space-y-2.5 text-[0.9375rem] leading-relaxed text-[var(--ink-2)]">
            <li className="flex gap-2.5">
              <IconInfo className="mt-1 h-4 w-4 shrink-0 text-[var(--ink)]" />
              <span>We preserve text, headings, paragraphs, images and common layout where possible. Complex PDFs may require small formatting adjustments.</span>
            </li>
            {hasScans && (
              <li className="flex gap-2.5" data-testid="ocr-note">
                <IconScan className="mt-1 h-4 w-4 shrink-0 text-[var(--ink)]" />
                <span>
                  Scanned pages will be recognized with OCR before creating the Word document
                  {label === "Mixed PDF" ? " — pages that already have text are used as they are." : "."}
                </span>
              </li>
            )}
          </ul>
          {hasScans && (
            <label className="mt-5 flex max-w-xs flex-col gap-1.5 text-sm font-medium">
              Language of the scanned text
              <select value={lang} onChange={(e) => setLang(e.target.value)} className="field">
                {SUPPORTED_OCR_LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="button" onClick={run} className="btn btn-primary btn-lg mt-6">
            Convert to Word
          </button>
        </div>
      )}
    </div>
  );
}
