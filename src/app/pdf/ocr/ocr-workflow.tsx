"use client";

import { useEffect, useRef, useState } from "react";
import { DropZone } from "@/components/tools/DropZone";
import { Field, FieldGrid, SelectField, CheckboxField } from "@/components/tools/fields";
import { Button } from "@/components/ui/Button";
import { ProcessingModeBadge } from "@/components/ui/Badge";
import { IconCheck, IconDownload, IconWarning, IconTrash } from "@/components/icons";
import { formatBytes } from "@/lib/format";
import { validateFileForTool, isOverRecommendedSize } from "@/lib/security/validators";
import { triggerDownload } from "@/lib/download";
import { getToolById } from "@/lib/tools/registry";
import {
  classifyPdfPages,
  createOcrSession,
  buildSearchablePdf,
  formatExtractedText,
  confidenceTier,
  SUPPORTED_OCR_LANGUAGES,
  type PageClassification,
  type OcrPageResult,
  type OcrSession,
} from "@/lib/processors/ocr";

const tool = getToolById("pdf-ocr")!;

type Stage = "empty" | "analyzing" | "ready" | "processing" | "done" | "error";

interface PageRowState {
  pageIndex: number;
  classification: PageClassification["classification"];
  selected: boolean;
  status: "pending" | "processing" | "done" | "error" | "skipped";
  result?: OcrPageResult;
  error?: string;
}

const CLASSIFICATION_LABEL: Record<PageClassification["classification"], string> = {
  native: "Has text",
  scanned: "Scanned",
  mixed: "Mostly scanned",
};

const CLASSIFICATION_CLASS: Record<PageClassification["classification"], string> = {
  native: "bg-[var(--surface-muted)] text-[var(--foreground-muted)]",
  scanned: "bg-[var(--brand-soft)] text-[var(--brand-strong)]",
  mixed: "bg-[var(--brand-soft)] text-[var(--brand-strong)]",
};

