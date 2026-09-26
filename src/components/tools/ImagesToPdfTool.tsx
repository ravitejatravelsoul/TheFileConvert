"use client";

import { useState } from "react";
import { Dropzone } from "@/components/tool/Dropzone";
import { Alert, StatGrid, Working } from "@/components/tool/Feedback";
import { ImageThumb } from "@/components/tool/FileThumb";
import { ContinueWith } from "@/components/tool/ContinueWith";
import { useFileIntake } from "@/components/tool/useFileIntake";
import { useReorder } from "@/components/tool/useReorder";
import { IconArrowLeft, IconArrowRight, IconClose, IconDownload, IconGrip } from "@/components/icons";
import { getTool } from "@/lib/tools/registry";
import { triggerDownload } from "@/lib/download";
import { formatExact, formatSize } from "@/lib/size";

const tool = getTool("image-to-pdf");

type PageSize = "fit" | "a4" | "letter";
const SIZES: { id: PageSize; label: string; note: string }[] = [
  { id: "fit", label: "Fit to image", note: "Each page is the size of its image" },
  { id: "a4", label: "A4", note: "Centered with a small margin" },
  { id: "letter", label: "Letter", note: "Centered with a small margin" },
];

interface Item {
  key: string;
  file: File;
}
const keyOf = (i: Item) => i.key;
let seq = 0;

