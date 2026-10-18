"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { EditorWorkspaceApi, ToolId } from "./useEditorWorkspace";
import { LogoMark } from "@/components/brand/Logo";
import { IconChevronDown, IconDownload, IconImage } from "@/components/icons";
import {
  IconSelect,
  IconEditText,
  IconAddText,
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
  IconPages,
  IconUndo,
  IconRedo,
  IconZoomIn,
  IconZoomOut,
  IconFitWidth,
  IconFitPage,
} from "./toolIcons";

type IconC = (p: { className?: string }) => React.ReactNode;

const SHAPES: { id: ToolId; label: string; icon: IconC }[] = [
  { id: "shape-rectangle", label: "Rectangle", icon: IconRectangleShape },
  { id: "shape-ellipse", label: "Ellipse", icon: IconEllipseShape },
  { id: "shape-line", label: "Line", icon: IconLineShape },
  { id: "shape-arrow", label: "Arrow", icon: IconArrowShape },
];

const MORE: { id: ToolId; label: string; icon: IconC }[] = [
  { id: "strikethrough", label: "Strikethrough", icon: IconStrikethrough },
  { id: "crop", label: "Crop", icon: IconCrop },
];

// ---------------------------------------------------------------------------------------------
// Top bar
// ---------------------------------------------------------------------------------------------

