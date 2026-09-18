"use client";

import type { EditorWorkspaceApi, ToolId } from "./useEditorWorkspace";
import { IconDownload, IconImage } from "@/components/icons";
import {
  IconSelect,
  IconEditText,
  IconHighlight,
  IconUnderline,
  IconStrikethrough,
  IconDraw,
  IconRectangleShape,
  IconEllipseShape,
  IconLineShape,
  IconArrowShape,
  IconWhiteout,
  IconCrop,
  IconSignature,
  IconUndo,
  IconRedo,
  IconZoomIn,
  IconZoomOut,
  IconFitWidth,
  IconFitPage,
  IconFullscreen,
} from "./toolIcons";
import { Tooltip } from "./Tooltip";

interface ToolbarProps {
  api: EditorWorkspaceApi;
  onRequestImage: () => void;
  onRequestSign: () => void;
  onExport: () => void;
  onToggleFullscreen?: () => void;
  isFullscreen?: boolean;
}

const TOOLS: { id: ToolId; label: string; icon: (p: { className?: string }) => React.ReactNode; group: string }[] = [
  { id: "select", label: "Select", icon: (p) => <IconSelect {...p} />, group: "Edit" },
  { id: "add-text", label: "Text", icon: (p) => <IconEditText {...p} />, group: "Edit" },
  { id: "highlight", label: "Highlight", icon: (p) => <IconHighlight {...p} />, group: "Annotate" },
  { id: "underline", label: "Underline", icon: (p) => <IconUnderline {...p} />, group: "Annotate" },
  { id: "strikethrough", label: "Strike", icon: (p) => <IconStrikethrough {...p} />, group: "Annotate" },
  { id: "draw", label: "Draw", icon: (p) => <IconDraw {...p} />, group: "Annotate" },
  { id: "shape-rectangle", label: "Rectangle", icon: (p) => <IconRectangleShape {...p} />, group: "Annotate" },
  { id: "shape-ellipse", label: "Ellipse", icon: (p) => <IconEllipseShape {...p} />, group: "Annotate" },
  { id: "shape-line", label: "Line", icon: (p) => <IconLineShape {...p} />, group: "Annotate" },
  { id: "shape-arrow", label: "Arrow", icon: (p) => <IconArrowShape {...p} />, group: "Annotate" },
  { id: "whiteout", label: "Whiteout", icon: (p) => <IconWhiteout {...p} />, group: "Annotate" },
  { id: "crop", label: "Crop", icon: (p) => <IconCrop {...p} />, group: "Document" },
];

function ToolButton({
  pressed,
  label,
  onClick,
  children,
  disabled,
}: {
  pressed?: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-pressed={pressed}
        disabled={disabled}
        className={`inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors disabled:opacity-30 ${
          pressed
            ? "bg-[var(--brand)] text-white"
            : "text-[var(--foreground-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
        }`}
      >
        {children}
      </button>
    </Tooltip>
  );
}

export function Toolbar({ api, onRequestImage, onRequestSign, onExport, onToggleFullscreen, isFullscreen }: ToolbarProps) {
  const { state } = api;

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-[var(--border)] bg-[var(--surface)] px-2 py-1.5">
      <div className="flex flex-wrap items-center gap-0.5" role="toolbar" aria-label="Editing tools">
        {TOOLS.map((t, i) => {
          const showSeparator = i > 0 && t.group !== TOOLS[i - 1].group;
          return (
            <span key={t.id} className="flex items-center gap-0.5">
              {showSeparator && <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-[var(--border)]" />}
              <ToolButton pressed={state.activeTool === t.id} label={t.label} onClick={() => api.setActiveTool(t.id)}>
                {t.icon({ className: "h-4 w-4" })}
              </ToolButton>
            </span>
          );
        })}
        <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-[var(--border)]" />
        <ToolButton label="Image" onClick={onRequestImage}>
          <IconImage className="h-4 w-4" />
        </ToolButton>
        <ToolButton label="Sign" onClick={onRequestSign}>
          <IconSignature className="h-4 w-4" />
        </ToolButton>
      </div>

      <div className="mx-1 h-6 w-px bg-[var(--border)]" />

      <ToolButton label="Undo" onClick={api.undo} disabled={!api.canUndo}>
        <IconUndo className="h-4 w-4" />
      </ToolButton>
      <ToolButton label="Redo" onClick={api.redo} disabled={!api.canRedo}>
        <IconRedo className="h-4 w-4" />
      </ToolButton>

      <div className="mx-1 h-6 w-px bg-[var(--border)]" />

      <div className="flex items-center gap-0.5">
        <ToolButton label="Zoom out" onClick={() => api.setZoom(Math.max(0.4, state.zoom - 0.15))}>
          <IconZoomOut className="h-4 w-4" />
        </ToolButton>
        <span className="w-11 text-center text-xs text-[var(--foreground-muted)]">{Math.round(state.zoom * 100)}%</span>
        <ToolButton label="Zoom in" onClick={() => api.setZoom(Math.min(3, state.zoom + 0.15))}>
          <IconZoomIn className="h-4 w-4" />
        </ToolButton>
        <ToolButton label="Fit width" onClick={() => api.setZoom(1, "fit-width")}>
          <IconFitWidth className="h-4 w-4" />
        </ToolButton>
        <ToolButton label="Fit page" onClick={() => api.setZoom(1, "fit-page")}>
          <IconFitPage className="h-4 w-4" />
        </ToolButton>
        {onToggleFullscreen && (
          <ToolButton label={isFullscreen ? "Exit fullscreen" : "Fullscreen"} onClick={onToggleFullscreen}>
            <IconFullscreen className="h-4 w-4" />
          </ToolButton>
        )}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={onExport}
          disabled={api.exporting}
          className="inline-flex items-center gap-1.5 rounded-full bg-[var(--button-bg)] px-4 py-2 text-xs font-medium text-white hover:bg-[var(--button-bg-hover)] disabled:opacity-60"
        >
          <IconDownload className="h-3.5 w-3.5" />
          {api.exporting ? "Preparing your PDF…" : "Export PDF"}
        </button>
      </div>
    </div>
  );
}