export function ImagesToPdfTool() {
  const [items, setItems] = useState<Item[]>([]);
  const [size, setSize] = useState<PageSize>("fit");
  const [phase, setPhase] = useState<{ name: "pick" } | { name: "working"; label: string } | { name: "done"; output: File } | { name: "error"; message: string }>({ name: "pick" });
  const { intake, rejections } = useFileIntake(tool, (files) => {
    const added = files.map((file) => ({ key: `i${++seq}`, file }));
    setItems((prev) => [...prev, ...added]);
    setPhase({ name: "pick" });
  });
  const { setContainer, dragKey, start: startDrag, move } = useReorder(items, setItems, keyOf);

  async function run() {
    setPhase({ name: "working", label: "Preparing images…" });
    try {
      const [{ prepareImageForPdf }, { imagesToPdf }] = await Promise.all([import("@/lib/processors/image"), import("@/lib/processors/pdf")]);
      const prepared: File[] = [];
      for (const [i, it] of items.entries()) {
        setPhase({ name: "working", label: `Preparing image ${i + 1} of ${items.length}…` });
        prepared.push(await prepareImageForPdf(it.file));
      }
      setPhase({ name: "working", label: "Building your PDF…" });
      const blob = await imagesToPdf(prepared, { pageSize: size, margin: size === "fit" ? 0 : 24 });
      const name = items.length === 1 ? items[0].file.name.replace(/\.[^.]+$/, "") + ".pdf" : "images.pdf";
      setPhase({ name: "done", output: new File([blob], name, { type: "application/pdf" }) });
    } catch (e) {
      setPhase({ name: "error", message: e instanceof Error ? e.message : "The PDF couldn't be created." });
    }
  }

  if (phase.name === "working") {
    return (
      <div className="mx-auto max-w-3xl">
        <Working label={phase.label} />
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
              Your PDF is ready
            </p>
            <p className="mt-1 text-[var(--ink-2)]">
              {items.length} {items.length === 1 ? "page" : "pages"}, in the order you set.
            </p>
          </div>
          <div className="space-y-5 p-5 sm:p-7">
            <StatGrid
              stats={[
                { label: "Pages", value: String(items.length) },
                { label: "Page size", value: SIZES.find((s) => s.id === size)!.label },
                { label: "Images in", value: formatSize(items.reduce((n, i) => n + i.file.size, 0)) },
                { label: "PDF", value: formatSize(output.size), exact: formatExact(output.size) },
              ]}
            />
            <div className="flex flex-col gap-3 sm:flex-row">
              <button type="button" className="btn btn-primary btn-lg" onClick={() => triggerDownload(output.name, output)}>
                <IconDownload className="h-5 w-5" />
                Download PDF
              </button>
              <button type="button" className="btn btn-secondary btn-lg" onClick={() => setPhase({ name: "pick" })}>
                Edit order
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-lg"
                onClick={() => {
                  setItems([]);
                  setPhase({ name: "pick" });
                }}
              >
                New images
              </button>
            </div>
          </div>
        </div>
        <ContinueWith files={[output]} tools={["compress-pdf", "pdf-editor", "merge-pdf"]} />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="space-y-4">
        <Dropzone accept={tool.accept} multiple onFiles={intake} title="Drop your images here" buttonLabel="Choose images" hint="JPG, PNG or WebP · stays on this device" />
        {rejections.map((r) => (
          <Alert key={r} tone="danger">
            {r}
          </Alert>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {phase.name === "error" && <Alert tone="danger">{phase.message}</Alert>}
      <div className="card p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <p className="font-semibold tracking-[-0.01em]">
            {items.length} {items.length === 1 ? "image" : "images"} <span className="font-normal text-[var(--ink-2)]">· drag to set the page order</span>
          </p>
          <button type="button" onClick={() => setItems([])} className="btn btn-ghost btn-sm">
            Clear all
          </button>
        </div>
        <ol ref={setContainer} className="mt-5 grid grid-cols-2 gap-4 min-[520px]:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {items.map((it, index) => (
            <li
              key={it.key}
              data-sort-key={it.key}
                  data-dragging={dragKey === it.key || undefined}
                  onPointerDown={(e) => startDrag(it.key, e, false)}
              className="group relative select-none rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-2 transition-shadow data-[dragging]:z-10 data-[dragging]:scale-[1.02] data-[dragging]:shadow-[var(--shadow-3)] lg:cursor-grab lg:data-[dragging]:cursor-grabbing"
            >
              <ImageThumb file={it.file} alt={`Page ${index + 1}: ${it.file.name}`} className="aspect-[3/4] rounded-[8px]" />
              <div className="mt-2 flex items-center gap-1">
                <span className="tabular flex h-6 min-w-6 items-center justify-center rounded-full bg-[var(--ink)] px-1.5 text-xs font-semibold text-white">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-[var(--ink-2)]" title={it.file.name}>
                  {it.file.name}
                </span>
              </div>
              <div className="mt-1.5 flex items-center justify-between">
                <button type="button" aria-label={`Drag ${it.file.name}`} style={{ touchAction: "none" }} onPointerDown={(e) => startDrag(it.key, e, true)} className="inline-flex h-9 w-9 cursor-grab items-center justify-center rounded-full text-[var(--ink-2)] hover:bg-[var(--surface-2)] active:cursor-grabbing [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11">
                  <IconGrip className="h-5 w-5" />
                </button>
                <span className="flex">
                  <button type="button" aria-label={`Move ${it.file.name} earlier`} disabled={index === 0} onClick={() => move(it.key, -1)} className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-[var(--surface-2)] disabled:opacity-30 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11">
                    <IconArrowLeft className="h-4 w-4" />
                  </button>
                  <button type="button" aria-label={`Move ${it.file.name} later`} disabled={index === items.length - 1} onClick={() => move(it.key, 1)} className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-[var(--surface-2)] disabled:opacity-30 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11">
                    <IconArrowRight className="h-4 w-4" />
                  </button>
                </span>
              </div>
              <button
                type="button"
                aria-label={`Remove ${it.file.name}`}
                onClick={() => setItems((prev) => prev.filter((p) => p.key !== it.key))}
                className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--surface)] shadow-[var(--shadow-2)] [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10"
              >
                <IconClose className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ol>
        <div className="mt-4">
          <Dropzone accept={tool.accept} multiple compact onFiles={intake} title="Add more images" buttonLabel="Add images" />
        </div>
        {rejections.map((r) => (
          <div key={r} className="mt-3">
            <Alert tone="danger">{r}</Alert>
          </div>
        ))}
      </div>

      <div className="card flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-end lg:justify-between">
        <fieldset>
          <legend className="text-sm font-medium text-[var(--ink-2)]">Page size</legend>
          <div role="radiogroup" aria-label="Page size" className="mt-2 flex flex-wrap gap-2">
            {SIZES.map((s) => (
              <button key={s.id} type="button" role="radio" aria-checked={size === s.id} onClick={() => setSize(s.id)} className="chip" title={s.note}>
                {s.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-sm text-[var(--ink-2)]">{SIZES.find((s) => s.id === size)!.note}.</p>
        </fieldset>
        <button type="button" onClick={run} className="btn btn-primary btn-lg">
          Create PDF · {items.length} {items.length === 1 ? "page" : "pages"}
        </button>
      </div>
    </div>
  );
}
