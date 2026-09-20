"use client";

import { useEffect, useRef, useState } from "react";
import { FileWorkflow } from "@/components/tools/FileWorkflow";
import { Button } from "@/components/ui/Button";
import { getPdfPageCount, reorderPages } from "@/lib/processors/pdf";
import { loadPdfJsDocument, renderPageToCanvas } from "@/lib/processors/pdfjs-utils";
import { getToolById } from "@/lib/tools/registry";

const tool = getToolById("pdf-reorder")!;

/** Small page previews, so pages can be told apart by what's on them (not just their number).
 * Rendered one by one after the list appears; a page that fails simply keeps its number label. */
function usePageThumbnails(file: File, pageCount: number | null) {
  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  useEffect(() => {
    if (!pageCount) return;
    let cancelled = false;
    (async () => {
      try {
        const doc = await loadPdfJsDocument(file);
        for (let i = 0; i < pageCount && !cancelled; i++) {
          try {
            const canvas = await renderPageToCanvas(doc, i + 1, 0.3);
            if (!cancelled) setThumbs((t) => ({ ...t, [i]: canvas.toDataURL("image/jpeg", 0.6) }));
          } catch {
            // Thumbnail is a convenience only.
          }
        }
      } catch {
        // Same: the list still works without previews.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file, pageCount]);
  return thumbs;
}

function PageOrderEditor({ file, run }: { file: File; run: (h: (files: File[]) => Promise<{ name: string; blob: Blob }[]>) => void }) {
  const [order, setOrder] = useState<number[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  const dragFrom = useRef<number | null>(null);
  const thumbs = usePageThumbnails(file, order ? order.length : null);

  useEffect(() => {
    let cancelled = false;
    getPdfPageCount(file)
      .then((count) => {
        if (!cancelled) setOrder(Array.from({ length: count }, (_, i) => i));
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Couldn't read this PDF."));
    return () => {
      cancelled = true;
    };
  }, [file]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!order) return <p className="text-sm text-[var(--foreground-muted)]">Reading page count…</p>;

  const moveTo = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= order.length || to >= order.length) return;
    const next = [...order];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setOrder(next);
  };
  const changed = order.some((p, i) => p !== i);

  return (
    <div className="space-y-4 pt-2">
      <p className="text-sm text-[var(--foreground-muted)]">
        Drag a page to a new position, or use its arrows, then export. Pages are shown in the order they will have.
      </p>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {order.map((pageIndex, position) => (
          <li
            key={pageIndex}
            data-page={pageIndex + 1}
            draggable
            onDragStart={(e) => {
              dragFrom.current = position;
              setDragging(position);
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", String(position));
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              setDropTarget(position);
            }}
            onDragLeave={() => setDropTarget((t) => (t === position ? null : t))}
            onDrop={(e) => {
              e.preventDefault();
              const from = dragFrom.current;
              dragFrom.current = null;
              setDragging(null);
              setDropTarget(null);
              if (from !== null) moveTo(from, position);
            }}
            onDragEnd={() => {
              dragFrom.current = null;
              setDragging(null);
              setDropTarget(null);
            }}
            className={`cursor-grab rounded-[var(--radius-sm)] border bg-[var(--surface)] p-2 text-sm transition-colors ${
              dropTarget === position && dragging !== position ? "border-[var(--brand)] bg-[var(--brand-soft)]" : "border-[var(--border)]"
            } ${dragging === position ? "opacity-50" : ""}`}
          >
            <div className="flex aspect-[3/4] items-center justify-center overflow-hidden rounded bg-[var(--surface-muted)]">
              {thumbs[pageIndex] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={thumbs[pageIndex]} alt={`Preview of page ${pageIndex + 1}`} className="h-full w-full object-contain" draggable={false} />
              ) : (
                <span className="text-xs text-[var(--foreground-muted)]">…</span>
              )}
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span>
                <span className="font-medium">Page {pageIndex + 1}</span>
                {changed && <span className="ml-1 text-xs text-[var(--foreground-muted)]">→ #{position + 1}</span>}
              </span>
              <div className="flex gap-1">
                <button
                  type="button"
                  aria-label={`Move page ${pageIndex + 1} earlier`}
                  onClick={() => moveTo(position, position - 1)}
                  disabled={position === 0}
                  className="h-7 w-7 rounded text-[var(--foreground-muted)] hover:bg-[var(--surface-muted)] disabled:opacity-30 [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10"
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`Move page ${pageIndex + 1} later`}
                  onClick={() => moveTo(position, position + 1)}
                  disabled={position === order.length - 1}
                  className="h-7 w-7 rounded text-[var(--foreground-muted)] hover:bg-[var(--surface-muted)] disabled:opacity-30 [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10"
                >
                  ↓
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
      <Button onClick={() => run(async (f) => [{ name: "reordered.pdf", blob: await reorderPages(f[0], order) }])}>
        Export reordered PDF
      </Button>
    </div>
  );
}

export function ReorderWorkflow() {
  return (
    <FileWorkflow tool={tool} multiple={false}>
      {({ files, run }) => (files[0] ? <PageOrderEditor file={files[0]} run={run} /> : null)}
    </FileWorkflow>
  );
}
