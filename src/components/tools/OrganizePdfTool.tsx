"use client";

import { useState } from "react";
import { Dropzone } from "@/components/tool/Dropzone";
import { Alert, StatGrid, Working } from "@/components/tool/Feedback";
import { SelectedFile } from "@/components/tool/SelectedFile";
import { PdfThumb } from "@/components/tool/PdfThumb";
import { usePageCount } from "@/components/tool/PageSelectGrid";
import { ContinueWith } from "@/components/tool/ContinueWith";
import { useFileIntake } from "@/components/tool/useFileIntake";
import { useReorder } from "@/components/tool/useReorder";
import { IconArrowLeft, IconArrowRight, IconCopy, IconDownload, IconGrip, IconRestore, IconRotateCcw, IconRotateCw, IconTrash } from "@/components/icons";
import { getTool } from "@/lib/tools/registry";
import { triggerDownload } from "@/lib/download";
import { safeOutputName } from "@/lib/format";
import { formatExact, formatSize } from "@/lib/size";
import type { PagePlan } from "@/lib/processors/pdf";

const tool = getTool("organize-pdf");

interface PageItem {
  key: string;
  index: number;
  rotate: 0 | 90 | 180 | 270;
  deleted: boolean;
}
const keyOf = (p: PageItem) => p.key;
let seq = 0;

const turn = (r: PageItem["rotate"], by: 90 | -90): PageItem["rotate"] => ((((r + by) % 360) + 360) % 360) as PageItem["rotate"];

type Phase = { name: "edit" } | { name: "working" } | { name: "done"; output: File; pages: number } | { name: "error"; message: string };

