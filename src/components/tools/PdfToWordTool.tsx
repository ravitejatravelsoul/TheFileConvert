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
import type { PdfAnalysis, Progress } from "@/lib/processors/pdf-to-word";

const tool = getTool("pdf-to-word");

/** How long a stage may go without reporting anything before the user is told, and offered Retry / Cancel. */
const STALL_MS = { default: 30_000, recognition: 60_000 };

type Phase =
  | { name: "ready" }
  | { name: "working"; progress: Progress | null }
  | { name: "done"; output: File; pages: number; images: number; visualPages: number; editablePages: number; classes: string; strategies: string; ms: number }
  | { name: "error"; message: string };

export function PdfToWordTool() {
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<{ file: File; result: PdfAnalysis | null; error: string | null } | null>(null);
  const [phase, setPhase] = useState<Phase>({ name: "ready" });
  const resultRef = useRef<HTMLDivElement>(null);
  // A run that has been cancelled or replaced must not report back; and progress is watched for stalls.
  const runRef = useRef<{ id: number; abort: AbortController | null }>({ id: 0, abort: null });
  const lastProgressRef = useRef(0);
  const [stalled, setStalled] = useState(false);
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

  // Leaving the page stops a run in progress (its OCR worker is torn down), instead of leaving it working unseen.
  useEffect(() => {
    const run = runRef;
    return () => run.current.abort?.abort();
  }, []);

  // Stall watchdog: while converting, if no stage has reported for a while, say so — never leave a spinner unexplained.
  useEffect(() => {
    if (phase.name !== "working") return;
    const timer = setInterval(() => {
      const p = phase.progress;
      const override = (globalThis as { __TFC_STALL_MS?: number }).__TFC_STALL_MS; // tests shorten the wait
      const limit = override ?? (p && (p.stage === "ocr" || p.stage === "layout" || p.stage === "ocr-load") ? STALL_MS.recognition : STALL_MS.default);
      setStalled(Date.now() - lastProgressRef.current > limit);
    }, 1000);
    return () => clearInterval(timer);
  }, [phase]);

  /** Stops the current run (its result, if it still arrives, is ignored) and returns to the file. The file is kept. */
  function cancel() {
    runRef.current.abort?.abort();
    runRef.current = { id: runRef.current.id + 1, abort: null };
    setStalled(false);
    setPhase({ name: "ready" });
  }

  function retry() {
    cancel();
    void run();
  }

  async function run() {
    if (!file) return;
    const started = performance.now();
    const abort = new AbortController();
    const id = runRef.current.id + 1;
    runRef.current = { id, abort };
    const current = () => runRef.current.id === id && !abort.signal.aborted; // not replaced, not cancelled, not reset
    lastProgressRef.current = Date.now();
    setStalled(false);
    setPhase({ name: "working", progress: null });
    try {
      const { convertPdfToWord, DOCX_MIME } = await import("@/lib/processors/pdf-to-word");
      const result = await convertPdfToWord(file, {
        signal: abort.signal,
        onProgress: (progress) => {
          if (!current()) return;
          lastProgressRef.current = Date.now();
          setStalled(false);
          setPhase({ name: "working", progress });
        },
      });
      if (!current()) return;
      const output = new File([result.blob], withExtension(file.name, "docx"), { type: DOCX_MIME });
      setPhase({ name: "done", output, pages: result.pages, images: result.images, visualPages: result.visualPages, editablePages: result.editablePages, classes: result.pageReports.map((r) => r.cls).join(","), strategies: result.pageReports.map((r) => r.strategy).join(","), ms: performance.now() - started });
    } catch (e) {
      if (!current() || abort.signal.aborted) return; // cancelled or replaced: nothing to report
      setPhase({ name: "error", message: e instanceof Error && e.message ? e.message : "This PDF couldn't be converted." });
    }
  }

  function reset() {
    runRef.current.abort?.abort();
    runRef.current = { id: runRef.current.id + 1, abort: null };
    setStalled(false);
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
    // The engine's real stages, in order (no fake progress).
    const label = !p
      ? "Opening your PDF…"
      : p.stage === "reading"
        ? `Analyzing PDF — page ${p.page} of ${p.total}…`
        : p.stage === "preserve"
          ? `Preparing scanned page ${p.index} of ${p.total}…`
          : p.stage === "ocr-load"
            ? "Loading text recognition…"
            : p.stage === "layout"
              ? `Checking the layout of page ${p.index} of ${p.total}…`
              : p.stage === "ocr"
                ? `Recognizing page ${p.index} of ${p.total}…`
                : p.stage === "validating"
                  ? "Checking output…"
                  : "Building Word document…";
    const fraction = !p ? null : p.stage === "reading" ? (p.page - 1) / p.total : p.stage === "preserve" ? (p.index - 1) / p.total : p.stage === "ocr" ? (p.index - 1 + p.fraction) / p.total : p.stage === "layout" ? (p.index - 1) / p.total : null;
    return (
      <div className="mx-auto max-w-3xl">
        <Working
          label={label}
          fraction={fraction}
          detail={
            p?.stage === "ocr-load"
              ? "Only a plain scan of text needs this: it is read once to see whether it can become editable text. Otherwise it keeps its look."
              : p?.stage === "ocr" || p?.stage === "layout"
                ? "Reading a plain scan on this device to see whether it can become editable text. If it can't be read reliably, the page keeps its look."
                : "Everything happens in this tab. Nothing is uploaded."
          }
        />
        {stalled && (
          <div className="mt-4" data-testid="stalled">
            <Alert tone="warning">
              <p className="font-medium">This is taking longer than expected.</p>
              <p className="mt-1">Your file is safe and nothing was sent anywhere. You can keep waiting, retry, or cancel and go back to your file.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className="btn btn-secondary" onClick={retry}>
                  Retry
                </button>
                <button type="button" className="btn btn-ghost" onClick={cancel}>
                  Cancel
                </button>
              </div>
            </Alert>
          </div>
        )}
      </div>
    );
  }

  if (phase.name === "done") {
    return (
      <div ref={resultRef} className="mx-auto max-w-3xl scroll-mt-24 space-y-6" data-testid="result" data-page-classes={phase.classes} data-page-strategies={phase.strategies}>
        <div className="card overflow-hidden">
          <div className="relative overflow-hidden bg-[linear-gradient(135deg,var(--success-soft),#f1faf5)] px-5 py-6 sm:px-7">
            <span aria-hidden="true" className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-[var(--success)] text-white shadow-[var(--shadow-2)]">
              <IconCheck className="h-5 w-5" strokeWidth={2.6} />
            </span>
            <p role="status" className="text-2xl font-semibold tracking-[-0.03em] sm:text-[1.75rem]">
              Your Word document is ready
            </p>
            <p className="mt-1 text-[var(--ink-2)]">
              {phase.visualPages
                ? "Scanned pages keep the look of the original. Open it in Word, Google Docs, Pages or LibreOffice and check it against your PDF."
                : "Open it in Word, Google Docs, Pages or LibreOffice and check the layout — complex pages may need small touch-ups."}
            </p>
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
                  {phase.visualPages ? ` · ${phase.visualPages} kept as ${phase.visualPages === 1 ? "an image" : "images"} of the original` : ""}
                  {phase.editablePages && phase.visualPages ? ` · ${phase.editablePages} editable` : ""} · {(phase.ms / 1000).toFixed(1)} s
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
  const hasText = Boolean(info?.result && info.result.kinds.includes("text"));
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
          <p className="text-[1.35rem] font-semibold tracking-[-0.025em]">Convert to Word, keeping the document&rsquo;s appearance</p>
          <ul className="mt-4 space-y-2.5 text-[0.9375rem] leading-relaxed text-[var(--ink-2)]">
            {hasText && (
              <li className="flex gap-2.5">
                <IconInfo className="mt-1 h-4 w-4 shrink-0 text-[var(--ink)]" />
                <span>Pages with real text become editable Word content — text, headings, lists, tables and pictures, in the same layout where possible. Complex pages may need small formatting adjustments.</span>
              </li>
            )}
            {hasScans && (
              <li className="flex gap-2.5" data-testid="scan-note">
                <IconScan className="mt-1 h-4 w-4 shrink-0 text-[var(--ink)]" />
                <span>
                  Scanned pages, forms, IDs and certificates keep their original look: each page is placed in the Word file as an image, so signatures, stamps, photos, handwriting and filled-in values stay exactly as they are
                  {label === "Mixed PDF" ? " — pages that already have text are made editable." : "."}
                </span>
              </li>
            )}
            {hasScans && (
              <li className="flex gap-2.5">
                <IconInfo className="mt-1 h-4 w-4 shrink-0 text-[var(--ink)]" />
                <span>
                  Want the text of a scan to be searchable or editable? Use <Link href="/pdf-editor" className="font-medium text-[var(--ink)] underline decoration-[var(--line-strong)] underline-offset-4 hover:decoration-[var(--ink)]">Recognize text in the PDF Editor</Link>.
                </span>
              </li>
            )}
          </ul>
          <button type="button" onClick={run} className="btn btn-primary btn-lg mt-6">
            Convert to Word
          </button>
        </div>
      )}
    </div>
  );
}
