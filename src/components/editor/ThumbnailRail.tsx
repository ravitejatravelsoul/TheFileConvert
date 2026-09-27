"use client";

import { useEffect, useRef, useState } from "react";
import { loadPdfJsDocument, renderPageToCanvas } from "@/lib/processors/pdfjs-utils";
import { effectiveRotation, type EditorDocument, type EditorPage } from "@/lib/editor/types";
import type { EditorWorkspaceApi } from "./useEditorWorkspace";
import { IconArrowDown, IconArrowUp, IconCopy, IconPlus, IconRotateCcw, IconRotateCw, IconTrash } from "@/components/icons";

interface ThumbnailRailProps {
  api: EditorWorkspaceApi;
  doc: EditorDocument;
  onInsertFile: (afterPageId: string) => void;
  /** "rail": one column (desktop sidebar). "grid": two columns (phone sheet). */
  layout?: "rail" | "grid";
}

const THUMB_WIDTH = 120;

export function ThumbnailRail({ api, doc, onInsertFile, layout = "rail" }: ThumbnailRailProps) {
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const draggedIdRef = useRef<string | null>(null);

  function handleDrop(targetId: string) {
    const draggedId = draggedIdRef.current;
    setDragOverId(null);
    if (!draggedId || draggedId === targetId) return;
    const ids = doc.pages.map((p) => p.id);
    const fromIndex = ids.indexOf(draggedId);
    const toIndex = ids.indexOf(targetId);
    if (fromIndex === -1 || toIndex === -1) return;
    ids.splice(fromIndex, 1);
    ids.splice(toIndex, 0, draggedId);
    api.reorderPageList(ids);
  }

  /** Moves a page one position up (-1) or down (+1) — the touch/keyboard alternative to dragging. */
  function moveBy(pageId: string, delta: -1 | 1) {
    const ids = doc.pages.map((p) => p.id);
    const from = ids.indexOf(pageId);
    const to = from + delta;
    if (from === -1 || to < 0 || to >= ids.length) return;
    ids.splice(from, 1);
    ids.splice(to, 0, pageId);
    api.reorderPageList(ids);
  }

  const small = "inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--ink-2)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)] disabled:opacity-30 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11";

  return (
    <div className={`h-full overflow-y-auto p-3 ${layout === "grid" ? "grid grid-cols-2 content-start gap-3" : "flex flex-col gap-3"}`}>
      <p className={`px-1 text-xs font-medium text-[var(--ink-2)] ${layout === "grid" ? "col-span-2" : ""}`}>
        {doc.pages.length} {doc.pages.length === 1 ? "page" : "pages"}
      </p>
      {doc.pages.map((page, index) => {
        const active = api.state.activePageId === page.id;
        return (
          <div
            key={page.id}
            draggable
            onDragStart={() => {
              draggedIdRef.current = page.id;
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverId(page.id);
            }}
            onDragLeave={() => setDragOverId((id) => (id === page.id ? null : id))}
            onDrop={(e) => {
              e.preventDefault();
              handleDrop(page.id);
            }}
            className={`group relative rounded-[var(--radius-md)] border-2 p-1.5 transition-[background-color,border-color,box-shadow] duration-200 ${active ? "border-[var(--ink)] bg-[var(--surface)] shadow-[var(--shadow-2)]" : "border-transparent hover:bg-[var(--surface)] hover:shadow-[var(--shadow-1)]"} ${
              dragOverId === page.id ? "bg-[var(--accent-soft)]" : ""
            }`}
          >
            <button type="button" onClick={() => api.setActivePageId(page.id)} aria-label={`Go to page ${index + 1}`} aria-current={active ? "page" : undefined} className="block w-full">
              <PageThumbnail doc={doc} page={page} />
              <span className="tabular mt-1 block text-center text-xs font-medium text-[var(--ink-2)]">{index + 1}</span>
            </button>

            <div className="mt-1 flex flex-wrap items-center justify-center gap-0.5 lg:opacity-0 lg:transition-opacity lg:group-hover:opacity-100 lg:group-focus-within:opacity-100">
              <button type="button" onClick={() => api.rotatePage(page.id, -90)} title="Rotate counter-clockwise" aria-label={`Rotate page ${index + 1} counter-clockwise`} className={small}>
                <IconRotateCcw className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => api.rotatePage(page.id, 90)} title="Rotate clockwise" aria-label={`Rotate page ${index + 1} clockwise`} className={small}>
                <IconRotateCw className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => moveBy(page.id, -1)} disabled={index === 0} title="Move page up" aria-label={`Move page ${index + 1} up`} className={small}>
                <IconArrowUp className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => moveBy(page.id, 1)} disabled={index === doc.pages.length - 1} title="Move page down" aria-label={`Move page ${index + 1} down`} className={small}>
                <IconArrowDown className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => api.duplicatePage(page.id)} title="Duplicate page" aria-label={`Duplicate page ${index + 1}`} className={small}>
                <IconCopy className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => onInsertFile(page.id)} title="Insert pages from a PDF after this one" aria-label={`Insert pages after page ${index + 1}`} className={small}>
                <IconPlus className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => api.deletePage(page.id)} title="Delete page" aria-label={`Delete page ${index + 1}`} className={`${small} hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]`}>
                <IconTrash className="h-4 w-4" />
              </button>
            </div>
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => api.insertBlankPage(doc.pages[doc.pages.length - 1]?.id)}
        className={`min-h-11 rounded-[var(--radius-sm)] border border-dashed border-[var(--line-strong)] py-3 text-xs font-medium text-[var(--ink-2)] hover:border-[var(--ink)] hover:text-[var(--ink)] ${layout === "grid" ? "col-span-2" : ""}`}
      >
        + Blank page
      </button>
    </div>
  );
}

function PageThumbnail({ doc, page }: { doc: EditorDocument; page: EditorPage }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const file = doc.sourceFiles[page.sourceFileId];
    if (!file) return;
    (async () => {
      const pdfDoc = await loadPdfJsDocument(file);
      if (cancelled) return;
      const width = page.mediaBox[2] - page.mediaBox[0];
      const rotated = effectiveRotation(page) === 90 || effectiveRotation(page) === 270;
      const baseWidth = rotated ? page.mediaBox[3] - page.mediaBox[1] : width;
      const scale = THUMB_WIDTH / Math.max(1, baseWidth);
      const canvas = await renderPageToCanvas(pdfDoc, page.sourcePageIndex + 1, scale, effectiveRotation(page));
      if (cancelled || !hostRef.current) return;
      hostRef.current.innerHTML = "";
      canvas.className = "w-full h-auto rounded-[2px] bg-white shadow-[0_0_0_1px_var(--line)]";
      hostRef.current.appendChild(canvas);
    })();
    return () => {
      cancelled = true;
    };
  }, [doc, page, page.rotationDelta]);

  return <div ref={hostRef} className="flex min-h-[80px] items-center justify-center rounded-[4px] bg-[var(--surface-2)]" />;
}
