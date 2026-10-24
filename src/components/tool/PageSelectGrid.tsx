"use client";

import { useEffect, useRef, useState } from "react";
import { IconCheck } from "@/components/icons";
import { PdfThumb, pdfDocFor } from "./PdfThumb";

/**
 * Pick pages by clicking their thumbnails. Each page is a checkbox; Shift-click selects a range
 * from the last page clicked.
 */
export function PageSelectGrid({
  file,
  pageCount,
  selected,
  onChange,
}: {
  file: File;
  pageCount: number;
  selected: Set<number>;
  onChange: (next: Set<number>) => void;
}) {
  const anchor = useRef<number | null>(null);

  function toggle(index: number, shift: boolean) {
    const next = new Set(selected);
    if (shift && anchor.current !== null) {
      const [a, b] = anchor.current < index ? [anchor.current, index] : [index, anchor.current];
      const on = !selected.has(index);
      for (let i = a; i <= b; i++) {
        if (on) next.add(i);
        else next.delete(i);
      }
    } else if (next.has(index)) next.delete(index);
    else next.add(index);
    anchor.current = index;
    onChange(next);
  }

  return (
    <ul className="grid grid-cols-2 gap-3 min-[480px]:grid-cols-3 sm:grid-cols-4 lg:grid-cols-6" aria-label="Pages">
      {Array.from({ length: pageCount }, (_, i) => {
        const on = selected.has(i);
        return (
          <li key={i}>
            <button
              type="button"
              role="checkbox"
              aria-checked={on}
              aria-label={`Page ${i + 1}`}
              onClick={(e) => toggle(i, e.shiftKey)}
              className={`group relative w-full rounded-[var(--radius-md)] border-2 p-2 text-left transition-[border-color,background-color] ${
                on ? "border-[var(--ink)] bg-[var(--surface)]" : "border-transparent bg-[var(--surface-2)] hover:border-[var(--line-strong)]"
              }`}
            >
              <PdfThumb file={file} pageIndex={i} width={150} alt="" className={`w-full transition-opacity ${on ? "" : "opacity-60"}`} />
              <span className="mt-2 flex items-center justify-between text-sm">
                <span className="tabular font-medium">{i + 1}</span>
                <span
                  aria-hidden="true"
                  className={`flex h-5 w-5 items-center justify-center rounded-[6px] border-[1.5px] ${
                    on ? "border-[var(--ink)] bg-[var(--ink)] text-white" : "border-[var(--line-strong)] bg-[var(--surface)]"
                  }`}
                >
                  {on && <IconCheck className="h-3.5 w-3.5" strokeWidth={2.4} />}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Loads a PDF's page count (pdf.js is fetched on first use). */
export async function countPages(file: File): Promise<number> {
  return (await pdfDocFor(file)).numPages;
}

/** Page count of the current PDF, or an error message if pdf.js can't open it. */
export function usePageCount(file: File | null): { count: number | null; error: string | null } {
  const [state, setState] = useState<{ file: File; count: number | null; error: string | null } | null>(null);
  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    countPages(file)
      .then((count) => !cancelled && setState({ file, count, error: null }))
      .catch(() => !cancelled && setState({ file, count: null, error: "This PDF couldn't be opened. It may be damaged or password-protected." }));
    return () => {
      cancelled = true;
    };
  }, [file]);
  if (!file || state?.file !== file) return { count: null, error: null };
  return { count: state.count, error: state.error };
}
