"use client";

import { useEffect, useRef, useState } from "react";
import { Dropzone } from "@/components/tool/Dropzone";
import { Alert, StatGrid, Working } from "@/components/tool/Feedback";
import { PdfThumb, pdfDocFor } from "@/components/tool/PdfThumb";
import { ContinueWith } from "@/components/tool/ContinueWith";
import { useFileIntake } from "@/components/tool/useFileIntake";
import { useReorder } from "@/components/tool/useReorder";
import { IconArrowDown, IconArrowUp, IconClose, IconDownload, IconGrip } from "@/components/icons";
import { getTool } from "@/lib/tools/registry";
import { triggerDownload } from "@/lib/download";
import { formatExact, formatSize } from "@/lib/size";

const tool = getTool("merge-pdf");

interface Item {
  key: string;
  file: File;
}
const keyOf = (i: Item) => i.key;
let seq = 0;

type Phase = { name: "pick" } | { name: "working" } | { name: "done"; output: File; pages: number } | { name: "error"; message: string };

export function MergePdfTool() {
  const [items, setItems] = useState<Item[]>([]);
  const [pageCounts, setPageCounts] = useState<Record<string, number | "error">>({});
  const [phase, setPhase] = useState<Phase>({ name: "pick" });
  const { intake, rejections } = useFileIntake(tool, (files) => {
    const added = files.map((file) => ({ key: `m${++seq}`, file }));
    setItems((prev) => [...prev, ...added]);
    setPhase({ name: "pick" });
  });
  const { setContainer, dragKey, start: startDrag, move } = useReorder(items, setItems, keyOf);

  // Page counts load as each file arrives (each file is asked for once).
  const requested = useRef(new Set<string>());
  useEffect(() => {
    for (const it of items) {
      if (requested.current.has(it.key)) continue;
      requested.current.add(it.key);
      pdfDocFor(it.file)
        .then((d) => setPageCounts((c) => ({ ...c, [it.key]: d.numPages })))
        .catch(() => setPageCounts((c) => ({ ...c, [it.key]: "error" })));
    }
  }, [items]);

  const unreadable = items.filter((i) => pageCounts[i.key] === "error");
  const totalPages = items.reduce((n, i) => n + (typeof pageCounts[i.key] === "number" ? (pageCounts[i.key] as number) : 0), 0);

  async function run() {
    setPhase({ name: "working" });
    try {
      const { mergePdfs } = await import("@/lib/processors/pdf");
      const blob = await mergePdfs(items.map((i) => i.file));
      setPhase({ name: "done", output: new File([blob], "merged.pdf", { type: "application/pdf" }), pages: totalPages });
    } catch (e) {
      setPhase({ name: "error", message: e instanceof Error ? e.message : "These PDFs couldn't be merged." });
    }
  }

  if (phase.name === "working") {
    return (
      <div className="mx-auto max-w-3xl">
        <Working label={`Merging ${items.length} PDFs…`} />
      </div>
    );
  }

  if (phase.name === "done") {
    const { output } = phase;
    return (
      <div className="mx-auto max-w-3xl space-y-6" data-testid="result">
        <div className="card overflow-hidden">
          <div className="bg-[var(--success-soft)] px-5 py-6 sm:px-7">
            <p role="status" className="text-2xl font-semibold tracking-[-0.03em] sm:text-[1.75rem]">
              Merged into one PDF
            </p>
            <p className="mt-1 text-[var(--ink-2)]">{items.map((i) => i.file.name).join(" + ")}</p>
          </div>
          <div className="space-y-5 p-5 sm:p-7">
            <StatGrid
              stats={[
                { label: "Files", value: String(items.length) },
                { label: "Pages", value: String(phase.pages) },
                { label: "Inputs", value: formatSize(items.reduce((n, i) => n + i.file.size, 0)) },
                { label: "Merged PDF", value: formatSize(output.size), exact: formatExact(output.size) },
              ]}
            />
            <div className="flex flex-col gap-3 sm:flex-row">
              <button type="button" className="btn btn-primary btn-lg" onClick={() => triggerDownload(output.name, output)}>
                <IconDownload className="h-5 w-5" />
                Download merged PDF
              </button>
              <button type="button" className="btn btn-secondary btn-lg" onClick={() => setPhase({ name: "pick" })}>
                Change order
              </button>
            </div>
          </div>
        </div>
        <ContinueWith files={[output]} tools={["compress-pdf", "organize-pdf", "pdf-editor"]} />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="space-y-4">
        <Dropzone accept={tool.accept} multiple onFiles={intake} title="Drop your PDFs here" buttonLabel="Choose PDFs" hint="Add two or more · stays on this device" />
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
      {phase.name === "error" && <Alert tone="danger">{phase.message}</Alert>}
      <div className="card p-4 sm:p-6">
        <p className="px-1 font-semibold tracking-[-0.01em]">
          {items.length} {items.length === 1 ? "file" : "files"}
          {totalPages > 0 && <span className="font-normal text-[var(--ink-2)]"> · {totalPages} pages in total · drag to reorder</span>}
        </p>
        <ol ref={setContainer} className="mt-4 space-y-3">
          {items.map((it, index) => {
            const pages = pageCounts[it.key];
            return (
              <li
                key={it.key}
                data-sort-key={it.key}
                  data-dragging={dragKey === it.key || undefined}
                  onPointerDown={(e) => startDrag(it.key, e, false)}
                className="flex select-none flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-3 transition-shadow data-[dragging]:relative data-[dragging]:z-10 data-[dragging]:shadow-[var(--shadow-3)] sm:gap-4 lg:cursor-grab"
              >
                <button type="button" aria-label={`Drag ${it.file.name}`} style={{ touchAction: "none" }} onPointerDown={(e) => startDrag(it.key, e, true)} className="inline-flex h-11 w-8 shrink-0 cursor-grab items-center justify-center rounded-lg text-[var(--ink-3)] hover:text-[var(--ink)] active:cursor-grabbing">
                  <IconGrip className="h-5 w-5" />
                </button>
                <span className="tabular w-5 shrink-0 text-sm font-semibold text-[var(--ink-2)]">{index + 1}</span>
                <PdfThumb file={it.file} pageIndex={0} width={56} alt="" className="w-12 shrink-0 sm:w-14" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold tracking-[-0.01em]" title={it.file.name}>
                    {it.file.name}
                  </p>
                  <p className="tabular text-sm text-[var(--ink-2)]">
                    {pages === "error" ? <span className="text-[var(--danger)]">Can&rsquo;t be read</span> : pages === undefined ? "Counting pages…" : `${pages} ${pages === 1 ? "page" : "pages"}`} · {formatSize(it.file.size)}
                  </p>
                </div>
                <div className="-mb-1 flex w-full shrink-0 items-center justify-end border-t border-[var(--line)] pt-1 sm:mb-0 sm:w-auto sm:border-0 sm:pt-0">
                  <button type="button" aria-label={`Move ${it.file.name} up`} disabled={index === 0} onClick={() => move(it.key, -1)} className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-[var(--surface-2)] disabled:opacity-30">
                    <IconArrowUp className="h-4 w-4" />
                  </button>
                  <button type="button" aria-label={`Move ${it.file.name} down`} disabled={index === items.length - 1} onClick={() => move(it.key, 1)} className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-[var(--surface-2)] disabled:opacity-30">
                    <IconArrowDown className="h-4 w-4" />
                  </button>
                  <button type="button" aria-label={`Remove ${it.file.name}`} onClick={() => setItems((prev) => prev.filter((p) => p.key !== it.key))} className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]">
                    <IconClose className="h-4 w-4" />
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
        <div className="mt-4">
          <Dropzone accept={tool.accept} multiple compact onFiles={intake} title="Add more PDFs" buttonLabel="Add PDFs" />
        </div>
        {rejections.map((r) => (
          <div key={r} className="mt-3">
            <Alert tone="danger">{r}</Alert>
          </div>
        ))}
      </div>

      {unreadable.length > 0 && (
        <Alert tone="danger" title={`${unreadable.length === 1 ? "One file" : `${unreadable.length} files`} can't be read`}>
          Remove {unreadable.map((u) => `“${u.file.name}”`).join(", ")} to continue — it may be damaged or password-protected.
        </Alert>
      )}

      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-end">
        {items.length < 2 && <p className="text-sm text-[var(--ink-2)]">Add at least one more PDF to merge.</p>}
        <button type="button" onClick={run} disabled={items.length < 2 || unreadable.length > 0} className="btn btn-primary btn-lg">
          Merge {items.length} PDFs
        </button>
      </div>
    </div>
  );
}