export function OcrWorkflow() {
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<Stage>("empty");
  const [error, setError] = useState<string | null>(null);
  const [pages, setPages] = useState<PageRowState[]>([]);

  const [lang, setLang] = useState("eng");
  const [enhance, setEnhance] = useState(false);
  const [quality, setQuality] = useState<"standard" | "accurate">("standard");
  const [rotate, setRotate] = useState<"0" | "90" | "180" | "270">("0");

  const [currentPageLabel, setCurrentPageLabel] = useState("");
  const [currentPageProgress, setCurrentPageProgress] = useState(0);
  const [overallDone, setOverallDone] = useState(0);

  const sessionRef = useRef<OcrSession | null>(null);
  const cancelRequestedRef = useRef(false);

  useEffect(() => {
    return () => {
      sessionRef.current?.terminate();
    };
  }, []);

  const addFile = async (files: File[]) => {
    const picked = files[0];
    if (!picked) return;
    setError(null);
    const validation = await validateFileForTool(picked, tool);
    if (!validation.valid) {
      setError(validation.error ?? "This file isn't supported.");
      return;
    }

    setFile(picked);
    setStage("analyzing");
    try {
      const classifications = await classifyPdfPages(picked);
      setPages(
        classifications.map((c) => ({
          pageIndex: c.pageIndex,
          classification: c.classification,
          selected: c.classification !== "native",
          status: "pending",
        }))
      );
      setStage("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "We couldn't read this PDF.");
      setStage("error");
    }
  };

  const reset = () => {
    sessionRef.current?.terminate();
    sessionRef.current = null;
    setFile(null);
    setStage("empty");
    setPages([]);
    setError(null);
    setOverallDone(0);
  };

  const toggleSelectAllScanned = () => {
    setPages((prev) => prev.map((p) => ({ ...p, selected: p.classification !== "native" })));
  };
  const toggleSelectAll = () => {
    setPages((prev) => prev.map((p) => ({ ...p, selected: true })));
  };

  const runOcr = async (retryPageIndices?: number[]) => {
    if (!file) return;
    const targets = retryPageIndices
      ? pages.filter((p) => retryPageIndices.includes(p.pageIndex))
      : pages.filter((p) => p.selected);
    if (targets.length === 0) return;

    cancelRequestedRef.current = false;
    setStage("processing");
    setOverallDone(0);
    setError(null);

    let session = sessionRef.current;
    if (!session) {
      try {
        session = await createOcrSession(lang);
        sessionRef.current = session;
      } catch (e) {
        setError(e instanceof Error ? e.message : "The OCR engine couldn't load.");
        setStage("error");
        return;
      }
    }

    setPages((prev) =>
      prev.map((p) => (targets.some((t) => t.pageIndex === p.pageIndex) ? { ...p, status: "processing" } : p))
    );

    let doneCount = 0;
    for (const target of targets) {
      if (cancelRequestedRef.current) break;

      setCurrentPageLabel(`Preparing page ${target.pageIndex + 1} of ${pages.length}`);
      setCurrentPageProgress(0);

      try {
        const result = await session.recognizePage(file, target.pageIndex + 1, {
          scale: quality === "accurate" ? 3 : 2,
          rotate: Number(rotate) as 0 | 90 | 180 | 270,
          enhance,
          onProgress: (fraction) => {
            setCurrentPageLabel(`Recognizing text on page ${target.pageIndex + 1} of ${pages.length}...`);
            setCurrentPageProgress(fraction);
          },
        });
        setPages((prev) =>
          prev.map((p) => (p.pageIndex === target.pageIndex ? { ...p, status: "done", result, error: undefined } : p))
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : `Recognition failed on page ${target.pageIndex + 1}.`;
        setPages((prev) =>
          prev.map((p) => (p.pageIndex === target.pageIndex ? { ...p, status: "error", error: message } : p))
        );
      }

      doneCount++;
      setOverallDone(doneCount);
      setCurrentPageLabel(`Page ${target.pageIndex + 1} of ${pages.length} complete`);
      setCurrentPageProgress(1);
    }

    setStage("done");
  };

  const cancel = () => {
    cancelRequestedRef.current = true;
  };

  const completedResults = pages.filter((p) => p.status === "done" && p.result).map((p) => p.result!);
  const lowConfidenceCount = completedResults.reduce((sum, r) => sum + r.lowConfidenceWordCount, 0);
  const failedPages = pages.filter((p) => p.status === "error");

  const downloadSearchablePdf = async () => {
    if (!file) return;
    const blob = await buildSearchablePdf(file, completedResults);
    triggerDownload(file.name.replace(/\.pdf$/i, "-searchable.pdf"), blob);
  };

  const copyAllText = async () => {
    await navigator.clipboard.writeText(formatExtractedText(completedResults));
  };

  const downloadTxt = () => {
    const text = formatExtractedText(completedResults);
    triggerDownload((file?.name.replace(/\.pdf$/i, "") ?? "document") + ".txt", new Blob([text], { type: "text/plain" }));
  };

  // ---------------------------------------------------------------- empty
  if (stage === "empty") {
    return (
      <div className="space-y-4">
        <DropZone accept=".pdf,application/pdf" onFiles={addFile} hint="or click to choose a scanned PDF" />
        {error && <ErrorBanner message={error} />}
        <ProcessingModeBadge mode={tool.processingMode} />
      </div>
    );
  }

  // ------------------------------------------------------------- analyzing
  if (stage === "analyzing") {
    return (
      <div className="card-surface flex flex-col items-center gap-4 p-12 text-center animate-fade-in">
        <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-[var(--border)] border-t-[var(--brand)]" />
        <p className="font-medium text-[var(--foreground)]">Checking which pages need OCR…</p>
        <p className="text-sm text-[var(--foreground-muted)]">Nothing is uploaded — this just reads the PDF locally.</p>
      </div>
    );
  }

  // ----------------------------------------------------------------- error
  if (stage === "error") {
    return (
      <div className="space-y-4">
        <ErrorBanner message={error ?? "Something went wrong."} />
        <Button variant="secondary" onClick={reset}>
          Try again
        </Button>
      </div>
    );
  }

  // ------------------------------------------------------------- processing
  if (stage === "processing") {
    return (
      <div className="card-surface flex flex-col items-center gap-4 p-12 text-center animate-fade-in">
        <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-[var(--border)] border-t-[var(--brand)]" />
        <p className="font-medium text-[var(--foreground)]">{currentPageLabel}</p>
        <div className="h-2 w-full max-w-xs overflow-hidden rounded-full bg-[var(--surface-muted)]">
          <div
            className="h-full rounded-full bg-[var(--brand)] transition-all duration-150"
            style={{ width: `${Math.round(currentPageProgress * 100)}%` }}
          />
        </div>
        <p className="text-sm text-[var(--foreground-muted)]">
          {overallDone} of {pages.filter((p) => p.status !== "pending" || p.selected).length || pages.length} pages processed. OCR
          runs on your device and may take a while for large documents.
        </p>
        <Button variant="secondary" onClick={cancel}>
          Cancel
        </Button>
      </div>
    );
  }

  // ------------------------------------------------------------------ done
  if (stage === "done") {
    return (
      <div className="space-y-5 animate-fade-in">
        <div className="card-surface flex flex-col items-center gap-3 p-10 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--accent-mint-soft)] text-[var(--accent-mint)]">
            <IconCheck className="h-6 w-6" />
          </div>
          <p className="text-lg font-semibold text-[var(--foreground)]">
            {completedResults.length > 0 ? "Recognition complete" : "No pages were recognized"}
          </p>
          <p className="text-sm text-[var(--foreground-muted)]">
            {completedResults.length} page{completedResults.length === 1 ? "" : "s"} recognized
            {failedPages.length > 0 ? `, ${failedPages.length} failed` : ""}.
            {lowConfidenceCount > 0 && ` ${lowConfidenceCount} word${lowConfidenceCount === 1 ? "" : "s"} may need review.`}
          </p>
        </div>

        {failedPages.length > 0 && (
          <div className="space-y-2">
            {failedPages.map((p) => (
              <div
                key={p.pageIndex}
                className="flex items-center justify-between rounded-[var(--radius-md)] bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
              >
                <span>
                  Page {p.pageIndex + 1}: {p.error ?? "Recognition failed."}
                </span>
                <button
                  onClick={() => runOcr([p.pageIndex])}
                  className="shrink-0 rounded-full bg-white px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-100 dark:bg-red-900 dark:text-red-200"
                >
                  Retry
                </button>
              </div>
            ))}
          </div>
        )}

        {completedResults.length > 0 && (
          <details className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4">
            <summary className="cursor-pointer text-sm font-medium text-[var(--foreground)]">
              Preview recognized text ({completedResults.length} page{completedResults.length === 1 ? "" : "s"})
            </summary>
            <div className="mt-3 max-h-64 space-y-3 overflow-y-auto text-sm text-[var(--foreground-muted)]">
              {completedResults
                .slice()
                .sort((a, b) => a.pageIndex - b.pageIndex)
                .map((r) => (
                  <div key={r.pageIndex}>
                    <p className="font-medium text-[var(--foreground)]">
                      Page {r.pageIndex + 1}{" "}
                      <span
                        className={`font-normal ${
                          confidenceTier(r.meanConfidence) === "high"
                            ? "text-[var(--accent-mint)]"
                            : confidenceTier(r.meanConfidence) === "medium"
                              ? "text-[var(--brand)]"
                              : "text-red-600 dark:text-red-400"
                        }`}
                      >
                        ({Math.round(r.meanConfidence)}% avg. confidence)
                      </span>
                    </p>
                    <p className="whitespace-pre-wrap">{r.text || "(no text recognized)"}</p>
                  </div>
                ))}
            </div>
          </details>
        )}

        <div className="flex flex-wrap gap-3">
          <Button disabled={completedResults.length === 0} onClick={downloadSearchablePdf}>
            <IconDownload className="h-4 w-4" />
            Download searchable PDF
          </Button>
          <Button variant="secondary" disabled={completedResults.length === 0} onClick={downloadTxt}>
            <IconDownload className="h-4 w-4" />
            Download TXT
          </Button>
          <Button variant="secondary" disabled={completedResults.length === 0} onClick={copyAllText}>
            Copy all text
          </Button>
          <Button variant="ghost" onClick={reset}>
            Process another file
          </Button>
        </div>

        <p className="text-xs text-[var(--foreground-muted)]">
          OCR editing is best for correcting individual words, values, and short text. Complex formatting, tables, and
          paragraph reflow may not match the original exactly.
        </p>
      </div>
    );
  }

  // ------------------------------------------------------------------ ready
  const scannedCount = pages.filter((p) => p.classification !== "native").length;
  const selectedCount = pages.filter((p) => p.selected).length;

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-[var(--foreground)]">{file?.name}</p>
          <p className="text-xs text-[var(--foreground-muted)]">{file && formatBytes(file.size)}</p>
        </div>
        <button
          onClick={reset}
          aria-label="Remove file"
          className="ml-3 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--foreground-muted)] hover:bg-[var(--surface-muted)] hover:text-red-500"
        >
          <IconTrash className="h-4 w-4" />
        </button>
      </div>

      {file && isOverRecommendedSize(file, tool) && (
        <div className="flex items-start gap-2 rounded-[var(--radius-md)] bg-[var(--brand-soft)] px-4 py-3 text-sm text-[var(--brand-strong)]">
          <IconWarning className="mt-0.5 h-4 w-4 shrink-0" />
          <span>OCR runs on your device and may take longer for large documents like this one.</span>
        </div>
      )}

      {scannedCount === 0 ? (
        <div className="flex items-start gap-2 rounded-[var(--radius-md)] bg-[var(--surface-muted)] px-4 py-3 text-sm text-[var(--foreground-muted)]">
          <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-mint)]" />
          <span>Every page already has selectable text. You can still run OCR on any page below if you want to.</span>
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-[var(--radius-md)] bg-[var(--brand-soft)] px-4 py-3 text-sm text-[var(--brand-strong)]">
          <IconWarning className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Scanned page{scannedCount === 1 ? "" : "s"} detected. No editable text was found on {scannedCount} page
            {scannedCount === 1 ? "" : "s"}.
          </span>
        </div>
      )}

      <FieldGrid>
        <Field label="Language">
          <SelectField
            value={lang}
            onChange={(v) => {
              setLang(v);
              sessionRef.current?.terminate();
              sessionRef.current = null;
            }}
            options={SUPPORTED_OCR_LANGUAGES.map((l) => ({ value: l.code, label: l.label }))}
          />
        </Field>
        <Field label="Quality">
          <SelectField
            value={quality}
            onChange={(v) => setQuality(v as "standard" | "accurate")}
            options={[
              { value: "standard", label: "Standard (faster)" },
              { value: "accurate", label: "High accuracy (slower)" },
            ]}
          />
        </Field>
        <Field label="Rotate before OCR" hint="Use if pages were scanned sideways">
          <SelectField
            value={rotate}
            onChange={(v) => setRotate(v as typeof rotate)}
            options={[
              { value: "0", label: "No rotation" },
              { value: "90", label: "90° clockwise" },
              { value: "180", label: "180°" },
              { value: "270", label: "270° clockwise" },
            ]}
          />
        </Field>
        <div className="flex items-end pb-2">
          <CheckboxField checked={enhance} onChange={setEnhance} label="Enhance scan (grayscale + contrast)" />
        </div>
      </FieldGrid>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-medium text-[var(--foreground)]">
            Pages ({selectedCount} of {pages.length} selected)
          </p>
          <div className="flex gap-3 text-xs font-medium text-[var(--brand)]">
            <button onClick={toggleSelectAllScanned} className="hover:underline">
              Select scanned pages
            </button>
            <button onClick={toggleSelectAll} className="hover:underline">
              Select all pages
            </button>
          </div>
        </div>
        <ul className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
          {pages.map((p) => (
            <li key={p.pageIndex}>
              <label className="flex cursor-pointer items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm">
                <span className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={p.selected}
                    onChange={(e) =>
                      setPages((prev) =>
                        prev.map((row) => (row.pageIndex === p.pageIndex ? { ...row, selected: e.target.checked } : row))
                      )
                    }
                    className="h-4 w-4 accent-[var(--brand)]"
                  />
                  Page {p.pageIndex + 1}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${CLASSIFICATION_CLASS[p.classification]}`}>
                  {CLASSIFICATION_LABEL[p.classification]}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </div>

      <Button disabled={selectedCount === 0} onClick={() => runOcr()}>
        Recognize {selectedCount} page{selectedCount === 1 ? "" : "s"}
      </Button>

      <div className="flex items-center gap-2 pt-1">
        <ProcessingModeBadge mode={tool.processingMode} />
      </div>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-[var(--radius-md)] bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
      <IconWarning className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}