export function OrganizePdfTool() {
  const [file, setFile] = useState<File | null>(null);
  const [layout, setLayout] = useState<{ file: File; pages: PageItem[] } | null>(null);
  const [phase, setPhase] = useState<Phase>({ name: "edit" });
  const { count, error: openError } = usePageCount(file);
  const { intake, rejections } = useFileIntake(tool, (files) => {
    setFile(files[0]);
    setLayout(null);
    setPhase({ name: "edit" });
  });

  // The page list starts as the document's own order once its page count is known.
  const pages: PageItem[] =
    layout?.file === file ? layout.pages : count ? Array.from({ length: count }, (_, i) => ({ key: `p${i}`, index: i, rotate: 0, deleted: false })) : [];
  const setPages = (next: PageItem[]) => file && setLayout({ file, pages: next });
  const update = (key: string, patch: (p: PageItem) => Partial<PageItem>) => setPages(pages.map((p) => (p.key === key ? { ...p, ...patch(p) } : p)));
  const { setContainer, dragKey, start: startDrag, move } = useReorder(pages, setPages, keyOf);

  const kept = pages.filter((p) => !p.deleted);
  const changed = pages.some((p, i) => p.deleted || p.rotate !== 0 || p.index !== i) || pages.length !== count;

  async function save() {
    if (!file) return;
    setPhase({ name: "working" });
    try {
      const { buildPdfFromPages } = await import("@/lib/processors/pdf");
      const plan: PagePlan[] = kept.map((p) => ({ index: p.index, rotate: p.rotate }));
      const blob = await buildPdfFromPages(file, plan);
      setPhase({ name: "done", pages: plan.length, output: new File([blob], safeOutputName(file.name, "organized", "pdf"), { type: "application/pdf" }) });
    } catch (e) {
      setPhase({ name: "error", message: e instanceof Error ? e.message : "The PDF couldn't be saved." });
    }
  }

  function reset() {
    setFile(null);
    setLayout(null);
    setPhase({ name: "edit" });
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
        <Working label="Saving your PDF…" />
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
              Your organized PDF is ready
            </p>
          </div>
          <div className="space-y-5 p-5 sm:p-7">
            <StatGrid
              stats={[
                { label: "Pages before", value: String(count) },
                { label: "Pages now", value: String(phase.pages) },
                { label: "Rotated", value: String(kept.filter((p) => p.rotate).length) },
                { label: "Size", value: formatSize(output.size), exact: formatExact(output.size) },
              ]}
            />
            <div className="flex flex-col gap-3 sm:flex-row">
              <button type="button" className="btn btn-primary btn-lg" onClick={() => triggerDownload(output.name, output)}>
                <IconDownload className="h-5 w-5" />
                Download PDF
              </button>
              <button type="button" className="btn btn-secondary btn-lg" onClick={() => setPhase({ name: "edit" })}>
                Keep editing
              </button>
            </div>
          </div>
        </div>
        <ContinueWith files={[output]} tools={["compress-pdf", "pdf-editor", "merge-pdf"]} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SelectedFile file={file} meta={count ? `${count} ${count === 1 ? "page" : "pages"}` : undefined} onChange={reset} />
      {(openError || phase.name === "error") && <Alert tone="danger">{openError ?? (phase.name === "error" ? phase.message : "")}</Alert>}
      {count === null && !openError && <Working label="Opening your PDF…" />}

      {count !== null && (
        <>
          <div className="sticky top-16 z-20 -mx-1 flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)]/95 p-3 shadow-[var(--shadow-2)] backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between sm:p-4">
            <p className="px-1 text-sm text-[var(--ink-2)]" aria-live="polite">
              <span className="font-semibold text-[var(--ink)]">{kept.length}</span> of {pages.length} pages kept · drag to reorder
            </p>
            <div className="flex gap-2">
              <button type="button" className="btn btn-ghost" disabled={!changed} onClick={() => setLayout(null)}>
                Reset
              </button>
              <button type="button" className="btn btn-primary flex-1 sm:flex-none" disabled={kept.length === 0 || !changed} onClick={save}>
                <IconDownload className="h-4 w-4" />
                Save PDF
              </button>
            </div>
          </div>
          {kept.length === 0 && <Alert tone="warning">Every page is deleted. Restore at least one page to save.</Alert>}

          <ol ref={setContainer} className="grid grid-cols-2 gap-3 min-[520px]:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {pages.map((p, position) => {
              const label = `Page ${p.index + 1}`;
              return (
                <li
                  key={p.key}
                  data-sort-key={p.key}
                  data-dragging={dragKey === p.key || undefined}
                  onPointerDown={(e) => startDrag(p.key, e, false)}
                  aria-label={`${label}${p.deleted ? " (deleted)" : ""}${p.rotate ? `, rotated ${p.rotate}°` : ""}, position ${position + 1}`}
                  className={`relative flex select-none flex-col rounded-[var(--radius-md)] border bg-[var(--surface)] p-2 transition-[box-shadow,opacity] data-[dragging]:z-10 data-[dragging]:shadow-[var(--shadow-3)] lg:cursor-grab ${
                    p.deleted ? "border-dashed border-[var(--line-strong)] opacity-55" : "border-[var(--line)]"
                  }`}
                >
                  <div className="relative">
                    <PdfThumb file={file} pageIndex={p.index} rotation={p.rotate} width={160} boxAspect={0.8} alt={label} className="w-full rounded-[6px] bg-[var(--surface-2)] p-1.5" />
                    {p.deleted && (
                      <span className="absolute inset-0 flex items-center justify-center">
                        <span className="rounded-full bg-[var(--ink)] px-3 py-1 text-xs font-semibold text-white">Deleted</span>
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-1">
                    <button type="button" aria-label={`Drag ${label}`} style={{ touchAction: "none" }} onPointerDown={(e) => startDrag(p.key, e, true)} className="inline-flex h-10 w-8 cursor-grab items-center justify-center rounded-lg text-[var(--ink-3)] hover:text-[var(--ink)] active:cursor-grabbing [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11">
                      <IconGrip className="h-5 w-5" />
                    </button>
                    <span className="tabular text-sm font-semibold">{p.index + 1}</span>
                    <span className="w-8 [@media(pointer:coarse)]:w-11" />
                  </div>
                  <div className="mt-1 grid grid-cols-4 gap-0.5 border-t border-[var(--line)] pt-1.5">
                    {p.deleted ? (
                      <button type="button" onClick={() => update(p.key, () => ({ deleted: false }))} aria-label={`Restore ${label}`} className="col-span-4 inline-flex h-11 items-center justify-center gap-1.5 rounded-lg text-sm font-semibold hover:bg-[var(--surface-2)]">
                        <IconRestore className="h-4 w-4" />
                        Restore
                      </button>
                    ) : (
                      <>
                        <ToolBtn label={`Rotate ${label} left`} onClick={() => update(p.key, (q) => ({ rotate: turn(q.rotate, -90) }))}>
                          <IconRotateCcw className="h-4 w-4" />
                        </ToolBtn>
                        <ToolBtn label={`Rotate ${label} right`} onClick={() => update(p.key, (q) => ({ rotate: turn(q.rotate, 90) }))}>
                          <IconRotateCw className="h-4 w-4" />
                        </ToolBtn>
                        <ToolBtn
                          label={`Duplicate ${label}`}
                          onClick={() => {
                            const at = pages.findIndex((q) => q.key === p.key);
                            const copy = { ...p, key: `d${++seq}` };
                            setPages([...pages.slice(0, at + 1), copy, ...pages.slice(at + 1)]);
                          }}
                        >
                          <IconCopy className="h-4 w-4" />
                        </ToolBtn>
                        <ToolBtn label={`Delete ${label}`} danger onClick={() => update(p.key, () => ({ deleted: true }))}>
                          <IconTrash className="h-4 w-4" />
                        </ToolBtn>
                      </>
                    )}
                  </div>
                  {/* Keyboard reordering: hidden until focused, then shown under the card's tools. */}
                  <div className="sr-only focus-within:not-sr-only focus-within:mt-1 focus-within:flex focus-within:justify-between">
                    <button type="button" className="inline-flex h-11 w-11 items-center justify-center rounded-lg hover:bg-[var(--surface-2)]" onClick={() => move(p.key, -1)} disabled={position === 0} aria-label={`Move ${label} earlier`}>
                      <IconArrowLeft className="h-4 w-4" />
                    </button>
                    <button type="button" className="inline-flex h-11 w-11 items-center justify-center rounded-lg hover:bg-[var(--surface-2)]" onClick={() => move(p.key, 1)} disabled={position === pages.length - 1} aria-label={`Move ${label} later`}>
                      <IconArrowRight className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </div>
  );
}

function ToolBtn({ label, onClick, danger, children }: { label: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label.replace(/ Page \d+/, "")}
      className={`inline-flex h-11 items-center justify-center rounded-lg transition-colors ${danger ? "hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]" : "hover:bg-[var(--surface-2)]"}`}
    >
      {children}
    </button>
  );
}
