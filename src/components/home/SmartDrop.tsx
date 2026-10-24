"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Dropzone } from "@/components/tool/Dropzone";
import { ToolIcon } from "@/components/brand/ToolIcon";
import { IconArrowRight, IconClose, IconImage, IconPdf } from "@/components/icons";
import { setPendingFiles } from "@/lib/file-handoff";
import { DOCX_MIME, entryKindFor, entryKindForAll, getTool, suggestionsFor } from "@/lib/tools/registry";
import { formatSize } from "@/lib/size";

const ACCEPT = `.pdf,.docx,.doc,.jpg,.jpeg,.png,.webp,.svg,application/pdf,${DOCX_MIME},application/msword,image/jpeg,image/png,image/webp,image/svg+xml`;

/**
 * The homepage's one big entry point: drop any supported file and get the tools that fit it,
 * most likely first. The file is handed to the chosen tool in memory — it isn't picked twice.
 */
export function SmartDrop() {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const kind = entryKindForAll(files);
  const suggestions = files.length ? suggestionsFor(kind, files.length) : [];

  useEffect(() => {
    if (files.length) panelRef.current?.focus();
  }, [files]);

  function take(picked: File[]) {
    const kindsNow = new Set(picked.map(entryKindFor));
    const fail = (message: string) => {
      setProblem(message);
      setFiles([]);
    };
    if (picked.some((f) => /\.doc$/i.test(f.name))) return fail("Older .doc files (Word 97–2003) can't be converted yet. Save the document as .docx in Word, Google Docs or LibreOffice, then drop it here.");
    if (kindsNow.has("unsupported")) return fail("That file type isn't supported yet. TheFileConvert works with PDF, Word (.docx), JPG, PNG, WebP and SVG files.");
    if ((kindsNow.has("pdf") || kindsNow.has("word")) && kindsNow.size > 1) return fail("Drop one kind of file at a time — PDFs, Word documents and images go to different tools.");
    if (kindsNow.has("word") && picked.length > 1) return fail("Word to PDF converts one document at a time — drop a single .docx.");
    setProblem(null);
    setFiles(picked);
  }

  function open(href: string) {
    setPendingFiles(files);
    router.push(href);
  }

  if (files.length && suggestions.length) {
    const first = files[0];
    const isPdf = kind === "pdf";
    const isWord = kind === "word";
    return (
      <div ref={panelRef} tabIndex={-1} className="animate-sheet rounded-[var(--radius-xl)] border border-[var(--line)] bg-[var(--surface)] p-4 outline-none sm:p-6" aria-live="polite">
        <div className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--band)] p-2.5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-[var(--ink)] text-white shadow-[var(--shadow-button)]">
            {isWord ? (
              <span aria-hidden="true" className="text-base font-bold">
                W
              </span>
            ) : isPdf ? (
              <IconPdf className="h-5 w-5" />
            ) : (
              <IconImage className="h-5 w-5" />
            )}
          </span>
          <div className="min-w-0 flex-1 text-left">
            <p className="truncate font-semibold tracking-[-0.01em]">{files.length === 1 ? first.name : `${files.length} ${isPdf ? "PDFs" : "images"}`}</p>
            <p className="tabular text-sm text-[var(--ink-2)]">{formatSize(files.reduce((n, f) => n + f.size, 0))} · stays on this device</p>
          </div>
          <button type="button" onClick={() => setFiles([])} aria-label="Choose a different file" className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-[var(--surface-2)]">
            <IconClose className="h-5 w-5" />
          </button>
        </div>
        <p className="mt-5 text-left text-lg font-semibold tracking-[-0.02em]">What do you want to do?</p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {suggestions.map((id, i) => {
            const tool = getTool(id);
            return (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => open(tool.href)}
                  className={`group flex w-full items-center gap-3 rounded-[var(--radius-md)] border p-3 text-left transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-px ${
                    i === 0 ? "border-[var(--ink)] bg-[linear-gradient(180deg,#2e2d2a,var(--ink))] text-white shadow-[var(--shadow-button)]" : "border-[var(--line)] bg-[var(--surface)] hover:border-[var(--ink)] hover:shadow-[var(--shadow-2)]"
                  }`}
                >
                  <ToolIcon id={tool.id} category={tool.category} size="sm" />
                  <span className="flex-1 font-semibold tracking-[-0.01em]">{actionLabel(id, files.length)}</span>
                  <IconArrowRight className={`h-4 w-4 transition-transform group-hover:translate-x-0.5 ${i === 0 ? "text-white" : "text-[var(--ink-3)]"}`} />
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Dropzone accept={ACCEPT} multiple onFiles={take} title="Drop a PDF, Word file or image" buttonLabel="Choose file" hint="Files stay on your device" />
      {problem && (
        <p role="alert" className="text-sm font-medium text-[var(--danger)]">
          {problem}
        </p>
      )}
      <p className="pb-2 text-center text-sm text-[var(--ink-2)]">
        or{" "}
        <Link href="/tools" className="font-medium text-[var(--ink)] underline decoration-[var(--line-strong)] underline-offset-4 hover:decoration-[var(--ink)]">
          browse all tools
        </Link>
      </p>
    </div>
  );
}

function actionLabel(id: ReturnType<typeof suggestionsFor>[number], count: number): string {
  const labels: Record<typeof id, string> = {
    "compress-pdf": "Compress",
    "pdf-editor": "Edit",
    "pdf-to-word": "Convert to Word",
    "word-to-pdf": "Convert to PDF",
    "merge-pdf": count > 1 ? `Merge ${count} PDFs` : "Merge with other PDFs",
    "split-pdf": "Split",
    "pdf-to-image": "Convert to images",
    "organize-pdf": "Organize pages",
    "compress-image": "Compress",
    "convert-image": count > 1 ? `Convert ${count} images` : "Convert format",
    "image-to-pdf": count > 1 ? `Combine ${count} into a PDF` : "Make a PDF",
    "image-to-word": count > 1 ? `Put ${count} into Word` : "Put it in Word",
  };
  return labels[id];
}
