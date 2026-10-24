"use client";

import { useState } from "react";
import { Dropzone } from "@/components/tool/Dropzone";
import { Alert, StatGrid, Working } from "@/components/tool/Feedback";
import { SelectedFile } from "@/components/tool/SelectedFile";
import { PageSelectGrid, usePageCount } from "@/components/tool/PageSelectGrid";
import { ContinueWith } from "@/components/tool/ContinueWith";
import { useFileIntake } from "@/components/tool/useFileIntake";
import { IconArchive, IconDownload } from "@/components/icons";
import { getTool } from "@/lib/tools/registry";
import { downloadAllAsZip, triggerDownload } from "@/lib/download";
import { stripExtension } from "@/lib/format";
import { formatSize } from "@/lib/size";
import { describePages, parsePageList } from "@/lib/pages";

const tool = getTool("split-pdf");

type Mode = "extract" | "every";
type Phase = { name: "pick" } | { name: "working" } | { name: "done"; outputs: File[]; mode: Mode } | { name: "error"; message: string };

export function SplitPdfTool() {
  const [file, setFile] = useState<File | null>(null);
  const [selection, setSelection] = useState<{ file: File; pages: Set<number> } | null>(null);
  const [mode, setMode] = useState<Mode>("extract");
  const [rangeText, setRangeText] = useState("");
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ name: "pick" });
  const { count, error: openError } = usePageCount(file);
  const { intake, rejections } = useFileIntake(tool, (files) => {
    setFile(files[0]);
    setSelection(null);
    setRangeText("");
    setPhase({ name: "pick" });
  });

  const selected = selection?.file === file ? selection.pages : new Set<number>();
  const setSelected = (pages: Set<number>) => {
    if (!file) return;
    setSelection({ file, pages });
    setRangeError(null);
  };
  const base = file ? stripExtension(file.name).replace(/[^\w\- ]+/g, "").trim() || "document" : "document";

  function applyRange() {
    if (!count) return;
    const parsed = parsePageList(rangeText, count);
    if ("error" in parsed) setRangeError(parsed.error);
    else setSelected(new Set(parsed.pages));
  }

  async function run() {
    if (!file || !count) return;
    setPhase({ name: "working" });
    try {
      const pdf = await import("@/lib/processors/pdf");
      if (mode === "extract") {
        const pages = [...selected].sort((a, b) => a - b);
        const blob = await pdf.extractPages(file, pages.map((p) => p + 1).join(","));
        const label = describePages(pages).replace(/[ ,]+/g, "_");
        const name = `${base}-pages-${label.length <= 40 ? label : "selected"}.pdf`;
        setPhase({ name: "done", mode, outputs: [new File([blob], name, { type: "application/pdf" })] });
      } else {
        const parts = await pdf.splitPdfEveryNPages(file, 1);
        setPhase({ name: "done", mode, outputs: parts.map((p, i) => new File([p.blob], `${base}-page-${i + 1}.pdf`, { type: "application/pdf" })) });
      }
    } catch (e) {
      setPhase({ name: "error", message: e instanceof Error ? e.message : "This PDF couldn't be split." });
    }
  }

  function reset() {
    setFile(null);
    setPhase({ name: "pick" });
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
    return (
      <div className="mx-auto max-w-3xl">
        <Working label={mode === "extract" ? "Extracting pages…" : `Splitting into ${count} files…`} />
      </div>
    );
  }

  if (phase.name === "done") {
    const { outputs } = phase;
    const single = outputs.length === 1;
    return (
      <div className="mx-auto max-w-3xl space-y-6" data-testid="result">
        <div className="card overflow-hidden">
          <div className="bg-[var(--success-soft)] px-5 py-6 sm:px-7">
            <p role="status" className="text-2xl font-semibold tracking-[-0.03em] sm:text-[1.75rem]">
              {phase.mode === "extract" ? `Extracted ${selected.size} ${selected.size === 1 ? "page" : "pages"}` : `Split into ${outputs.length} PDFs`}
            </p>
            {phase.mode === "extract" && <p className="mt-1 text-[var(--ink-2)]">Pages {describePages([...selected].sort((a, b) => a - b))} of {count}</p>}
          </div>
          <div className="space-y-5 p-5 sm:p-7">
            <StatGrid
              stats={[
                { label: "Original", value: `${count} pages` },
                { label: single ? "New PDF" : "Files", value: single ? `${selected.size} pages` : String(outputs.length) },
                { label: "Original size", value: formatSize(file.size) },
                { label: single ? "New size" : "Total size", value: formatSize(outputs.reduce((n, o) => n + o.size, 0)) },
              ]}
            />
            <div className="flex flex-col gap-3 sm:flex-row">
              {single ? (
                <button type="button" className="btn btn-primary btn-lg" onClick={() => triggerDownload(outputs[0].name, outputs[0])}>
                  <IconDownload className="h-5 w-5" />
                  Download PDF
                </button>
              ) : (
                <button type="button" className="btn btn-primary btn-lg" onClick={() => downloadAllAsZip(`${base}-pages.zip`, outputs.map((o) => ({ name: o.name, blob: o })))}>
                  <IconArchive className="h-5 w-5" />
                  Download all (ZIP)
                </button>
              )}
              <button type="button" className="btn btn-secondary btn-lg" onClick={() => setPhase({ name: "pick" })}>
                Back to pages
              </button>
            </div>
          </div>
        </div>
        {single && <ContinueWith files={outputs} tools={["compress-pdf", "pdf-editor", "merge-pdf"]} />}
      </div>
    );
  }

  const canRun = count !== null && (mode === "every" ? count > 1 : selected.size > 0);

  return (
    <div className="space-y-6">
      <SelectedFile rules={tool} file={file} meta={count ? `${count} ${count === 1 ? "page" : "pages"}` : undefined} onChange={reset} />
      {(openError || phase.name === "error") && <Alert tone="danger">{openError ?? (phase.name === "error" ? phase.message : "")}</Alert>}

      {count !== null && (
        <>
          <div className="card space-y-5 p-5 sm:p-6">
            <div role="radiogroup" aria-label="How to split" className="grid gap-3 sm:grid-cols-2">
              {(
                [
                  { id: "extract", title: "Extract pages", body: "Pick pages below. They're saved together as one new PDF." },
                  { id: "every", title: "Split every page", body: `Each of the ${count} pages becomes its own PDF, in a ZIP.` },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={mode === m.id}
                  onClick={() => setMode(m.id)}
                  className="rounded-[var(--radius-md)] border border-[var(--line-strong)] bg-[var(--surface)] p-4 text-left transition-colors hover:border-[var(--ink)] aria-checked:border-[var(--ink)] aria-checked:bg-[var(--ink)] aria-checked:text-white"
                >
                  <span className="block text-lg font-semibold tracking-[-0.02em]">{m.title}</span>
                  <span className="mt-1 block text-sm opacity-75">{m.body}</span>
                </button>
              ))}
            </div>

            {mode === "extract" && (
              <div className="flex flex-col gap-4 border-t border-[var(--line)] pt-5 lg:flex-row lg:items-end lg:justify-between">
                <form
                  className="flex max-w-md flex-1 flex-col gap-1.5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    applyRange();
                  }}
                >
                  <label htmlFor="range" className="text-sm font-medium text-[var(--ink-2)]">
                    Or type pages
                  </label>
                  <div className="flex gap-2">
                    <input id="range" value={rangeText} onChange={(e) => setRangeText(e.target.value)} placeholder="e.g. 1-3, 7" className="field" aria-invalid={Boolean(rangeError) || undefined} />
                    <button type="submit" className="btn btn-secondary">
                      Select
                    </button>
                  </div>
                  {rangeError && <p className="text-sm text-[var(--danger)]">{rangeError}</p>}
                </form>
                <p className="text-sm text-[var(--ink-2)]" aria-live="polite">
                  {selected.size === 0 ? "No pages selected yet" : `${selected.size} selected: ${describePages([...selected].sort((a, b) => a - b))}`}
                </p>
              </div>
            )}

            <div className="flex justify-end border-t border-[var(--line)] pt-5">
              <button type="button" onClick={run} disabled={!canRun} className="btn btn-primary btn-lg w-full sm:w-auto">
                {mode === "every" ? `Split into ${count} PDFs` : selected.size === 0 ? "Select pages to extract" : `Extract ${selected.size} ${selected.size === 1 ? "page" : "pages"}`}
              </button>
            </div>
          </div>

          {mode === "extract" && <PageSelectGrid file={file} pageCount={count} selected={selected} onChange={setSelected} />}
        </>
      )}
      {count === null && !openError && <Working label="Opening your PDF…" />}
    </div>
  );
}
