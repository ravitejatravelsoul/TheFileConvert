"use client";

import { useEffect, useRef, useState } from "react";
import { loadPdfJsDocument, renderPageToCanvas } from "@/lib/processors/pdfjs-utils";
import { effectiveRotation, type EditorDocument, type EditorPage } from "@/lib/editor/types";
import type { EditorWorkspaceApi } from "./useEditorWorkspace";
import { IconTrash } from "@/components/icons";

interface ThumbnailRailProps {
  api: EditorWorkspaceApi;
  doc: EditorDocument;
  onInsertFile: (afterPageId: string) => void;
}

const THUMB_WIDTH = 110;

export function ThumbnailRail({ api, doc, onInsertFile }: ThumbnailRailProps) {
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

  return (
    <div className="flex h-full w-36 shrink-0 flex-col gap-2 overflow-y-auto border-r border-[var(--border)] bg-[var(--surface)] p-2">
      <p className="px-1 text-xs font-medium text-[var(--foreground-muted)]">
        {doc.pages.length} {doc.pages.length === 1 ? "page" : "pages"}
      </p>
      {doc.pages.map((page, index) => (
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
          className={`group relative rounded-[var(--radius-sm)] border-2 p-1 ${
            api.state.activePageId === page.id ? "border-[var(--brand)]" : "border-transparent"
          } ${dragOverId === page.id ? "bg-[var(--brand-soft)]" : ""}`}
        >
          <button
            type="button"
            onClick={() => api.setActivePageId(page.id)}
            aria-label={`Go to page ${index + 1}`}
            className="block w-full"
          >
            <PageThumbnail doc={doc} page={page} />
            <span className="mt-1 block text-center text-[11px] text-[var(--foreground-muted)]">{index + 1}</span>
          </button>

          <div className="absolute right-1 top-1 flex flex-col gap-1 lg:opacity-0 lg:transition-opacity lg:group-hover:opacity-100 lg:group-focus-within:opacity-100">
            <button
              type="button"
              onClick={() => api.rotatePage(page.id, 90)}
              title="Rotate clockwise"
              aria-label={`Rotate page ${index + 1} clockwise`}
              className="h-6 w-6 rounded-full bg-white/90 text-xs shadow"
            >
              ⟳
            </button>
            <button
              type="button"
              onClick={() => api.rotatePage(page.id, -90)}
              title="Rotate counter-clockwise"
              aria-label={`Rotate page ${index + 1} counter-clockwise`}
              className="h-6 w-6 rounded-full bg-white/90 text-xs shadow"
            >
              ⟲
            </button>
          </div>

          <div className="mt-1 flex flex-wrap items-center justify-center gap-1 lg:opacity-0 lg:transition-opacity lg:group-hover:opacity-100 lg:group-focus-within:opacity-100">
            <button
              type="button"
              onClick={() => moveBy(page.id, -1)}
              disabled={index === 0}
              title="Move page up"
              aria-label={`Move page ${index + 1} up`}
              className="rounded-full px-1.5 py-0.5 text-[10px] text-[var(--foreground-muted)] hover:bg-[var(--surface-muted)] disabled:opacity-30"
            >
              ↑
            </button>
            <button
              type="button"
              onClick={() => moveBy(page.id, 1)}
              disabled={index === doc.pages.length - 1}
              title="Move page down"
              aria-label={`Move page ${index + 1} down`}
              className="rounded-full px-1.5 py-0.5 text-[10px] text-[var(--foreground-muted)] hover:bg-[var(--surface-muted)] disabled:opacity-30"
            >
              ↓
            </button>
            <button
              type="button"
              onClick={() => api.duplicatePage(page.id)}
              title="Duplicate page"
              aria-label={`Duplicate page ${index + 1}`}
              className="rounded-full px-1.5 py-0.5 text-[10px] text-[var(--foreground-muted)] hover:bg-[var(--surface-muted)]"
            >
              Copy
            </button>
            <button
              type="button"
              onClick={() => onInsertFile(page.id)}
              title="Insert pages after this one"
              aria-label={`Insert pages after page ${index + 1}`}
              className="rounded-full px-1.5 py-0.5 text-[10px] text-[var(--foreground-muted)] hover:bg-[var(--surface-muted)]"
            >
              Insert
            </button>
            <button
              type="button"
              onClick={() => api.deletePage(page.id)}
              title="Delete page"
              aria-label={`Delete page ${index + 1}`}
              className="rounded-full p-1 text-[var(--foreground-muted)] hover:bg-red-50 hover:text-red-600"
            >
              <IconTrash className="h-3 w-3" />
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() => api.insertBlankPage(doc.pages[doc.pages.length - 1]?.id)}
        className="rounded-[var(--radius-sm)] border border-dashed border-[var(--border)] py-3 text-xs text-[var(--foreground-muted)] hover:border-[var(--brand)] hover:text-[var(--brand)]"
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
      canvas.className = "w-full h-auto rounded-[2px] shadow-sm";
      hostRef.current.appendChild(canvas);
    })();
    return () => {
      cancelled = true;
    };
  }, [doc, page, page.rotationDelta]);

  return <div ref={hostRef} className="flex min-h-[80px] items-center justify-center bg-[var(--surface-muted)]" />;
}
