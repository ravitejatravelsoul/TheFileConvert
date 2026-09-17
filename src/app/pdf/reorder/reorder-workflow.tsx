"use client";

import { useEffect, useState } from "react";
import { FileWorkflow } from "@/components/tools/FileWorkflow";
import { Button } from "@/components/ui/Button";
import { getPdfPageCount, reorderPages } from "@/lib/processors/pdf";
import { getToolById } from "@/lib/tools/registry";

const tool = getToolById("pdf-reorder")!;

function PageOrderEditor({ file, run }: { file: File; run: (h: (files: File[]) => Promise<{ name: string; blob: Blob }[]>) => void }) {
  const [order, setOrder] = useState<number[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target], next[index]];
    setOrder(next);
  };

  return (
    <div className="space-y-4 pt-2">
      <p className="text-sm text-[var(--foreground-muted)]">
        Use the arrows to reorder pages, then export.
      </p>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {order.map((pageIndex, position) => (
          <li
            key={pageIndex}
            className="flex items-center justify-between rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          >
            <span>Page {pageIndex + 1}</span>
            <div className="flex gap-1">
              <button
                type="button"
                aria-label="Move earlier"
                onClick={() => move(position, -1)}
                disabled={position === 0}
                className="h-6 w-6 rounded text-[var(--foreground-muted)] hover:bg-[var(--surface-muted)] disabled:opacity-30"
              >
                ↑
              </button>
              <button
                type="button"
                aria-label="Move later"
                onClick={() => move(position, 1)}
                disabled={position === order.length - 1}
                className="h-6 w-6 rounded text-[var(--foreground-muted)] hover:bg-[var(--surface-muted)] disabled:opacity-30"
              >
                ↓
              </button>
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
