"use client";

import type { EditorWorkspaceApi, ToolId } from "./useEditorWorkspace";
import { IconDownload } from "@/components/icons";

interface ToolbarProps {
  api: EditorWorkspaceApi;
  onRequestImage: () => void;
  onRequestSign: () => void;
  onExport: () => void;
}

const TOOLS: { id: ToolId; label: string }[] = [
  { id: "select", label: "Select" },
  { id: "add-text", label: "Text" },
  { id: "highlight", label: "Highlight" },
  { id: "underline", label: "Underline" },
  { id: "strikethrough", label: "Strike" },
  { id: "draw", label: "Draw" },
  { id: "shape-rectangle", label: "Rectangle" },
  { id: "shape-ellipse", label: "Ellipse" },
  { id: "shape-line", label: "Line" },
  { id: "shape-arrow", label: "Arrow" },
  { id: "whiteout", label: "Whiteout" },
  { id: "crop", label: "Crop" },
];

export function Toolbar({ api, onRequestImage, onRequestSign, onExport }: ToolbarProps) {
  const { state } = api;

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2">
      <div className="flex flex-wrap items-center gap-1" role="toolbar" aria-label="Editing tools">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => api.setActiveTool(t.id)}
            aria-pressed={state.activeTool === t.id}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              state.activeTool === t.id
                ? "bg-[var(--brand)] text-white"
                : "text-[var(--foreground-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
            }`}
          >
            {t.label}
          </button>
        ))}
        <button
          type="button"
          onClick={onRequestImage}
          className="rounded-full px-3 py-1.5 text-xs font-medium text-[var(--foreground-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
        >
          Image
        </button>
        <button
          type="button"
          onClick={onRequestSign}
          className="rounded-full px-3 py-1.5 text-xs font-medium text-[var(--foreground-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
        >
          Sign
        </button>
      </div>

      <div className="mx-1 h-6 w-px bg-[var(--border)]" />

      <button
        type="button"
        onClick={api.undo}
        disabled={!api.canUndo}
        aria-label="Undo"
        title="Undo (Ctrl/Cmd+Z)"
        className="rounded-full px-2.5 py-1.5 text-xs font-medium text-[var(--foreground-muted)] hover:bg-[var(--surface-muted)] disabled:opacity-30"
      >
        Undo
      </button>
      <button
        type="button"
        onClick={api.redo}
        disabled={!api.canRedo}
        aria-label="Redo"
        title="Redo (Ctrl/Cmd+Shift+Z)"
        className="rounded-full px-2.5 py-1.5 text-xs font-medium text-[var(--foreground-muted)] hover:bg-[var(--surface-muted)] disabled:opacity-30"
      >
        Redo
      </button>

      <div className="mx-1 h-6 w-px bg-[var(--border)]" />

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => api.setZoom(Math.max(0.4, state.zoom - 0.15))}
          aria-label="Zoom out"
          className="rounded-full px-2.5 py-1.5 text-sm text-[var(--foreground-muted)] hover:bg-[var(--surface-muted)]"
        >
          −
        </button>
        <span className="w-12 text-center text-xs text-[var(--foreground-muted)]">{Math.round(state.zoom * 100)}%</span>
        <button
          type="button"
          onClick={() => api.setZoom(Math.min(3, state.zoom + 0.15))}
          aria-label="Zoom in"
          className="rounded-full px-2.5 py-1.5 text-sm text-[var(--foreground-muted)] hover:bg-[var(--surface-muted)]"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => api.setZoom(1, "fit-width")}
          className="rounded-full px-2.5 py-1.5 text-xs font-medium text-[var(--foreground-muted)] hover:bg-[var(--surface-muted)]"
        >
          Fit width
        </button>
        <button
          type="button"
          onClick={() => api.setZoom(1, "fit-page")}
          className="rounded-full px-2.5 py-1.5 text-xs font-medium text-[var(--foreground-muted)] hover:bg-[var(--surface-muted)]"
        >
          Fit page
        </button>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={onExport}
          disabled={api.exporting}
          className="inline-flex items-center gap-1.5 rounded-full bg-[var(--button-bg)] px-4 py-2 text-xs font-medium text-white hover:bg-[var(--button-bg-hover)] disabled:opacity-60"
        >
          <IconDownload className="h-3.5 w-3.5" />
          {api.exporting ? "Exporting…" : "Export PDF"}
        </button>
      </div>
    </div>
  );
}
