"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DropZone } from "@/components/tools/DropZone";
import { ProcessingModeBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { IconWarning } from "@/components/icons";
import { triggerDownload } from "@/lib/download";
import { getToolById } from "@/lib/tools/registry";
import { viewportDimensions } from "@/lib/editor/coordinates";
import { viewportSpecForPage } from "@/lib/editor/types";
import { useEditorWorkspace } from "./useEditorWorkspace";
import { Toolbar } from "./Toolbar";
import { ThumbnailRail } from "./ThumbnailRail";
import { PropertiesPanel } from "./PropertiesPanel";
import { PageSurface, type EditableRegionRequest } from "./PageSurface";
import { TextEditModal } from "./TextEditModal";
import { SignaturePad } from "./SignaturePad";
import { DEFAULT_TOOL_OPTIONS, type ToolOptions } from "./toolOptions";

const tool = getToolById("pdf-editor")!;

export function EditorWorkspace() {
  const api = useEditorWorkspace();
  const { state } = api;

  const [toolOptions, setToolOptions] = useState<ToolOptions>(DEFAULT_TOOL_OPTIONS);
  const [textEditRequest, setTextEditRequest] = useState<EditableRegionRequest | null>(null);
  const [signaturePadOpen, setSignaturePadOpen] = useState(false);
  const [pendingPlacement, setPendingPlacement] = useState<{ kind: "image" | "signature"; dataUrl: string; naturalWidth: number; naturalHeight: number } | null>(null);
  const [insertAfterPageId, setInsertAfterPageId] = useState<string | null | undefined>(undefined);
  const [mobilePanel, setMobilePanel] = useState<"thumbnails" | "properties" | null>(null);

  const imageInputRef = useRef<HTMLInputElement>(null);
  const insertFileInputRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const activePage = state.doc.pages.find((p) => p.id === state.activePageId) ?? state.doc.pages[0] ?? null;

  // Load native text regions for the active page on demand.
  useEffect(() => {
    if (activePage) api.loadNativeRegionsForPage(activePage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePage?.id]);

  // Fit-width / fit-page zoom calculation.
  useEffect(() => {
    if (state.zoomMode === "custom" || !activePage) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    const spec = viewportSpecForPage(activePage, 1);
    const dims = viewportDimensions(spec);
    const availableWidth = container.clientWidth - 48;
    const availableHeight = container.clientHeight - 48;
    const zoom =
      state.zoomMode === "fit-width" ? availableWidth / dims.width : Math.min(availableWidth / dims.width, availableHeight / dims.height);
    api.setZoom(Math.max(0.2, zoom), state.zoomMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.zoomMode, activePage?.id]);

  // Keyboard shortcuts: undo/redo.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const meta = e.ctrlKey || e.metaKey;
      if (!meta || e.key.toLowerCase() !== "z") return;
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      e.preventDefault();
      if (e.shiftKey) api.redo();
      else api.undo();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [api]);

  // Close a mobile drawer panel on Escape.
  useEffect(() => {
    if (!mobilePanel) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMobilePanel(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobilePanel]);

  const handleFile = useCallback(
    async (files: File[]) => {
      const picked = files[0];
      if (picked) await api.openFile(picked);
    },
    [api]
  );

  async function handleExport() {
    const blob = await api.exportDocument();
    if (blob) triggerDownload("edited.pdf", blob);
  }

  function requestImageTool() {
    imageInputRef.current?.click();
  }

  async function handleImagePicked(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const img = new Image();
      img.onload = () => {
        setPendingPlacement({ kind: "image", dataUrl, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight });
        api.setActiveTool("select");
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }

  function handleSignatureConfirm(dataUrl: string, w: number, h: number) {
    setPendingPlacement({ kind: "signature", dataUrl, naturalWidth: w, naturalHeight: h });
    setSignaturePadOpen(false);
  }

  async function handleInsertFilePicked(file: File | undefined) {
    if (!file || insertAfterPageId === undefined) return;
    await api.insertFile(file, insertAfterPageId ?? undefined);
    setInsertAfterPageId(undefined);
  }

  // ------------------------------------------------------------------ empty
  if (state.stage === "empty") {
    return (
      <div className="space-y-4">
        <DropZone accept=".pdf,application/pdf" onFiles={handleFile} hint="or click to choose a PDF to edit" />
        <ProcessingModeBadge mode={tool.processingMode} />
      </div>
    );
  }

  if (state.stage === "loading") {
    return (
      <div className="card-surface flex flex-col items-center gap-4 p-12 text-center">
        <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-[var(--border)] border-t-[var(--brand)]" />
        <p className="font-medium text-[var(--foreground)]">Opening your PDF…</p>
      </div>
    );
  }

  if (state.stage === "error") {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-2 rounded-[var(--radius-md)] bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          <IconWarning className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{state.error}</span>
        </div>
        <Button variant="secondary" onClick={api.reset}>
          Try again
        </Button>
      </div>
    );
  }

  // ------------------------------------------------------------------ ready
  return (
    <div className="-mx-4 flex h-[80vh] min-h-[600px] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] sm:mx-0">
      <Toolbar api={api} onRequestImage={requestImageTool} onRequestSign={() => setSignaturePadOpen(true)} onExport={handleExport} />

      {state.error && (
        <div className="flex items-start gap-2 border-b border-[var(--border)] bg-red-50 px-4 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
          <IconWarning className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{state.error}</span>
        </div>
      )}
      {api.exportError && (
        <div className="flex items-start gap-2 border-b border-[var(--border)] bg-red-50 px-4 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
          <IconWarning className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{api.exportError}</span>
        </div>
      )}

      <div className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 lg:hidden">
        <button
          type="button"
          onClick={() => setMobilePanel("thumbnails")}
          className="rounded-full bg-[var(--surface-muted)] px-3 py-1 text-xs font-medium text-[var(--foreground)]"
        >
          Pages ({state.doc.pages.length})
        </button>
        <button
          type="button"
          onClick={() => setMobilePanel("properties")}
          className="rounded-full bg-[var(--surface-muted)] px-3 py-1 text-xs font-medium text-[var(--foreground)]"
        >
          Properties
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className={`${mobilePanel === "thumbnails" ? "flex" : "hidden"} fixed inset-0 z-[60] lg:static lg:z-auto lg:flex`}>
          {mobilePanel === "thumbnails" && (
            <div className="absolute inset-0 bg-black/40 lg:hidden" onClick={() => setMobilePanel(null)} aria-hidden="true" />
          )}
          <div className="relative h-full lg:h-auto">
            <ThumbnailRail
              api={api}
              doc={state.doc}
              onInsertFile={(afterPageId) => {
                setInsertAfterPageId(afterPageId);
                insertFileInputRef.current?.click();
              }}
            />
          </div>
        </div>

        <div ref={scrollContainerRef} className="flex min-w-0 flex-1 items-start justify-center overflow-auto bg-[var(--surface-muted)] p-6">
          {activePage && (
            <PageSurface
              api={api}
              page={activePage}
              doc={state.doc}
              zoom={state.zoom}
              toolOptions={toolOptions}
              nativeRegions={state.nativeRegionsByPage[activePage.id]}
              ocrResult={state.ocrResultsByPage[activePage.id]}
              showOcrOverlay={state.showOcrOverlay}
              activeMatch={api.searchIndex[state.searchMatchIndex]?.pageId === activePage.id ? api.searchIndex[state.searchMatchIndex] : null}
              onRequestTextEdit={setTextEditRequest}
              pendingPlacement={pendingPlacement}
              onPlacementComplete={() => setPendingPlacement(null)}
            />
          )}
        </div>

        <div className={`${mobilePanel === "properties" ? "flex" : "hidden"} fixed inset-0 z-[60] justify-end lg:static lg:z-auto lg:flex`}>
          {mobilePanel === "properties" && (
            <div className="absolute inset-0 bg-black/40 lg:hidden" onClick={() => setMobilePanel(null)} aria-hidden="true" />
          )}
          <div className="relative h-full lg:h-auto">
            <PropertiesPanel
              api={api}
              doc={state.doc}
              toolOptions={toolOptions}
              onToolOptionsChange={(patch) => setToolOptions((o) => ({ ...o, ...patch }))}
            />
          </div>
        </div>
      </div>

      <input ref={imageInputRef} type="file" accept="image/png,image/jpeg" className="sr-only" onChange={(e) => handleImagePicked(e.target.files?.[0])} />
      <input ref={insertFileInputRef} type="file" accept=".pdf,application/pdf" className="sr-only" onChange={(e) => handleInsertFilePicked(e.target.files?.[0])} />

      {textEditRequest && <TextEditModal request={textEditRequest} api={api} onClose={() => setTextEditRequest(null)} />}
      {signaturePadOpen && <SignaturePad onConfirm={handleSignatureConfirm} onClose={() => setSignaturePadOpen(false)} />}
    </div>
  );
}