export function EditorTopBar({ api, fileName, onExport }: { api: EditorWorkspaceApi; fileName: string; onExport: () => void }) {
  const pages = api.state.doc.pages.length;
  return (
    <header className="relative z-10 flex h-14 shrink-0 items-center gap-2 border-b border-[var(--line)] bg-[var(--surface)] px-2 shadow-[0_6px_18px_-16px_rgb(45_38_20/0.5)] sm:gap-3 sm:px-3">
      <Link
        href="/"
        aria-label="Back to TheFileConvert"
        onClick={(e) => {
          if (api.canUndo && !window.confirm("Leave the editor? Edits you haven't exported will be lost.")) e.preventDefault();
        }}
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] hover:bg-[var(--surface-2)]"
      >
        <LogoMark size={28} />
      </Link>
      <span aria-hidden="true" className="hidden h-6 w-px bg-[var(--line)] sm:block" />
      <span aria-hidden="true" className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[var(--cat-edit-soft)] text-[var(--cat-edit)] sm:flex">
        <IconFileBadge className="h-[18px] w-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold tracking-[-0.01em]" title={fileName}>
          {fileName}
        </p>
        <p className="tabular text-xs text-[var(--ink-2)]">
          {pages} {pages === 1 ? "page" : "pages"}
          {api.canUndo && (
            <span data-testid="dirty-indicator" className="ml-2 inline-flex items-center gap-1 font-medium text-[var(--ink)]">
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[var(--accent-strong,#d97706)]" />
              Unsaved changes
            </span>
          )}
        </p>
      </div>
      <span className="pill mr-1 hidden py-1 text-xs text-[var(--ink-2)] xl:inline-flex">
        <span className="status-dot" aria-hidden="true" />
        Editing on this device
      </span>
      <div className="flex items-center rounded-full border border-[var(--line)] bg-[var(--band)] p-0.5">
        <IconButton label="Undo" onClick={api.undo} disabled={!api.canUndo}>
          <IconUndo className="h-[18px] w-[18px]" />
        </IconButton>
        <IconButton label="Redo" onClick={api.redo} disabled={!api.canRedo}>
          <IconRedo className="h-[18px] w-[18px]" />
        </IconButton>
      </div>
      <button type="button" onClick={onExport} disabled={api.exporting} aria-label="Export PDF" className="btn btn-primary shrink-0 px-4 sm:px-5">
        <IconDownload className="h-[18px] w-[18px]" />
        <span className="hidden min-[400px]:inline">{api.exporting ? "Preparing…" : "Export PDF"}</span>
      </button>
    </header>
  );
}

// ---------------------------------------------------------------------------------------------
// Tool dock
// ---------------------------------------------------------------------------------------------

interface DockProps {
  api: EditorWorkspaceApi;
  onRequestImage: () => void;
  onRequestSign: () => void;
  pagesOpen: boolean;
  onTogglePages: () => void;
  /** Phones only: opens the properties sheet. */
  onOpenProperties?: () => void;
}

/**
 * The tool dock: labelled tools in calm groups — select & text, markup, insert, pages. Shapes and
 * the rarer tools live in small menus so the dock stays short. Annotation tools stay armed after
 * each use until another tool (or Escape) is chosen.
 */
export function ToolDock({ api, onRequestImage, onRequestSign, pagesOpen, onTogglePages, onOpenProperties }: DockProps) {
  const active = api.state.activeTool;
  const pick = (id: ToolId) => api.setActiveTool(id);
  const shape = SHAPES.find((s) => s.id === active);
  const more = MORE.find((m) => m.id === active);

  return (
    <div
      role="toolbar"
      aria-label="Editing tools"
      className="flex items-stretch gap-0.5 overflow-x-auto px-1 [scrollbar-width:none] lg:overflow-visible lg:rounded-[18px] lg:border lg:border-[var(--line)] lg:bg-[var(--surface)] lg:p-1 lg:shadow-[var(--ring-highlight),var(--shadow-2)]"
    >
      <DockButton label="Select" icon={IconSelect} pressed={active === "select"} onClick={() => pick("select")} shortcut="V" />
      <DockButton label="Edit text" icon={IconEditText} pressed={active === "edit-text"} onClick={() => pick("edit-text")} shortcut="E" />
      <DockButton label="Add text" icon={IconAddText} pressed={active === "add-text"} onClick={() => pick("add-text")} shortcut="T" />
      <Divider />
      <DockButton label="Highlight" icon={IconHighlight} pressed={active === "highlight"} onClick={() => pick("highlight")} shortcut="H" />
      <DockButton label="Underline" icon={IconUnderline} pressed={active === "underline"} onClick={() => pick("underline")} shortcut="U" />
      <DockButton label="Draw" icon={IconDraw} pressed={active === "draw"} onClick={() => pick("draw")} shortcut="D" />
      <DockMenu label="Shapes" icon={shape?.icon ?? IconRectangleShape} pressed={Boolean(shape)} items={SHAPES} active={active} onPick={pick} />
      <Divider />
      <DockButton label="Image" icon={(p) => <IconImage {...p} />} onClick={onRequestImage} />
      <DockButton label="Signature" icon={IconSignature} onClick={onRequestSign} />
      <DockButton label="Whiteout" icon={IconWhiteout} pressed={active === "whiteout"} onClick={() => pick("whiteout")} />
      <Divider />
      <DockButton label="Pages" icon={IconPages} pressed={pagesOpen} onClick={onTogglePages} />
      <DockMenu label="More" icon={more?.icon ?? IconCrop} pressed={Boolean(more)} items={MORE} active={active} onPick={pick} />
      {onOpenProperties && <DockButton label="Properties" icon={IconSliders} onClick={onOpenProperties} />}
    </div>
  );
}

function Divider() {
  return <span aria-hidden="true" className="mx-1 my-2 w-px shrink-0 bg-[var(--line)]" />;
}

function DockButton({ label, icon: Icon, pressed, onClick, className = "", shortcut }: { label: string; icon: IconC; pressed?: boolean; onClick: () => void; className?: string; shortcut?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-keyshortcuts={shortcut}
      aria-pressed={pressed}
      className={`flex min-h-12 min-w-[3.5rem] shrink-0 flex-col items-center justify-center gap-0.5 rounded-[12px] px-1.5 py-1 text-[11px] font-medium transition-[background-color,color,box-shadow] duration-200 ${
        pressed ? "bg-[linear-gradient(180deg,#34332f,var(--ink))] text-white shadow-[var(--shadow-button)]" : "text-[var(--ink-2)] hover:bg-[var(--band)] hover:text-[var(--ink)]"
      } ${className}`}
    >
      <Icon className="h-5 w-5" />
      <span aria-hidden="true">{label}</span>
    </button>
  );
}

function DockMenu({
  label,
  icon: Icon,
  pressed,
  items,
  active,
  onPick,
}: {
  label: string;
  icon: IconC;
  pressed: boolean;
  items: { id: ToolId; label: string; icon: IconC }[];
  active: ToolId;
  onPick: (id: ToolId) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; above: boolean } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      if (e instanceof PointerEvent && ref.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);

  function toggle() {
    const r = buttonRef.current?.getBoundingClientRect();
    // Fixed positioning so the menu isn't clipped by the dock's horizontal scroll on phones. It opens
    // below the dock on desktop (dock at the top) and above it on phones (dock at the bottom).
    if (r) {
      const above = !window.matchMedia("(min-width: 1024px)").matches;
      setPos({ left: Math.min(Math.max(8, r.left + r.width / 2 - 96), window.innerWidth - 200), top: above ? r.top - 8 : r.bottom + 8, above });
    }
    setOpen((o) => !o);
  }

  return (
    <div ref={ref} className="relative flex shrink-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-pressed={pressed}
        className={`flex min-h-12 min-w-[3.5rem] flex-col items-center justify-center gap-0.5 rounded-[12px] px-1.5 py-1 text-[11px] font-medium transition-[background-color,color,box-shadow] duration-200 ${
          pressed ? "bg-[linear-gradient(180deg,#34332f,var(--ink))] text-white shadow-[var(--shadow-button)]" : "text-[var(--ink-2)] hover:bg-[var(--band)] hover:text-[var(--ink)]"
        }`}
      >
        <Icon className="h-5 w-5" />
        <span aria-hidden="true" className="inline-flex items-center gap-0.5">
          {label}
          <IconChevronDown className="h-3 w-3" />
        </span>
      </button>
      {open && pos && (
        <div
          role="menu"
          aria-label={label}
          className={`animate-sheet fixed z-[90] w-48 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-1.5 shadow-[var(--shadow-float)] ${pos.above ? "-translate-y-full" : ""}`}
          style={{ left: pos.left, top: pos.top }}
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitemradio"
              aria-checked={active === item.id}
              onClick={() => {
                onPick(item.id);
                setOpen(false);
              }}
              className="flex min-h-11 w-full items-center gap-3 rounded-[10px] px-3 text-sm font-medium hover:bg-[var(--surface-2)] aria-checked:bg-[var(--ink)] aria-checked:text-white"
            >
              <item.icon className="h-[18px] w-[18px]" />
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Zoom
// ---------------------------------------------------------------------------------------------

export function ZoomControl({ api }: { api: EditorWorkspaceApi }) {
  const { zoom } = api.state;
  return (
    <div className="flex items-center rounded-full border border-[var(--line)] bg-[var(--surface)]/95 p-1 shadow-[var(--ring-highlight),var(--shadow-float)] backdrop-blur">
      <IconButton label="Zoom out" onClick={() => api.setZoom(Math.max(0.4, zoom - 0.15))}>
        <IconZoomOut className="h-[18px] w-[18px]" />
      </IconButton>
      <button
        type="button"
        onClick={() => api.setZoom(1)}
        aria-label="Actual size (100%)"
        title="Actual size (100%)"
        className="tabular h-11 min-w-14 rounded-full px-1 text-center text-xs font-semibold hover:bg-[var(--surface-2)]"
      >
        {Math.round(zoom * 100)}%
      </button>
      <IconButton label="Zoom in" onClick={() => api.setZoom(Math.min(3, zoom + 0.15))}>
        <IconZoomIn className="h-[18px] w-[18px]" />
      </IconButton>
      <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-[var(--line)]" />
      <IconButton label="Fit width" onClick={() => api.setZoom(1, "fit-width")}>
        <IconFitWidth className="h-[18px] w-[18px]" />
      </IconButton>
      <IconButton label="Fit page" onClick={() => api.setZoom(1, "fit-page")} className="hidden sm:inline-flex">
        <IconFitPage className="h-[18px] w-[18px]" />
      </IconButton>
    </div>
  );
}

function IconButton({ label, onClick, disabled, children, className = "" }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`inline-flex h-11 w-11 items-center justify-center rounded-full text-[var(--ink)] transition-colors hover:bg-[var(--surface-2)] disabled:opacity-30 disabled:hover:bg-transparent ${className}`}
    >
      {children}
    </button>
  );
}

function IconSliders({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" className={className} aria-hidden="true">
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </svg>
  );
}

function IconFileBadge({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M14 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8Z" />
      <path d="M14 3.5V8h4.5M8.5 13h7M8.5 16.5h4.5" />
    </svg>
  );
}
